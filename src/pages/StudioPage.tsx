import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { engine } from "../audio/engine.ts";
import {
  anySoloEngaged,
  formatPitch,
  formatTime,
  isStemSilenced,
  PITCH_MAX,
  PITCH_MIN,
} from "../audio/maths.ts";
import {
  Fader,
  HardwareButton,
  Knob,
  LCD,
  LEDMeter,
  ScribbleStrip,
  TempoFader,
  Transport,
} from "../hardware/index.ts";
import { modelStore } from "../model/modelStore.ts";
import { STEM_DISPLAY, type StemName } from "../separation/constants.ts";
import {
  isMockWorkerMode,
  separator,
  type SeparationOutcome,
} from "../separation/separator.ts";
import type {
  CachedSongSummary,
  SavedLoop,
  StemMixerSetting,
} from "../separation/cache.ts";
import { analyser } from "../analysis/analyser.ts";
import { capabilityNotice, detectCapabilities } from "../capabilities.ts";
import { featureUnlocked, licence } from "../licence/licence.ts";
import { ChordLane } from "../studio/ChordLane.tsx";
import { ExportRack } from "../studio/ExportRack.tsx";
import { LaneOverlay } from "../studio/LaneOverlay.tsx";
import { LicencePanel } from "../studio/LicencePanel.tsx";
import { WaveformLane } from "../studio/WaveformLane.tsx";
import "../studio/studio.css";

declare global {
  interface Window {
    __woodshedLastOutcome?: {
      stemRms: number[];
      reconstructionError: number | null;
      ep: string;
      fromCache: boolean;
      elapsedMs: number | null;
    };
  }
}

function formatEta(seconds: number | null): string {
  if (seconds === null) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = String(Math.round(seconds % 60)).padStart(2, "0");
  return `${m}:${s}`;
}

function formatMB(bytes: number): string {
  return `${(bytes / 1048576).toFixed(0)} MB`;
}

// Detected once; a browser's capabilities do not change mid-session.
const CAPABILITY_NOTICE = capabilityNotice(detectCapabilities());

function defaultScribbles(): Record<StemName, string> {
  return Object.fromEntries(
    STEM_DISPLAY.map((s) => [s.name, s.short]),
  ) as Record<StemName, string>;
}

/** The Woodshed desk. Night 3: a loaded song plays immediately on the
 *  single-track player; separation into four stems runs only from the
 *  SEPARATE control (cached songs skip straight to stems), with honest LCD
 *  progress, cancel/resume, and an IndexedDB cache. */
export default function StudioPage() {
  const state = useSyncExternalStore(engine.subscribe, engine.getState);
  const sep = useSyncExternalStore(separator.subscribe, separator.getState);
  const chords = useSyncExternalStore(analyser.subscribe, analyser.getState);
  const model = useSyncExternalStore(modelStore.subscribe, modelStore.getState);
  const [licencePanelOpen, setLicencePanelOpen] = useState(false);
  // Subscribing makes featureUnlocked reactive to activation/deactivation.
  useSyncExternalStore(licence.subscribe, licence.getState);
  useEffect(() => void licence.init(), []);
  const chordsUnlocked = featureUnlocked("chords");
  const exportUnlocked = featureUnlocked("export");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [scribbles, setScribbles] = useState<Record<StemName, string>>(
    defaultScribbles,
  );
  const [ch1Scribble, setCh1Scribble] = useState("track");
  const [savedLoops, setSavedLoops] = useState<SavedLoop[]>([]);
  const [songKey, setSongKey] = useState<string | null>(null);
  const [cachedSongs, setCachedSongs] = useState<CachedSongSummary[]>([]);
  const [cacheBytes, setCacheBytes] = useState(0);
  const startedForFile = useRef<string | null>(null);
  /** Song key whose stored state has been applied; gates persistence so
   *  defaults never clobber a stored record before restore completes. */
  const restoredKey = useRef<string | null>(null);
  /** Stem mixer settings waiting for the strips to exist (stems restore
   *  from cache or arrive after SEPARATE). */
  const pendingStemMixer = useRef<Record<StemName, StemMixerSetting> | null>(
    null,
  );
  /** Last known stem mixer, persisted even while the desk is showing the
   *  single-track player so an un-separated reopen keeps old settings. */
  const lastStemMixer = useRef<Record<StemName, StemMixerSetting> | null>(
    null,
  );

  const openPicker = () => fileInputRef.current?.click();

  const handleFiles = useCallback((files: FileList | null) => {
    const file = files?.[0];
    if (file) void engine.loadFile(file);
  }, []);

  const refreshCachePanel = useCallback(() => {
    void separator.listCachedSongs().then(setCachedSongs);
    void separator.cacheSizeBytes().then(setCacheBytes);
  }, []);

  useEffect(refreshCachePanel, [refreshCachePanel, sep.phase]);

  const applyOutcome = useCallback(async (outcome: SeparationOutcome) => {
    await engine.enterStemMode(outcome.rows, outcome.totalSamples);
    // Test and diagnostics hook (integration spec reads this).
    window.__woodshedLastOutcome = {
      stemRms: outcome.stemRms,
      reconstructionError: outcome.reconstructionError,
      ep: outcome.ep,
      fromCache: outcome.fromCache,
      elapsedMs: outcome.elapsedMs,
    };
  }, []);

  /** Covers the whole click-to-phase-change span (including the async
   *  model probe), so a double click cannot start a competing run before
   *  the separator's phase hides the control. */
  const separationBusy = useRef(false);

  const startSeparation = useCallback(async () => {
    if (separationBusy.current) return;
    separationBusy.current = true;
    try {
      const channels = engine.getSourceChannels();
      const fileName = engine.getState().fileName;
      if (!channels || !fileName) return;
      // First use downloads the model (progress on the deck, SHA-256
      // verified, stored in Cache Storage for offline). Mock flows skip it.
      if (!isMockWorkerMode()) {
        const ready = await modelStore.ensure();
        if (!ready) return;
      }
      const outcome: SeparationOutcome | null = await separator.separate(
        [channels[0], channels[1]],
        fileName,
      );
      if (outcome) await applyOutcome(outcome);
    } finally {
      // Completion, cancel, or error alike: the next press must work.
      separationBusy.current = false;
    }
  }, [applyOutcome]);

  // On load: cache-only lookup. A previously separated song goes straight
  // to the four-stem view; anything else stays on the live single-track
  // player until SEPARATE is pressed. Separation never starts as a side
  // effect of loading a file.
  useEffect(() => {
    if (
      state.status === "ready" &&
      state.stems === null &&
      state.fileName &&
      startedForFile.current !== state.fileName
    ) {
      startedForFile.current = state.fileName;
      void (async () => {
        const channels = engine.getSourceChannels();
        const fileName = engine.getState().fileName;
        if (!channels || !fileName) return;
        const cached = await separator.loadCached(
          [channels[0], channels[1]],
          fileName,
        );
        // Restore per-song practice state before stems land so the stored
        // record is never overwritten with defaults.
        const key = separator.currentKey;
        const saved = key ? await separator.getSongState(key) : undefined;
        if (saved) {
          setScribbles({ ...defaultScribbles(), ...saved.scribbles });
          setSavedLoops(saved.savedLoops);
          engine.setSpeed(saved.mixer.speed);
          engine.setPitch(saved.mixer.pitch);
          pendingStemMixer.current = saved.mixer.stems;
          lastStemMixer.current = saved.mixer.stems;
          if (saved.lastLoop) {
            await engine.setLoop(saved.lastLoop.start, saved.lastLoop.end);
          }
        } else {
          setScribbles(defaultScribbles());
          setSavedLoops([]);
          pendingStemMixer.current = null;
          lastStemMixer.current = null;
        }
        setSongKey(key);
        restoredKey.current = key;
        // Cached chord segments restore with the song; a cache miss just
        // leaves the honest empty state (analysis is never a load side
        // effect).
        analyser.reset();
        if (key) await analyser.loadCached(key);
        if (cached) await applyOutcome(cached);
      })();
    }
  }, [state.status, state.stems, state.fileName, applyOutcome]);

  // Apply restored stem mixer settings once the strips exist.
  useEffect(() => {
    if (!state.stems || !pendingStemMixer.current) return;
    const mix = pendingStemMixer.current;
    pendingStemMixer.current = null;
    for (const { name } of STEM_DISPLAY) {
      const m = mix[name];
      if (!m) continue;
      engine.setStemGainDb(name, m.gainDb);
      engine.setStemMuted(name, m.muted);
      engine.setStemSoloed(name, m.soloed);
    }
  }, [state.stems]);

  // Persist per-song practice state on any meaningful change. The
  // signature strips meter levels so IndexedDB is not written on every
  // meter tick.
  const mixerSig = JSON.stringify({
    speed: state.speed,
    pitch: state.pitch,
    loop: state.loop,
    stems: state.stems
      ? STEM_DISPLAY.map(({ name }) => {
          const s = state.stems![name];
          return [name, s.gainDb, s.muted, s.soloed];
        })
      : null,
  });
  useEffect(() => {
    if (!songKey || restoredKey.current !== songKey) return;
    const engineState = engine.getState();
    if (engineState.stems) {
      lastStemMixer.current = Object.fromEntries(
        STEM_DISPLAY.map(({ name }) => {
          const s = engineState.stems![name];
          return [name, { gainDb: s.gainDb, muted: s.muted, soloed: s.soloed }];
        }),
      ) as Record<StemName, StemMixerSetting>;
    }
    void separator.putSongState({
      key: songKey,
      scribbles,
      savedLoops,
      lastLoop: engineState.loop,
      mixer: {
        speed: engineState.speed,
        pitch: engineState.pitch,
        stems: lastStemMixer.current,
      },
      updatedAt: Date.now(),
    });
  }, [mixerSig, scribbles, savedLoops, songKey]);

  const startChordAnalysis = useCallback(() => {
    if (!chordsUnlocked) {
      setLicencePanelOpen(true);
      return;
    }
    const mono = engine.getMonoMixCopy();
    const key = separator.currentKey;
    if (!mono || !key) return;
    void analyser.analyse(mono, key);
  }, [chordsUnlocked]);

  const saveCurrentLoop = useCallback(() => {
    const loop = engine.getState().loop;
    if (!loop) return;
    setSavedLoops((prev) => [
      ...prev,
      { name: `Loop ${prev.length + 1}`, start: loop.start, end: loop.end },
    ]);
  }, []);

  // Global keyboard shortcuts: space play/pause, L loop tap, arrows seek,
  // M and S mute/solo the focused strip (spec section 8).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const onSlider = target.getAttribute("role") === "slider";
      if (e.code === "Space") {
        e.preventDefault();
        void engine.playPause();
      } else if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        void engine.tapLoopPoint();
      } else if (e.key === "m" || e.key === "M" || e.key === "s" || e.key === "S") {
        const name = target.closest("[data-stem]")?.getAttribute("data-stem") as
          | StemName
          | undefined;
        const stems = engine.getState().stems;
        if (name && stems) {
          e.preventDefault();
          if (e.key === "m" || e.key === "M") {
            engine.setStemMuted(name, !stems[name].muted);
          } else {
            engine.setStemSoloed(name, !stems[name].soloed);
          }
        }
      } else if (e.key === "ArrowLeft" && !onSlider) {
        e.preventDefault();
        void engine.seekBy(-5);
      } else if (e.key === "ArrowRight" && !onSlider) {
        e.preventDefault();
        void engine.seekBy(5);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The loop LCD doubles as state feedback: NO LOOP, then SET B once A is
  // armed, then the in/out times.
  const loopLcd = state.loop
    ? `IN  ${formatTime(state.loop.start)}\nOUT ${formatTime(state.loop.end)}`
    : state.pendingLoopStart !== null
      ? `IN  ${formatTime(state.pendingLoopStart)}\nSET B`
      : "NO LOOP";

  const anySolo = state.stems
    ? anySoloEngaged(Object.values(state.stems))
    : false;

  const separating = sep.phase === "warming" || sep.phase === "separating";
  const pct = sep.total > 0 ? Math.round((sep.done / sep.total) * 100) : 0;

  const separationLcd =
    sep.phase === "warming"
      ? "WARMING UP THE SEPARATOR"
      : sep.phase === "separating"
        ? `SEPARATING ${pct}%  EST ${formatEta(sep.etaSeconds)}`
        : sep.phase === "cancelled"
          ? `SEPARATION PAUSED AT ${pct}%`
          : null;

  return (
    <>
      <div
        className="rig"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="cheek" />
        <div className="desk">
          <div className="screw screw-tl" />
          <div className="screw screw-tr" />
          <div className="screw screw-bl" />
          <div className="screw screw-br" />

          <div className="toprail">
            <div className="brandplate">
              <div className="brandplate-name">Woodshed</div>
              <div className="brandplate-model">W-4S practice console</div>
            </div>
            <button
              type="button"
              className="tapelabel"
              onClick={openPicker}
              aria-label="Load a song"
            >
              <div className="tapelabel-small">
                {state.fileName ? "Now loaded" : "No tape"}
              </div>
              <div className="tapelabel-song" data-testid="song-label">
                {state.status === "loading"
                  ? "spooling..."
                  : (state.fileName ??
                    "drop a song here, or click to choose one")}
              </div>
            </button>
            <LCD variant="time" ariaLabel="Elapsed time">
              <span data-testid="time-readout">{formatTime(state.position)}</span>
              <div className="clock-label">
                Elapsed / {formatTime(state.duration)}
              </div>
            </LCD>
          </div>

          <div className={`deck${dragOver ? " deck-drop" : ""}`}>
            {state.status === "ready" &&
              (chords.segments && chords.segments.length > 0 ? (
                <ChordLane
                  segments={chords.segments}
                  position={state.position}
                  onSeek={(t) => void engine.seek(t)}
                />
              ) : (
                <div
                  className={`chordlane-status${chordsUnlocked ? "" : " locked-control"}`}
                  data-testid="chord-status"
                >
                  <LCD variant="readout" ariaLabel="Chord analysis status">
                    <span data-testid="chord-readout">
                      {!chordsUnlocked
                        ? "LOCKED"
                        : chords.phase === "analysing"
                          ? `READING CHORDS ${chords.total > 0 ? Math.round((chords.done / chords.total) * 100) : 0}%`
                          : chords.phase === "error"
                            ? `CHORDS FAILED — ${chords.error}`
                            : chords.phase === "done"
                              ? "NO CHORDS FOUND"
                              : "NO CHORDS YET"}
                    </span>
                  </LCD>
                  <span className="beta-tag">Chords beta</span>
                  {chords.phase === "analysing" ? (
                    <HardwareButton
                      label="STOP"
                      led="red"
                      on={false}
                      momentary
                      ariaLabel="Cancel chord analysis"
                      onChange={() => analyser.cancel()}
                    />
                  ) : (
                    <HardwareButton
                      label="CHORDS"
                      led="amber"
                      on={false}
                      momentary
                      wide
                      ariaLabel="Analyse chords"
                      onChange={startChordAnalysis}
                    />
                  )}
                </div>
              ))}
            {state.status === "ready" && state.stems && engine.stemPeaks && (
              <div className="deck-lanes" data-testid="stem-lanes">
                {STEM_DISPLAY.map((stem) => engine.stemPeaks && (
                  <div className="lane" key={stem.name}>
                    <div className="lane-tag">
                      <div
                        className="lane-dot"
                        style={{ background: `var(${stem.colourToken})` }}
                      />
                      <span style={{ color: `var(${stem.colourToken})` }}>
                        {stem.label}
                      </span>
                    </div>
                    <div className="lane-wave">
                      <WaveformLane
                        peaks={engine.stemPeaks[stem.name]}
                        duration={state.duration}
                        loop={state.loop}
                        muted={isStemSilenced(state.stems![stem.name], anySolo)}
                        colourToken={stem.colourToken}
                        onSeek={(t) => void engine.seek(t)}
                      />
                    </div>
                  </div>
                ))}
                <LaneOverlay
                  duration={state.duration}
                  position={state.position}
                  loop={state.loop}
                  pendingLoopStart={state.pendingLoopStart}
                />
              </div>
            )}
            {state.status === "ready" && !state.stems && (
              <div className="deck-lanes">
                <div className="lane">
                  <div className="lane-tag">
                    <div
                      className="lane-dot"
                      style={{
                        background: separating
                          ? "var(--engrave-dim)"
                          : "var(--stem-vocals)",
                      }}
                    />
                    <span
                      style={{
                        color: separating
                          ? "var(--engrave-dim)"
                          : "var(--stem-vocals)",
                      }}
                    >
                      Track
                    </span>
                  </div>
                  <div className="lane-wave">
                    <WaveformLane
                      peaks={engine.peaks}
                      duration={state.duration}
                      loop={state.loop}
                      muted={state.muted}
                      colourToken={
                        separating ? "--engrave-dim" : "--stem-vocals"
                      }
                      onSeek={(t) => void engine.seek(t)}
                    />
                  </div>
                </div>
                <LaneOverlay
                  duration={state.duration}
                  position={state.position}
                  loop={state.loop}
                  pendingLoopStart={state.pendingLoopStart}
                />
              </div>
            )}
            {state.status !== "ready" && (
              <div className="deck-message" data-testid="deck-message">
                {state.status === "loading"
                  ? "READING TAPE..."
                  : "LOAD A SONG TO BEGIN — MP3 WAV M4A FLAC"}
              </div>
            )}
            {state.status === "ready" &&
              !state.stems &&
              model.phase === "downloading" && (
                <div className="deck-status" data-testid="model-download">
                  <LCD variant="readout" ariaLabel="Model download progress">
                    {`FETCHING SEPARATION MODEL ${
                      model.totalBytes > 0
                        ? Math.round((model.received / model.totalBytes) * 100)
                        : 0
                    }% OF ${formatMB(model.totalBytes)} — FIRST TIME ONLY`}
                  </LCD>
                </div>
              )}
            {model.phase === "error" && (
              <div className="deck-error" role="alert" data-testid="deck-error">
                MODEL DOWNLOAD FAILED — {model.error}
              </div>
            )}
            {state.status === "ready" &&
              !state.stems &&
              model.phase !== "downloading" &&
              CAPABILITY_NOTICE?.level !== "blocked" &&
              (sep.phase === "idle" || sep.phase === "error") && (
                <div className="deck-status" data-testid="separate-control">
                  <span className="label">Four-stem practice</span>
                  <HardwareButton
                    label="SEPARATE"
                    led="amber"
                    on={false}
                    momentary
                    wide
                    ariaLabel="Separate into stems"
                    onChange={() => void startSeparation()}
                  />
                </div>
              )}
            {separationLcd && (
              <div className="deck-status" data-testid="separation-status">
                <LCD variant="readout" ariaLabel="Separation progress">
                  {separationLcd}
                </LCD>
                {separating && (
                  <HardwareButton
                    label="STOP"
                    led="red"
                    on={false}
                    momentary
                    ariaLabel="Cancel separation"
                    onChange={() => separator.cancel()}
                  />
                )}
                {sep.phase === "cancelled" && (
                  <HardwareButton
                    label="GO"
                    led="amber"
                    on={false}
                    momentary
                    ariaLabel="Resume separation"
                    onChange={() => void startSeparation()}
                  />
                )}
              </div>
            )}
            {sep.phase === "error" && (
              <div className="deck-error" role="alert" data-testid="deck-error">
                SEPARATION FAILED — {sep.error}
              </div>
            )}
            {state.error && (
              <div className="deck-error" role="alert" data-testid="deck-error">
                {state.error}
              </div>
            )}
            {sep.wasmFallback && separating && (
              <div className="deck-warning" data-testid="wasm-warning">
                WEBGPU NOT AVAILABLE — SEPARATING ON THE CPU INSTEAD. SLOWER,
                SAME QUALITY. EST {formatEta(sep.etaSeconds)}
              </div>
            )}
            {CAPABILITY_NOTICE &&
              (CAPABILITY_NOTICE.level === "blocked" ? (
                <div
                  className="deck-error"
                  role="alert"
                  data-testid="capability-notice"
                >
                  {CAPABILITY_NOTICE.message}
                </div>
              ) : (
                <div className="deck-warning" data-testid="capability-notice">
                  {CAPABILITY_NOTICE.message}
                </div>
              ))}
          </div>

          <div className="console">
            {state.stems || separating ? (
              STEM_DISPLAY.map((stem) => {
                const strip = state.stems?.[stem.name];
                const locked = !strip;
                return (
                  <div
                    className={`strip${locked ? " strip-locked" : ""}`}
                    key={stem.name}
                    data-testid={`strip-${stem.name}`}
                    data-stem={stem.name}
                    aria-disabled={locked}
                  >
                    <div className="strip-num" style={{ color: `var(${stem.colourToken})` }}>
                      {stem.label.toUpperCase()}
                    </div>
                    <div className="strip-buttons">
                      <HardwareButton
                        label="MUTE"
                        led="red"
                        on={strip?.muted ?? false}
                        ariaLabel={`Mute ${stem.label}`}
                        onChange={(on) => engine.setStemMuted(stem.name, on)}
                      />
                      <HardwareButton
                        label="SOLO"
                        led="amber"
                        on={strip?.soloed ?? false}
                        ariaLabel={`Solo ${stem.label}`}
                        onChange={(on) => engine.setStemSoloed(stem.name, on)}
                      />
                    </div>
                    <div className="faderbay">
                      <Fader
                        value={strip?.gainDb ?? 0}
                        label={stem.label}
                        onChange={(db) => engine.setStemGainDb(stem.name, db)}
                      />
                      <LEDMeter level={strip?.level ?? 0} label={stem.name} />
                    </div>
                    <ScribbleStrip
                      id={`stem-${stem.name}`}
                      value={scribbles[stem.name]}
                      onChange={(text) =>
                        setScribbles((prev) => ({ ...prev, [stem.name]: text }))
                      }
                    />
                  </div>
                );
              })
            ) : (
              <div className="strip" style={{ maxWidth: 150 }}>
                <div className="strip-num">CH 1</div>
                <HardwareButton
                  label="MUTE"
                  led="red"
                  on={state.muted}
                  onChange={(on) => engine.setMuted(on)}
                />
                <div className="faderbay">
                  <Fader
                    value={state.gainDb}
                    label="Channel 1"
                    onChange={(db) => engine.setGainDb(db)}
                  />
                  <LEDMeter level={state.level} label="channel 1" />
                </div>
                <ScribbleStrip
                  id="ch1"
                  value={ch1Scribble}
                  onChange={setCh1Scribble}
                />
              </div>
            )}

            <div className="master">
              <div className="mcol" style={{ flex: 0.9 }}>
                <div className="label">Tempo</div>
                <TempoFader
                  value={state.speed}
                  onChange={(pct2) => engine.setSpeed(pct2)}
                />
                <LCD variant="readout" ariaLabel="Speed">
                  <span data-testid="tempo-readout">{state.speed}%</span>
                </LCD>
              </div>
              <div className="mcol" style={{ flex: 0.7, justifyContent: "center" }}>
                <Knob
                  value={state.pitch}
                  min={PITCH_MIN}
                  max={PITCH_MAX}
                  default={0}
                  step={1}
                  label="Pitch"
                  valueText={`${formatPitch(state.pitch)}`}
                  onChange={(v) => engine.setPitch(v)}
                />
                <LCD variant="readout" ariaLabel="Pitch shift">
                  <span data-testid="pitch-readout" style={{ whiteSpace: "nowrap" }}>
                    {formatPitch(state.pitch)}
                  </span>
                </LCD>
              </div>
              <div className="mcol">
                <div className="label">Loop</div>
                <LCD variant="loop" ariaLabel="Loop points">
                  <span data-testid="loop-readout" style={{ whiteSpace: "pre-line" }}>
                    {loopLcd}
                  </span>
                </LCD>
                <div className="loop-ab">
                  <HardwareButton
                    label="A"
                    led="amber"
                    on={state.pendingLoopStart !== null || state.loop !== null}
                    momentary
                    ariaLabel="Set loop start"
                    onChange={() => void engine.setLoopPointA()}
                  />
                  <HardwareButton
                    label="B"
                    led="amber"
                    on={state.loop !== null}
                    momentary
                    ariaLabel="Set loop end"
                    onChange={() => void engine.setLoopPointB()}
                  />
                  <HardwareButton
                    label="CLR"
                    led="red"
                    on={false}
                    momentary
                    ariaLabel="Clear loop"
                    onChange={() => void engine.clearLoop()}
                  />
                </div>
                <div style={{ marginTop: "auto" }}>
                  <Transport
                    playing={state.playing}
                    loopEngaged={state.loop !== null}
                    onPlayPause={() => void engine.playPause()}
                    onRewind={() => void engine.rewind()}
                    onLoopToggle={() => void engine.toggleLoop()}
                  />
                </div>
                <div className="shortcut-hint">
                  Space play · L loop A/B · S solo · M mute
                </div>
              </div>
            </div>
          </div>

          <div className="desk-footer">
            <span>All processing on this device — nothing uploaded</span>
            <span>Wantage · Oxfordshire · Serial 0001</span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.wav,.m4a,.flac,audio/*"
            style={{ display: "none" }}
            data-testid="file-input"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        <div className="cheek" />
      </div>

      <div className="rack">
        <LicencePanel
          open={licencePanelOpen}
          onOpen={() => setLicencePanelOpen(true)}
          onClose={() => setLicencePanelOpen(false)}
        />
        {state.status === "ready" && state.stems && songKey && state.fileName && (
          <ExportRack
            songKey={songKey}
            fileName={state.fileName}
            unlocked={exportUnlocked}
            onLockedInteraction={() => setLicencePanelOpen(true)}
          />
        )}
        {state.status === "ready" && songKey && (
          <div className="rack-panel" data-testid="loop-bank">
            <span className="label">Loop bank</span>
            <HardwareButton
              label="SAVE"
              led="amber"
              on={false}
              momentary
              ariaLabel="Save current loop"
              onChange={saveCurrentLoop}
            />
            {savedLoops.map((l, i) => (
              <div className="rack-song" key={`${songKey}-${i}`}>
                <ScribbleStrip
                  id={`loop-${songKey}-${i}`}
                  value={l.name}
                  onChange={(text) =>
                    setSavedLoops((prev) =>
                      prev.map((p, j) => (j === i ? { ...p, name: text } : p)),
                    )
                  }
                />
                <HardwareButton
                  label="GO"
                  led="amber"
                  on={false}
                  momentary
                  ariaLabel={`Engage saved loop ${l.name}`}
                  onChange={() => void engine.setLoop(l.start, l.end)}
                />
                <HardwareButton
                  label="DEL"
                  led="red"
                  on={false}
                  momentary
                  ariaLabel={`Delete saved loop ${l.name}`}
                  onChange={() =>
                    setSavedLoops((prev) => prev.filter((_, j) => j !== i))
                  }
                />
              </div>
            ))}
            {savedLoops.length === 0 && (
              <span className="label">Set a loop, then SAVE it here</span>
            )}
          </div>
        )}
        <div className="rack-panel" data-testid="cache-rack">
          <span className="label">Stem store</span>
          <LCD variant="readout" ariaLabel="Cache size">
            <span data-testid="cache-size">{formatMB(cacheBytes)}</span>
          </LCD>
          {cachedSongs.map((song) => (
            <div className="rack-song" key={song.key}>
              <span className="label" style={{ color: "var(--engrave)" }}>
                {song.name} · {formatMB(song.bytes)}
              </span>
              <HardwareButton
                label="PURGE"
                led="red"
                on={false}
                ariaLabel={`Purge ${song.name} from the stem store`}
                onChange={() =>
                  void separator.purgeSong(song.key).then(refreshCachePanel)
                }
              />
            </div>
          ))}
          {cachedSongs.length === 0 && (
            <span className="label">No separated songs stored</span>
          )}
        </div>
      </div>

      <div className="small-screen-notice">
        <strong>Woodshed is built for a desktop or laptop.</strong> It splits
        songs into stems, slows them down without changing pitch, and loops
        sections while you practise — all on your own machine, nothing
        uploaded. Come back on a bigger screen and bring your instrument.
      </div>
    </>
  );
}
