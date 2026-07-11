import { useEffect, useRef } from "react";
import type { LoopRegion } from "../audio/maths.ts";

export interface LaneOverlayProps {
  duration: number;
  /** Playhead position, seconds. */
  position: number;
  loop: LoopRegion | null;
  /** Armed first loop point awaiting its partner, seconds. */
  pendingLoopStart: number | null;
}

/** 4.9: the loop wash is drawn once across all lanes and a single 1.5px
 *  near-white playhead spans them. Sits absolutely over the lane column;
 *  pointer events pass through to the lanes beneath. The playhead moves by
 *  transform, never a repaint. */
export function LaneOverlay({
  duration,
  position,
  loop,
  pendingLoopStart,
}: LaneOverlayProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const head = headRef.current;
    if (!wrap || !head) return;
    const x = duration > 0 ? (position / duration) * wrap.clientWidth : 0;
    head.style.transform = `translateX(${x}px)`;
  }, [position, duration]);

  const pct = (seconds: number) =>
    duration > 0 ? (seconds / duration) * 100 : 0;

  return (
    <div ref={wrapRef} className="lane-overlay" aria-hidden="true">
      {loop && (
        <div
          data-testid="loop-region"
          className="lane-overlay-loop"
          style={{
            left: `${pct(loop.start)}%`,
            width: `${pct(loop.end - loop.start)}%`,
          }}
        />
      )}
      {pendingLoopStart !== null && !loop && (
        <div
          data-testid="loop-pending-marker"
          className="lane-overlay-pending"
          style={{ left: `${pct(pendingLoopStart)}%` }}
        />
      )}
      <div ref={headRef} data-testid="playhead" className="lane-overlay-playhead" />
    </div>
  );
}
