import { useCallback, useEffect, useRef } from "react";
import { clamp } from "../audio/maths.ts";

export interface SliderInteractionOptions {
  /** Current position, normalised 0..1 where 1 is maximum (top). */
  pos: number;
  onPos: (pos: number) => void;
  /** Pixels of pointer travel that cover the full range. */
  travelPx: number;
  /** Normalised step for wheel and arrow keys. */
  step: number;
  /** Normalised position to jump to on double-click. */
  resetPos: number;
}

/** Shared drag physics for knobs and faders: vertical 1:1 pointer tracking
 *  (drag up increases, zero easing), scroll-wheel steps, arrow keys when
 *  focused, double-click to reset. Spec sections 4.1 to 4.3 and 6. */
export function useSliderInteraction({
  pos,
  onPos,
  travelPx,
  step,
  resetPos,
}: SliderInteractionOptions) {
  const drag = useRef<{ startY: number; startPos: number } | null>(null);
  const posRef = useRef(pos);
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    (e.currentTarget as HTMLElement).focus();
    drag.current = { startY: e.clientY, startPos: posRef.current };
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current) return;
      const dy = drag.current.startY - e.clientY;
      onPos(clamp(drag.current.startPos + dy / travelPx, 0, 1));
    },
    [onPos, travelPx],
  );

  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const dir = e.deltaY < 0 ? 1 : -1;
      onPos(clamp(posRef.current + dir * step, 0, 1));
    },
    [onPos, step],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let dir = 0;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") dir = 1;
      if (e.key === "ArrowDown" || e.key === "ArrowLeft") dir = -1;
      if (e.key === "Home") {
        e.preventDefault();
        e.stopPropagation();
        return onPos(0);
      }
      if (e.key === "End") {
        e.preventDefault();
        e.stopPropagation();
        return onPos(1);
      }
      if (dir === 0) return;
      e.preventDefault();
      e.stopPropagation();
      onPos(clamp(posRef.current + dir * step, 0, 1));
    },
    [onPos, step],
  );

  const onDoubleClick = useCallback(() => onPos(resetPos), [onPos, resetPos]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    onKeyDown,
    onDoubleClick,
  };
}
