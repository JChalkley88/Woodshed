import "./hardware.css";

export interface LEDMeterProps {
  /** Level 0..1, already ballistic-processed by the driver (see
   *  meterBallistics in audio/maths.ts). */
  level: number;
  label?: string;
}

const SEGMENTS = 14;

function segClass(index: number): string {
  // Segments are numbered 1..14 bottom-up: 1-9 green, 10-12 amber, 13-14 red.
  if (index >= 12) return "hw-seg hw-seg-red";
  if (index >= 9) return "hw-seg hw-seg-amber";
  return "hw-seg hw-seg-green";
}

/** 4.5 LED meter: 14 segments, bottom-up. Decorative for screen readers;
 *  the underlying value is exposed on the channel controls. */
export function LEDMeter({ level, label }: LEDMeterProps) {
  const lit = Math.round(Math.min(1, Math.max(0, level)) * SEGMENTS);
  return (
    <div className="hw-meter" aria-hidden="true" data-label={label}>
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <div key={i} className={i < lit ? segClass(i) : "hw-seg"} />
      ))}
    </div>
  );
}
