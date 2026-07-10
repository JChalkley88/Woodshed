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
import { WaveformLane } from "../studio/WaveformLane.tsx";
import "../studio/studio.css";

/** The Woodshed desk. Single-track practice player tonight: load a song,
 *  loop a section, slow it down with pitch preserved. */
export default function StudioPage() {
  const state = useSyncExternalStore(engine.subscribe, engine.getState);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [scribble, setScribble] = useState("track 1");

  const openPicker = () => fileInputRef.current?.click();

  const handleFiles = useCallback((files: FileList | null) => {
    const file = files?.[0];
    if (file) void engine.loadFile(file);
  }, []);

  // Global keyboard shortcuts: space play/pause, L loop tap, arrows seek.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      // Arrow keys on a focused slider adjust that control, not the playhead.
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
              <div className="brandplate-model">W-1S practice console</div>
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
            {state.status === "ready" && (
              <div className="lane">
                <div className="lane-tag">
                  <div className="lane-dot" />
                  <span>Track</span>
                </div>
                <div className="lane-wave">
                  <WaveformLane
                    peaks={engine.peaks}
                    duration={state.duration}
                    position={state.position}
                    loop={state.loop}
                    pendingLoopStart={state.pendingLoopStart}
                    muted={state.muted}
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
            {state.error && (
              <div className="deck-error" role="alert" data-testid="deck-error">
                {state.error}
              </div>
            )}
          </div>

          <div className="console">
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
              <ScribbleStrip id="ch1" value={scribble} onChange={setScribble} />
            </div>

            <div className="master">
              <div className="mcol" style={{ flex: 0.9 }}>
                <div className="label">Tempo</div>
                <TempoFader
                  value={state.speed}
                  onChange={(pct) => engine.setSpeed(pct)}
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

      <div className="small-screen-notice">
        <strong>Woodshed is built for a desktop or laptop.</strong> It splits
        songs into stems, slows them down without changing pitch, and loops
        sections while you practise — all on your own machine, nothing
        uploaded. Come back on a bigger screen and bring your instrument.
      </div>
    </>
  );
}
