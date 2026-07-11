// The Woodshed practice engine. Night 2: as well as the single loaded
// track, it plays four separated stems sample-locked through ONE
// Signalsmith Stretch AudioWorklet node configured for eight output
// channels (4 stems x stereo), split into per-stem gain/meter chains. A
// single worklet instance means stems can never drift: one clock, one
// rate, one loop state.
import SignalsmithStretch, { type StretchNode } from "signalsmith-stretch";
import { int16ToFloat32, namedStemRows } from "../separation/chunking.ts";
import {
  HTDEMUCS_OUTPUT_INDEX,
  N_CHANNELS,
  SAMPLE_RATE,
  STEM_NAMES,
  type StemName,
} from "../separation/constants.ts";
import {
  anySoloEngaged,
  clamp,
  dbToGain,
  isStemSilenced,
  meterBallistics,
  normaliseLoop,
  normalisePitch,
  rms,
  speedPercentToRate,
  type LoopRegion,
} from "./maths.ts";

export const ACCEPTED_EXTENSIONS = ["mp3", "wav", "m4a", "flac"] as const;

export interface StemStripState {
  gainDb: number;
  /** Explicit user mute; never rewritten by solo changes. */
  muted: boolean;
  /** Solo engaged on this strip; combined with mutes via isStemSilenced. */
  soloed: boolean;
  /** Meter level 0..1 with ballistics applied. */
  level: number;
}

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
  /** Pitch shift in semitones, -6 to +6; independent of tempo. */
  pitch: number;
  /** Single-track channel fader level in dB (single mode). */
  gainDb: number;
  muted: boolean;
  pendingLoopStart: number | null;
  loop: LoopRegion | null;
  /** Meter level for the single-track strip. */
  level: number;
  /** null in single-track mode; once stems are loaded, one strip per stem,
   *  keyed by name (never by tensor index). */
  stems: Record<StemName, StemStripState> | null;
}

const initialState: EngineState = {
  status: "empty",
  error: null,
  fileName: null,
  duration: 0,
  playing: false,
  position: 0,
  speed: 100,
  pitch: 0,
  gainDb: 0,
  muted: false,
  pendingLoopStart: null,
  loop: null,
  level: 0,
  stems: null,
};

type Listener = () => void;

export class PracticeEngine {
  private state: EngineState = initialState;
  private listeners = new Set<Listener>();
  private ctx: AudioContext | null = null;
  private stretch: StretchNode | null = null;
  private gainNodes: GainNode[] = [];
  private analysers: AnalyserNode[] = [];
  private meterBlock: Float32Array<ArrayBuffer> | null = null;
  private lastMeterTime = 0;
  /** Mixed-track waveform peaks. */
  peaks: Float32Array | null = null;
  /** Per-stem waveform peaks once separated, keyed by stem name. */
  stemPeaks: Record<StemName, Float32Array> | null = null;
  /** Decoded 44.1kHz stereo source, kept until separation completes. */
  private sourceChannels: [Float32Array, Float32Array] | null = null;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): EngineState => this.state;

  private set(partial: Partial<EngineState>) {
    this.state = { ...this.state, ...partial };
    for (const l of this.listeners) l();
  }

  /** Stereo source data for the separation pipeline (borrowed, not owned). */
  getSourceChannels(): [Float32Array, Float32Array] | null {
    return this.sourceChannels;
  }

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

      const left = buffer.getChannelData(0);
      const right =
        buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left.slice();
      this.sourceChannels = [left, right];
      this.peaks = computePeaks([left, right], 4096);
      this.stemPeaks = null;

      await this.buildGraph([left.slice(), right.slice()]);
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
        stems: null,
      });
      await this.applySchedule({ input: 0, active: false });
    } catch (err) {
      this.peaks = null;
      this.sourceChannels = null;
      this.set({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        fileName: null,
        duration: 0,
        playing: false,
        position: 0,
        loop: null,
        pendingLoopStart: null,
        stems: null,
      });
    }
  }

  /** Switch the loaded song to four separated stems (8 rows of 16-bit PCM,
   *  stem-major stereo pairs). Playback position, speed, loop, and playing
   *  state survive the switch. */
  async enterStemMode(rows: Int16Array[], totalSamples: number): Promise<void> {
    if (this.state.status !== "ready") return;
    const floats = rows.map((r) => int16ToFloat32(r));
    // Model output meets stem names exactly once, here, by named lookup.
    const named = namedStemRows(floats);
    const stemPeaks = {} as Record<StemName, Float32Array>;
    const stems = {} as Record<StemName, StemStripState>;
    for (const name of STEM_NAMES) {
      stemPeaks[name] = computePeaks(named[name], 4096);
      stems[name] = { gainDb: 0, muted: false, soloed: false, level: 0 };
    }
    this.stemPeaks = stemPeaks;
    const { position, playing, duration } = this.state;
    await this.buildGraph(floats);
    this.sourceChannels = null; // stems are the source of truth now
    this.set({
      stems,
      duration: Math.min(duration, totalSamples / SAMPLE_RATE),
    });
    this.applyStemGains();
    await this.applySchedule({
      input: clamp(position, 0, this.state.duration),
      active: playing,
    });
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      // Fixed 44.1kHz so decoded audio, the demucs graph, and stem playback
      // all share one sample rate (the browser resamples to the device).
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    return this.ctx;
  }

  /** (Re)builds the audio graph for the given rows: 2 rows = single track,
   *  8 rows = four stems through one 8-channel worklet, a splitter, and
   *  per-stem gain/analyser chains. */
  private async buildGraph(rows: Float32Array[]): Promise<void> {
    const ctx = await this.ensureContext();
    if (this.stretch) {
      try {
        await this.stretch.schedule({ active: false });
        await this.stretch.dropBuffers();
      } catch {
        // The old node is being discarded either way.
      }
      this.stretch.disconnect();
    }
    for (const node of [...this.gainNodes, ...this.analysers]) node.disconnect();
    this.gainNodes = [];
    this.analysers = [];

    const stretch = await SignalsmithStretch(ctx, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [rows.length],
    });
    await stretch.addBuffers(rows);

    const groups = rows.length / N_CHANNELS; // 1 or 4
    const splitter = ctx.createChannelSplitter(rows.length);
    stretch.connect(splitter);
    for (let g = 0; g < groups; g++) {
      const merger = ctx.createChannelMerger(N_CHANNELS);
      splitter.connect(merger, g * N_CHANNELS, 0);
      splitter.connect(merger, g * N_CHANNELS + 1, 1);
      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      merger.connect(gain);
      gain.connect(analyser);
      analyser.connect(ctx.destination);
      this.gainNodes.push(gain);
      this.analysers.push(analyser);
    }
    this.meterBlock = new Float32Array(2048);
    stretch.setUpdateInterval(0.05, (t) => this.onTime(t));
    this.stretch = stretch;
    this.applyAllGains();
  }

  private onTime(inputTime: number) {
    const { duration, playing, loop } = this.state;
    if (!playing) return;
    const position = clamp(inputTime, 0, duration || inputTime);
    if (!loop && duration > 0 && inputTime >= duration) {
      void this.pause();
      this.set({ position: duration });
      return;
    }
    this.set({ position, ...this.nextMeterLevels() });
  }

  private nextMeterLevels(): Partial<EngineState> {
    if (!this.meterBlock || this.analysers.length === 0) return {};
    const now = performance.now();
    const interval = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 250
      : 25;
    if (now - this.lastMeterTime < interval) return {};
    this.lastMeterTime = now;

    if (this.state.stems) {
      const anySolo = anySoloEngaged(Object.values(this.state.stems));
      const stems = {} as Record<StemName, StemStripState>;
      for (const name of STEM_NAMES) {
        const strip = this.state.stems[name];
        this.analysers[HTDEMUCS_OUTPUT_INDEX[name]].getFloatTimeDomainData(
          this.meterBlock!,
        );
        const target = isStemSilenced(strip, anySolo)
          ? 0
          : clamp(rms(this.meterBlock!) * 2.2, 0, 1);
        stems[name] = { ...strip, level: meterBallistics(strip.level, target) };
      }
      return { stems };
    }
    this.analysers[0].getFloatTimeDomainData(this.meterBlock);
    const target = this.state.muted ? 0 : clamp(rms(this.meterBlock) * 2.2, 0, 1);
    return { level: meterBallistics(this.state.level, target) };
  }

  private async applySchedule(extra: Record<string, number | boolean> = {}) {
    if (!this.stretch) return;
    const { loop, speed, pitch } = this.state;
    await this.stretch.schedule({
      rate: speedPercentToRate(speed),
      // Pitch and rate are independent in signalsmith-stretch; one shared
      // node keeps all stems shifted in sync.
      semitones: pitch,
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
    await this.applySchedule({ active: true, input: from });
    this.set({ playing: true, position: from });
  }

  async pause(): Promise<void> {
    if (!this.stretch) return;
    await this.stretch.schedule({ active: false });
    this.set({
      playing: false,
      level: 0,
      stems: this.state.stems ? mapStems(this.state.stems, (s) => ({ ...s, level: 0 })) : null,
    });
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

  setPitch(semitones: number): void {
    const pitch = normalisePitch(semitones);
    this.set({ pitch });
    void this.applySchedule();
  }

  /* -------- Single-track strip -------- */
  setGainDb(db: number): void {
    this.set({ gainDb: db });
    this.applyAllGains();
  }

  setMuted(muted: boolean): void {
    this.set({ muted });
    this.applyAllGains();
  }

  /* -------- Stem strips (addressed by name, never by tensor index) -------- */
  setStemGainDb(name: StemName, db: number): void {
    if (!this.state.stems) return;
    const stems = {
      ...this.state.stems,
      [name]: { ...this.state.stems[name], gainDb: db },
    };
    this.set({ stems });
    this.applyStemGains();
  }

  setStemMuted(name: StemName, muted: boolean): void {
    if (!this.state.stems) return;
    const stems = {
      ...this.state.stems,
      [name]: { ...this.state.stems[name], muted },
    };
    this.set({ stems });
    this.applyStemGains();
  }

  setStemSoloed(name: StemName, soloed: boolean): void {
    if (!this.state.stems) return;
    const stems = {
      ...this.state.stems,
      [name]: { ...this.state.stems[name], soloed },
    };
    this.set({ stems });
    this.applyStemGains();
  }

  private applyAllGains() {
    if (this.state.stems) this.applyStemGains();
    else if (this.gainNodes[0] && this.ctx) {
      const { muted, gainDb } = this.state;
      this.gainNodes[0].gain.setTargetAtTime(
        muted ? 0 : dbToGain(gainDb),
        this.ctx.currentTime,
        0.01,
      );
    }
  }

  private applyStemGains() {
    if (!this.state.stems || !this.ctx) return;
    const anySolo = anySoloEngaged(Object.values(this.state.stems));
    for (const name of STEM_NAMES) {
      const strip = this.state.stems[name];
      this.gainNodes[HTDEMUCS_OUTPUT_INDEX[name]]?.gain.setTargetAtTime(
        isStemSilenced(strip, anySolo) ? 0 : dbToGain(strip.gainDb),
        this.ctx.currentTime,
        0.01,
      );
    }
  }

  /* -------- Loop -------- */
  async tapLoopPoint(): Promise<void> {
    const { status, position, pendingLoopStart, loop, duration } = this.state;
    if (status !== "ready") return;
    if (loop) return this.clearLoop();
    if (pendingLoopStart === null) {
      this.set({ pendingLoopStart: position });
      return;
    }
    const region = normaliseLoop(pendingLoopStart, position, duration);
    if (!region) return;
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

  async setLoop(a: number, b: number): Promise<void> {
    const region = normaliseLoop(a, b, this.state.duration);
    if (!region) return;
    this.set({ loop: region, pendingLoopStart: null });
    await this.applySchedule();
  }
}

/** Applies fn to every strip in a stem record, preserving name keys. */
function mapStems(
  stems: Record<StemName, StemStripState>,
  fn: (strip: StemStripState, name: StemName) => StemStripState,
): Record<StemName, StemStripState> {
  const out = {} as Record<StemName, StemStripState>;
  for (const name of STEM_NAMES) out[name] = fn(stems[name], name);
  return out;
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
