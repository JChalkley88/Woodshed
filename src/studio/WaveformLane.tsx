import { useEffect, useRef } from "react";
import type { LoopRegion } from "../audio/maths.ts";

export interface WaveformLaneProps {
  /** Max-abs peaks from computePeaks. */
  peaks: Float32Array | null;
  duration: number;
  /** Loop region, used for the in/out-of-loop bar opacity states. */
  loop: LoopRegion | null;
  /** Silenced (muted or solo-excluded): bars dim to 0.16 per spec 4.9. */
  muted: boolean;
  /** CSS custom property holding the stem identity colour. */
  colourToken?: string;
  onSeek: (seconds: number) => void;
}

const BAR_WIDTH = 2;
const BAR_PITCH = 3;

/** 4.9 Waveform lane: 52px well, 2px bars at 3px pitch, canvas at 2x.
 *  Redraw only on data/loop/size changes. The playhead and loop wash are
 *  NOT drawn here: they live in LaneOverlay, drawn once across all lanes. */
export function WaveformLane({
  peaks,
  duration,
  loop,
  muted,
  colourToken = "--stem-vocals",
  onSeek,
}: WaveformLaneProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const draw = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w === 0) return;
      canvas.width = w * 2;
      canvas.height = h * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(2, 2);
      ctx.clearRect(0, 0, w, h);
      if (!peaks || duration === 0) return;

      const colour = getComputedStyle(wrap)
        .getPropertyValue(colourToken)
        .trim();
      const bars = Math.floor(w / BAR_PITCH);
      ctx.fillStyle = colour;
      for (let b = 0; b < bars; b++) {
        const t = b / bars;
        const peak = peaks[Math.min(peaks.length - 1, Math.floor(t * peaks.length))];
        const amp = Math.max(1, peak * (h * 0.48));
        const inLoop = loop ? t * duration >= loop.start && t * duration <= loop.end : true;
        ctx.globalAlpha = muted ? 0.16 : inLoop ? 0.95 : 0.45;
        ctx.fillRect(b * BAR_PITCH, h / 2 - amp, BAR_WIDTH, amp * 2);
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [peaks, duration, loop, muted, colourToken]);

  return (
    <div
      ref={wrapRef}
      data-testid="waveform-lane"
      data-silenced={muted}
      style={{
        position: "relative",
        height: 52,
        background: "var(--lane-face)",
        border: "1px solid var(--lane-edge)",
        borderRadius: 2,
        overflow: "hidden",
        cursor: duration > 0 ? "pointer" : "default",
      }}
      onPointerDown={(e) => {
        if (duration === 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - rect.left) / rect.width) * duration);
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
