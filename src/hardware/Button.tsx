import "./hardware.css";

export interface HardwareButtonProps {
  label: string;
  /** Latched on/off state. */
  on: boolean;
  onChange: (on: boolean) => void;
  /** LED colour when latched: MUTE is red, SOLO is amber (spec 4.4). */
  led: "red" | "amber";
  ariaLabel?: string;
}

/** 4.4 Button: 34x26 extruded latching button with LED window. */
export function HardwareButton({
  label,
  on,
  onChange,
  led,
  ariaLabel,
}: HardwareButtonProps) {
  return (
    <button
      type="button"
      className={`hw-btn hw-btn-${led}${on ? " hw-btn-on" : ""}`}
      aria-pressed={on}
      aria-label={ariaLabel ?? label}
      onClick={() => onChange(!on)}
    >
      <span className="hw-btn-led" aria-hidden="true" />
      {label}
    </button>
  );
}
