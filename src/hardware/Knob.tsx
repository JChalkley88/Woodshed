import { clamp } from "../audio/maths.ts";
import { useSliderInteraction } from "./useSliderInteraction.ts";
import "./hardware.css";

export interface KnobProps {
  value: number;
  min: number;
  max: number;
  /** Double-click and initial reset value. */
  default: number;
  label: string;
  onChange: (value: number) => void;
  /** Value change per wheel/arrow step. Defaults to 1/20 of the range. */
  step?: number;
  /** Optional aria value text, e.g. "0 semitones". */
  valueText?: string;
}

const SWEEP = 270; // -135deg to +135deg
const TICK_COUNT = 11;

/** 4.1 Knob: 52px, vertical drag, double-click resets, wheel and arrow
 *  steps, 11-tick skirt. */
export function Knob(props: KnobProps) {
  const { value, min, max, label, onChange } = props;
  const range = max - min;
  const step = props.step ?? range / 20;
  const pos = range === 0 ? 0 : clamp((value - min) / range, 0, 1);
  const angle = -135 + SWEEP * pos;

  const interaction = useSliderInteraction({
    pos,
    onPos: (p) => onChange(min + p * range),
    travelPx: 150,
    step: step / range,
    resetPos: clamp((props.default - min) / range, 0, 1),
  });

  return (
    <div className="hw-knob-wrap">
      <div
        className="hw-knob"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value * 100) / 100}
        aria-valuetext={props.valueText}
        {...interaction}
      >
        <div className="hw-knob-skirt" aria-hidden="true">
          {Array.from({ length: TICK_COUNT }, (_, i) => (
            <div
              key={i}
              className="hw-knob-tick"
              style={{
                transform: `rotate(${-135 + i * 27}deg) translateY(-6px)`,
              }}
            />
          ))}
        </div>
        <div
          className="hw-knob-ind"
          style={{ transform: `rotate(${angle}deg)` }}
        />
      </div>
      <div className="label">{label}</div>
    </div>
  );
}
