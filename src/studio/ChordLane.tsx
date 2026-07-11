import { useEffect, useRef } from "react";
import type { ChordSegment } from "../analysis/chords.ts";
import { N_LABEL } from "../analysis/chords.ts";
import { LCD, LCDChord } from "../hardware/index.ts";

export interface ChordLaneProps {
  segments: ChordSegment[];
  /** Playhead position, seconds. */
  position: number;
  onSeek: (seconds: number) => void;
}

/** The deck's chord lane (spec section 5 slot, 4.6 LCD chord treatment):
 *  past chords dimmed, the current chord full-bright with outline,
 *  upcoming dim. Tapping a chord seeks to its start. Chips scroll
 *  horizontally and the view follows the current chord. */
export function ChordLane({ segments, position, onSeek }: ChordLaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentIndex = segments.findIndex(
    (s) => position >= s.start && position < s.end,
  );

  useEffect(() => {
    const wrap = scrollRef.current;
    if (!wrap || currentIndex < 0) return;
    const chip = wrap.children[currentIndex] as HTMLElement | undefined;
    if (!chip) return;
    const target =
      chip.offsetLeft - wrap.clientWidth / 2 + chip.clientWidth / 2;
    wrap.scrollTo({ left: Math.max(0, target) });
  }, [currentIndex]);

  return (
    <div className="chordlane" data-testid="chord-lane">
      <LCD variant="chords" ariaLabel="Chord lane" className="chordlane-lcd">
        <div className="chordlane-scroll" ref={scrollRef}>
          {segments.map((seg, i) => (
            <button
              type="button"
              key={`${seg.start}-${seg.label}`}
              className="chordlane-chip"
              data-testid="chord-chip"
              data-state={
                i === currentIndex ? "now" : seg.end <= position ? "past" : "next"
              }
              aria-label={`Seek to ${seg.label === N_LABEL ? "rest" : seg.label} at ${seg.start.toFixed(1)} seconds`}
              onClick={() => onSeek(seg.start)}
            >
              <LCDChord
                state={
                  i === currentIndex
                    ? "now"
                    : seg.end <= position
                      ? "past"
                      : "next"
                }
              >
                {seg.label === N_LABEL ? "·" : seg.label}
              </LCDChord>
            </button>
          ))}
        </div>
      </LCD>
    </div>
  );
}
