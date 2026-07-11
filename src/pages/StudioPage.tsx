import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { engine } from "../audio/engine.ts";
import { formatTime } from "../audio/maths.ts";
import {
  Fader,
  HardwareButton,
  LCD,
  LEDMeter,
  ScribbleStrip,
  TempoFader,
  Transport,
} from "../hardware/index.ts";
import { STEM_DISPLAY } from "../separation/constants.ts";
import { separator, type SeparationOutcome } from "../separation/separator.ts";
import type { CachedSongSummary } from "../separation/cache.ts";
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

/** The Woodshed desk. Night 3: a loaded song plays immediately on the
 *  single-track player; separation into four stems runs only from the
 *  SEPARATE control (cached songs skip straight to stems), with honest LCD
 *  progress, cancel/resume, and an IndexedDB cache. */
export default function StudioPage() {
  const state = useSyncExternalStore(engine.subscribe, engine.getState);
  const sep = useSyncExternalStore(separator.subscribe, separator.getState);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [scribbles, setScribbles] = useState<string[]>(
    STEM_DISPLAY.map((s) => s.short),
  );
  const [cachedSongs, setCachedSongs] = useState<CachedSongSummary[]>([]);
  const [cacheBytes, setCacheBytes] = useState(0);
  const startedForFile = useRef<string | null>(null);

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

  const startSeparation = useCallback(async () => {
    const channels = engine.getSourceChannels();
    const fileName = engine.getState().fileName;
    if (!channels || !fileName) return;
    const outcome: SeparationOutcome | null = await separator.separate(
      [channels[0], channels[1]],
      fileName,
    );
    if (outcome) await applyOutcome(outcome);
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
        if (cached) await applyOutcome(cached);
      })();
    }
  }, [state.status, state.stems, state.fileName, applyOutcome]);

  // Global keyboard shortcuts: space play/pause, L loop tap, arrows seek.
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

  const loopLcd = state.loop
    ? `IN  ${formatTime(state.loop.start)}\nOUT ${formatTime(state.loop.end)}`
    : state.pendingLoopStart !== null
      ? `IN  ${formatTime(state.pendingLoopStart)}\nOUT --:--.-`
      : "NO LOOP";

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
            {state.status === "ready" && state.stems && engine.stemPeaks && (
              <div data-testid="stem-lanes">
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
                        position={state.position}
                        loop={state.loop}
                        pendingLoopStart={state.pendingLoopStart}
                        muted={state.stems![stem.name].muted}
                        colourToken={stem.colourToken}
                        onSeek={(t) => void engine.seek(t)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {state.status === "ready" && !state.stems && (
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
                    position={state.position}
                    loop={state.loop}
                    pendingLoopStart={state.pendingLoopStart}
                    muted={state.muted}
                    colourToken={
                      separating ? "--engrave-dim" : "--stem-vocals"
                    }
                    onSeek={(t) => void engine.seek(t)}
                  />
                </div>
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
          </div>

          <div className="console">
            {state.stems || separating ? (
              STEM_DISPLAY.map((stem, i) => {
                const strip = state.stems?.[stem.name];
                const locked = !strip;
                return (
                  <div
                    className={`strip${locked ? " strip-locked" : ""}`}
                    key={stem.name}
                    data-testid={`strip-${stem.name}`}
                    aria-disabled={locked}
                  >
                    <div className="strip-num" style={{ color: `var(${stem.colourToken})` }}>
                      {stem.label.toUpperCase()}
                    </div>
                    <HardwareButton
                      label="MUTE"
                      led="red"
                      on={strip?.muted ?? false}
                      ariaLabel={`Mute ${stem.label}`}
                      onChange={(on) => engine.setStemMuted(stem.name, on)}
                    />
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
                      value={scribbles[i]}
                      onChange={(text) =>
                        setScribbles((prev) =>
                          prev.map((p, j) => (j === i ? text : p)),
                        )
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
                  value={scribbles[0]}
                  onChange={(text) =>
                    setScribbles((prev) => prev.map((p, j) => (j === 0 ? text : p)))
                  }
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
              <div className="mcol">
                <div className="label">Loop</div>
                <LCD variant="loop" ariaLabel="Loop points">
                  <span data-testid="loop-readout" style={{ whiteSpace: "pre-line" }}>
                    {loopLcd}
                  </span>
                </LCD>
                <div style={{ marginTop: "auto" }}>
                  <Transport
                    playing={state.playing}
                    loopEngaged={state.loop !== null}
                    onPlayPause={() => void engine.playPause()}
                    onRewind={() => void engine.rewind()}
                    onLoopToggle={() => void engine.toggleLoop()}
                  />
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
