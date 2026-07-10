declare module "signalsmith-stretch" {
  export interface StretchSchedule {
    /** AudioContext time for this change. */
    output?: number;
    /** Whether the node is processing audio. */
    active?: boolean;
    /** Position in the input buffer, seconds. */
    input?: number;
    /** Playback rate; 0.5 is half speed (pitch preserved). */
    rate?: number;
    /** Pitch shift in semitones. */
    semitones?: number;
    tonalityHz?: number;
    formantSemitones?: number;
    formantCompensation?: boolean;
    formantBaseHz?: number;
    /** Auto-loop section of the input buffer; disabled when equal. */
    loopStart?: number;
    loopEnd?: number;
  }

  export interface StretchNode extends AudioWorkletNode {
    /** Current playback time within the input buffer, seconds. */
    inputTime: number;
    schedule(change: StretchSchedule): Promise<unknown>;
    start(when?: number): Promise<unknown>;
    stop(when?: number): Promise<unknown>;
    /** One typed array per channel, equal lengths. Returns the new input
     *  buffer end time in seconds. */
    addBuffers(buffers: Float32Array[]): Promise<number>;
    dropBuffers(toSeconds?: number): Promise<{ start: number; end: number }>;
    latency(): Promise<number>;
    configure(options: {
      blockMs?: number | null;
      intervalMs?: number;
      splitComputation?: boolean;
      preset?: "default" | "cheaper";
    }): Promise<unknown>;
    setUpdateInterval(
      seconds: number,
      callback?: (inputTime: number) => void,
    ): Promise<unknown>;
  }

  export default function SignalsmithStretch(
    audioContext: BaseAudioContext,
    channelOptions?: AudioWorkletNodeOptions,
  ): Promise<StretchNode>;
}
