// Capability detection and honest degradation messaging (Night 5
// cross-browser pass). Every branch results in a hardware-styled message
// on the desk, never a broken page.

export interface Capabilities {
  /** AudioContext + AudioWorklet: without these nothing can play. */
  webAudio: boolean;
  /** WebAssembly: the separation fallback path. */
  wasm: boolean;
  /** WebGPU adapter API present (Chrome/Edge; often absent in Firefox). */
  webgpu: boolean;
  /** crossOriginIsolated: COOP/COEP served, so threaded WASM works.
   *  Absent means the CPU path runs single-threaded and slow (typical
   *  when hosting drops the headers; historically patchy in Safari). */
  threads: boolean;
}

export function detectCapabilities(): Capabilities {
  return {
    webAudio:
      typeof AudioContext !== "undefined" &&
      typeof AudioWorkletNode !== "undefined",
    wasm: typeof WebAssembly !== "undefined",
    webgpu:
      typeof navigator !== "undefined" &&
      Boolean((navigator as { gpu?: unknown }).gpu),
    threads: typeof crossOriginIsolated !== "undefined" && crossOriginIsolated,
  };
}

export interface CapabilityNotice {
  level: "blocked" | "degraded";
  message: string;
}

/** The honest message for this browser, or null on the full path. */
export function capabilityNotice(
  caps: Capabilities,
): CapabilityNotice | null {
  if (!caps.webAudio || !caps.wasm) {
    return {
      level: "blocked",
      message:
        "THIS BROWSER CANNOT RUN WOODSHED — IT NEEDS WEB AUDIO AND WEBASSEMBLY. A CURRENT CHROME, EDGE, FIREFOX, OR SAFARI WILL WORK.",
    };
  }
  if (!caps.webgpu && !caps.threads) {
    return {
      level: "degraded",
      message:
        "NO GPU ACCELERATION AND NO MULTI-THREADING HERE — SEPARATION WILL BE SLOW, THOUGH THE RESULT IS IDENTICAL. CHROME OR EDGE IS MUCH FASTER.",
    };
  }
  if (!caps.webgpu) {
    return {
      level: "degraded",
      message:
        "NO GPU ACCELERATION IN THIS BROWSER — SEPARATION RUNS ON THE PROCESSOR. SLOWER, SAME QUALITY.",
    };
  }
  if (!caps.threads) {
    return {
      level: "degraded",
      message:
        "THIS PAGE IS NOT CROSS-ORIGIN ISOLATED, SO SEPARATION RUNS SINGLE-THREADED. IF YOU ARE SELF-HOSTING, SERVE THE COOP AND COEP HEADERS.",
    };
  }
  return null;
}
