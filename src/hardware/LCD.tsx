import type { ReactNode } from "react";
import "./hardware.css";

export interface LCDProps {
  /** time: 30px counter. readout: 14px tempo/pitch. loop: 12px two lines.
   *  chords: 15px chip row (children should be LCDChord elements). */
  variant?: "time" | "readout" | "loop" | "chords";
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
}

/** 4.6 LCD: recessed green-on-black display in Share Tech Mono. */
export function LCD({
  variant = "readout",
  children,
  ariaLabel,
  className,
}: LCDProps) {
  return (
    <div
      className={`hw-lcd hw-lcd-${variant}${className ? ` ${className}` : ""}`}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

export interface LCDChordProps {
  state?: "past" | "now" | "next";
  children: ReactNode;
}

/** A chord chip inside an LCD chords variant. Chords render as written
 *  (Dm7, Bb), never uppercase-forced. */
export function LCDChord({ state = "next", children }: LCDChordProps) {
  const cls =
    state === "now"
      ? "hw-chord hw-chord-now"
      : state === "past"
        ? "hw-chord hw-chord-past"
        : "hw-chord";
  return <div className={cls}>{children}</div>;
}
