// The Woodshed practice engine. One loaded track tonight; stems arrive on
// Night 2. Playback runs through the Signalsmith Stretch AudioWorklet
// (MIT), which gives pitch-preserved time-stretch and sample-accurate
// looping inside the worklet itself.
import SignalsmithStretch, { type StretchNode } from "signalsmith-stretch";
import {
  clamp,
  dbToGain,
  meterBallistics,
  normaliseLoop,
  rms,
  speedPercentToRate,
  type LoopRegion,
} from "./maths.ts";

export const ACCEPTED_EXTENSIONS = ["mp3", "wav", "m4a", "flac"] as const;

export interface EngineState {
  status: "empty" | "loading" | "ready" | "error";
  error: string | null;
  fileName: string | null;
  duration: number;
  playing: boolean;
  /** Playhead position in source-time seconds. */
  position: number;
  /** Tempo percentage, 50 to 120. */
  speed: number;
  /** Channel fader level in dB. */
  gainDb: number;
  muted: boolean;
  /** First tapped loop point awaiting its partner, seconds. */
  pendingLoopStart: number | null;
  loop: LoopRegion | null;
  /** Meter level 0..1 with ballistics applied. */
  level: number;
}

const initialState: EngineState = {
  status: "empty",
  error: null,
  fileName: null,
  duration: 0,
  playing: false,
  position: 0,
  speed: 100,
  gainDb: 0,
  muted: false,
  pendingLoopStart: null,
  loop: null,
  level: 0,
};

type Listener = () => void;

export class PracticeEngine {
  private state: EngineState = initialState;
  private listeners = new Set<Listener>();
  private ctx: AudioContext | null = null;
  private stretch: StretchNode | null = null;
  private gainNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private meterBlock: Float32Array<ArrayBuffer> | null = null;
  private lastMeterTime = 0;
  /** Waveform peaks (max abs per bucket), computed at decode time. */
  peaks: Float32Array | null = null;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): EngineState => this.state;

  private set(partial: Partial<EngineState>) {
    this.state = { ...this.state, ...partial };
    for (const l of this.listeners) l();
  }

  /** Decode and load a file. Friendly errors for unsupported or corrupt
   *  input; previous track (if any) keeps playing until decode succeeds. */
  async loadFile(file: File): Promise<void> {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ACCEPTED_EXTENSIONS.includes(ext as (typeof ACCEPTED_EXTENSIONS)[number])) {
      this.set({
        status: this.state.fileName ? "ready" : "empty",
        error: `${file.name} is not a supported format. Woodshed reads mp3, wav, m4a, and flac.`,
      });
      return;
    }
    this.set({ status: "loading", error: null });
    try {
      const ctx = await this.ensureContext();
      const arrayBuffer = await file.arrayBuffer();
      let buffer: AudioBuffer;
      try {
        buffer = await ctx.decodeAudioData(arrayBuffer);
      } catch {
        throw new Error(
          `Couldn't decode ${file.name}. The file may be corrupt or use a codec this browser can't read.`,
        );
      }
      if (buffer.duration < 0.25) {
        throw new Error(`${file.name} is too short to practise with.`);
      }

      // Peaks must be computed before handing the channel data to the
      // worklet, and the worklet gets copies so the transfer can't detach
      // the originals.
      const channels: Float32Array[] = [];
      for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) {
        channels.push(buffer.getChannelData(c));
      }
      this.peaks = computePeaks(channels, 4096);

      const stretch = await this.ensureStretch(ctx);
      await stretch.schedule({ active: false });
      await stretch.dropBuffers();
      await stretch.addBuffers(channels.map((c) => c.slice()));

      this.set({
        status: "ready",
        error: null,
        fileName: file.name,
        duration: buffer.duration,
        playing: false,
        position: 0,
        pendingLoopStart: null,
        loop: null,
        level: 0,
      });
      await this.applySchedule({ input: 0 });
    } catch (err) {
      this.peaks = null;
      this.set({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        fileName: null,
        duration: 0,
        playing: false,
        position: 0,
        loop: null,
        pendingLoopStart: null,
      });
    }
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    return this.ctx;
  }

  private async ensureStretch(ctx: AudioContext): Promise<StretchNode> {
    if (this.stretch) return this.stretch;
    const stretch = await SignalsmithStretch(ctx);
    this.gainNode = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.meterBlock = new Float32Array(this.analyser.fftSize);
    stretch.connect(this.gainNode);
    this.gainNode.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    stretch.setUpdateInterval(0.05, (inputTime) => this.onTime(inputTime));
    this.stretch = stretch;
    return stretch;
  }

  private onTime(inputTime: number) {
    const { duration, playing, loop } = this.state;
    if (!playing) return;
    const position = clamp(inputTime, 0, duration || inputTime);
    // Track finished (the worklet plays silence past the buffer end).
    if (!loop && duration > 0 && inputTime >= duration) {
      void this.pause();
      this.set({ position: duration });
      return;
    }
    this.set({ position, level: this.nextMeterLevel() });
  }

  private nextMeterLevel(): number {
    if (!this.analyser || !this.meterBlock) return 0;
    const now = performance.now();
    // Spec section 6: ~30fps meters, dropped to 4fps under reduced motion.
    const interval = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 250
      : 25;
    if (now - this.lastMeterTime < interval) return this.state.level;
    this.lastMeterTime = now;
    this.analyser.getFloatTimeDomainData(this.meterBlock);
    // Scale RMS so a full-scale sine reads near the top of the meter.
    const target = this.state.muted
      ? 0
      : clamp(rms(this.meterBlock) * 2.2, 0, 1);
    return meterBallistics(this.state.level, target);
  }

  private async applySchedule(extra: Record<string, number | boolean> = {}) {
    if (!this.stretch) return;
    const { loop, speed } = this.state;
    await this.stretch.schedule({
      rate: speedPercentToRate(speed),
      loopStart: loop ? loop.start : 0,
      loopEnd: loop ? loop.end : 0,
      ...extra,
    });
  }

  async playPause(): Promise<void> {
    if (this.state.playing) return this.pause();
    return this.play();
  }

  async play(): Promise<void> {
    if (this.state.status !== "ready" || !this.stretch) return;
    await this.ensureContext();
    let from = this.state.position;
    if (this.state.duration > 0 && from >= this.state.duration) from = 0;
    // Playing from outside an engaged loop is allowed; the loop catches the
    // playhead when it arrives (matches tape-machine behaviour).
    await this.applySchedule({ active: true, input: from });
    this.set({ playing: true, position: from });
  }

  async pause(): Promise<void> {
    if (!this.stretch) return;
    await this.stretch.schedule({ active: false });
    this.set({ playing: false, level: 0 });
  }

  async seek(seconds: number): Promise<void> {
    if (this.state.status !== "ready") return;
    const position = clamp(seconds, 0, this.state.duration);
    await this.applySchedule({ input: position });
    this.set({ position });
  }

  async seekBy(deltaSeconds: number): Promise<void> {
    return this.seek(this.state.position + deltaSeconds);
  }

  async rewind(): Promise<void> {
    return this.seek(this.state.loop ? this.state.loop.start : 0);
  }

  setSpeed(percent: number): void {
    const speed = clamp(Math.round(percent), 50, 120);
    this.set({ speed });
    void this.applySchedule();
  }

  setGainDb(db: number): void {
    this.set({ gainDb: db });
    this.applyGain();
  }

  setMuted(muted: boolean): void {
    this.set({ muted });
    this.applyGain();
  }

  private applyGain() {
    if (!this.gainNode || !this.ctx) return;
    const { muted, gainDb } = this.state;
    const target = muted ? 0 : dbToGain(gainDb);
    this.gainNode.gain.setTargetAtTime(target, this.ctx.currentTime, 0.01);
  }

  /** The L key: first tap arms a loop start at the playhead, second tap
   *  completes and engages the loop, a tap with a loop engaged clears it. */
  async tapLoopPoint(): Promise<void> {
    const { status, position, pendingLoopStart, loop, duration } = this.state;
    if (status !== "ready") return;
    if (loop) return this.clearLoop();
    if (pendingLoopStart === null) {
      this.set({ pendingLoopStart: position });
      return;
    }
    const region = normaliseLoop(pendingLoopStart, position, duration);
    if (!region) return; // too short to loop; keep the pending point armed
    this.set({ loop: region, pendingLoopStart: null });
    await this.applySchedule();
  }

  async toggleLoop(): Promise<void> {
    return this.tapLoopPoint();
  }

  async clearLoop(): Promise<void> {
    this.set({ loop: null, pendingLoopStart: null });
    await this.applySchedule();
  }

  /** Set the loop directly (waveform drag / tests). */
  async setLoop(a: number, b: number): Promise<void> {
    const region = normaliseLoop(a, b, this.state.duration);
    if (!region) return;
    this.set({ loop: region, pendingLoopStart: null });
    await this.applySchedule();
  }
}

/** Max-abs peak per bucket across channels; pure and unit-testable. */
export function computePeaks(
  channels: Float32Array[],
  buckets: number,
): Float32Array {
  const out = new Float32Array(buckets);
  if (channels.length === 0 || channels[0].length === 0) return out;
  const len = channels[0].length;
  const perBucket = len / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * perBucket);
    const end = Math.min(len, Math.max(start + 1, Math.floor((b + 1) * perBucket)));
    let peak = 0;
    for (const ch of channels) {
      for (let i = start; i < end; i++) {
        const v = Math.abs(ch[i]);
        if (v > peak) peak = v;
      }
    }
    out[b] = peak;
  }
  return out;
}

export const engine = new PracticeEngine();
