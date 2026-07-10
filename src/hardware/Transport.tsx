import "./hardware.css";

export interface TransportProps {
  playing: boolean;
  loopEngaged: boolean;
  onPlayPause: () => void;
  onRewind: () => void;
  onLoopToggle: () => void;
}

/* Glyphs are inline SVG rather than unicode so Windows never substitutes
   emoji presentation (design spec section 10: no emoji anywhere). */
function RewindGlyph() {
  return (
    <svg width="15" height="12" viewBox="0 0 15 12" aria-hidden="true">
      <rect x="0" y="0" width="2.5" height="12" fill="currentColor" />
      <path d="M10 0 L3.5 6 L10 12 Z" fill="currentColor" />
      <path d="M15 0 L8.5 6 L15 12 Z" fill="currentColor" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
      <path d="M1 0 L16 9 L1 18 Z" fill="currentColor" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
      <rect x="1" y="0" width="4" height="16" fill="currentColor" />
      <rect x="9" y="0" width="4" height="16" fill="currentColor" />
    </svg>
  );
}

function LoopGlyph() {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
      <path
        d="M8 1 A6 6 0 1 0 14 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M10.5 0 L16 1.5 L12 5.5 Z" fill="currentColor" />
    </svg>
  );
}

/** 4.8 Transport: rewind, play/pause (56px amber), loop toggle plus loop
 *  lamp blinking at 1.6s steps while engaged. */
export function Transport({
  playing,
  loopEngaged,
  onPlayPause,
  onRewind,
  onLoopToggle,
}: TransportProps) {
  return (
    <div className="hw-transport">
      <button
        type="button"
        className="hw-tbtn"
        aria-label="Return to start"
        onClick={onRewind}
      >
        <RewindGlyph />
      </button>
      <button
        type="button"
        className="hw-tbtn hw-tbtn-play"
        aria-label={playing ? "Pause" : "Play"}
        onClick={onPlayPause}
      >
        {playing ? <PauseGlyph /> : <PlayGlyph />}
      </button>
      <button
        type="button"
        className={`hw-tbtn${loopEngaged ? " hw-tbtn-loop-on" : ""}`}
        aria-label="Toggle loop"
        aria-pressed={loopEngaged}
        onClick={onLoopToggle}
      >
        <LoopGlyph />
      </button>
      <span
        className={`hw-looplamp${loopEngaged ? " hw-looplamp-on" : ""}`}
        aria-hidden="true"
        data-testid="loop-lamp"
      />
    </div>
  );
}
