import {
  clamp,
  dbToFaderPos,
  faderPosToDb,
  formatDb,
  SPEED_MAX,
  SPEED_MIN,
} from "../audio/maths.ts";
import { useSliderInteraction } from "./useSliderInteraction.ts";
import "./hardware.css";

/* ---------------- 4.2 Channel fader ---------------- */

const CHANNEL_THROW = 190;
const CHANNEL_CAP = 44;
const DB_SCALE = ["+10", "+5", "0", "-5", "-10", "-20", "-40", "-∞"];

export interface FaderProps {
  /** Level in dB; -Infinity (or the floor) is silence. */
  value: number;
  label: string;
  onChange: (db: number) => void;
}

/** Channel fader: 190px throw, audio-taper dB scale, double-click to unity. */
export function Fader({ value, label, onChange }: FaderProps) {
  const pos = dbToFaderPos(value);
  const interaction = useSliderInteraction({
    pos,
    onPos: (p) => onChange(faderPosToDb(p)),
    travelPx: CHANNEL_THROW - CHANNEL_CAP,
    step: 1 / 28, // roughly 1dB around unity
    resetPos: dbToFaderPos(0),
  });
  const capTop = (1 - pos) * (CHANNEL_THROW - CHANNEL_CAP);

  return (
    <div className="hw-fader" style={{ height: CHANNEL_THROW }}>
      <div className="hw-fader-scale" aria-hidden="true">
        {DB_SCALE.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div
        className="hw-fader-slot"
        role="slider"
        tabIndex={0}
        aria-label={`${label} fader`}
        aria-valuemin={-72}
        aria-valuemax={10}
        aria-valuenow={value === -Infinity ? -72 : Math.round(value * 10) / 10}
        aria-valuetext={`${formatDb(value)} decibels`}
        {...interaction}
      >
        <div className="hw-fader-cap" style={{ top: capTop }} />
      </div>
    </div>
  );
}

/* ---------------- 4.3 Tempo fader (master) ---------------- */

const TEMPO_THROW = 230;
const TEMPO_CAP = 30;
const TEMPO_SCALE = ["120", "110", "100", "90", "80", "70", "60", "50"];

export interface TempoFaderProps {
  /** Speed percentage, 50 to 120. */
  value: number;
  onChange: (percent: number) => void;
}

/** Master tempo fader: 230px throw, amber scored cap, machined zero line at
 *  100%. Direct 1:1 tracking, no easing. */
export function TempoFader({ value, onChange }: TempoFaderProps) {
  const range = SPEED_MAX - SPEED_MIN;
  const pos = clamp((value - SPEED_MIN) / range, 0, 1);
  const interaction = useSliderInteraction({
    pos,
    onPos: (p) => onChange(Math.round(SPEED_MIN + p * range)),
    travelPx: TEMPO_THROW - TEMPO_CAP,
    step: 1 / range,
    resetPos: (100 - SPEED_MIN) / range,
  });
  const capTop = (1 - pos) * (TEMPO_THROW - TEMPO_CAP);
  // Zero line marks 100%: the cap centre sits here when value is 100.
  const zeroTop =
    (1 - (100 - SPEED_MIN) / range) * (TEMPO_THROW - TEMPO_CAP) + TEMPO_CAP / 2;

  return (
    <div className="hw-fader hw-fader-tempo" style={{ height: TEMPO_THROW }}>
      <div className="hw-fader-scale" aria-hidden="true">
        {TEMPO_SCALE.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <div
        className="hw-fader-slot"
        role="slider"
        tabIndex={0}
        aria-label="Tempo"
        aria-valuemin={SPEED_MIN}
        aria-valuemax={SPEED_MAX}
        aria-valuenow={Math.round(value)}
        aria-valuetext={`${Math.round(value)} percent speed`}
        {...interaction}
      >
        <div className="hw-fader-zero" style={{ top: zeroTop }} />
        <div className="hw-fader-cap" style={{ top: capTop }} />
      </div>
    </div>
  );
}
