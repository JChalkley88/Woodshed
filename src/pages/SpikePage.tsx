import { useCallback, useEffect, useRef, useState } from "react";
import type { SpikeRequest, SpikeResult } from "../spike/spike.worker.ts";

// Dev-only benchmark harness. The three runs the Night 1 brief asks for:
// fp16 on WebGPU, fp16 on WASM, fp32 on WebGPU. Each run gets a fresh
// worker so EP state and heap are isolated. The product itself (Night 2)
// will create sessions with ["webgpu", "wasm"] so WebGPU is tried first
// with WASM fallback; the spike pins each EP to get clean comparisons.
// fp32 rows run first: fp16 weight handling is a plausible cause of the
// earlier failures (std::bad_alloc, non-terminating session creation), so
// fp32 is the more important data point. Rows whose session creation fails
// are retried once with graphOptimizationLevel "disabled".
const BENCHMARKS: SpikeRequest[] = [
  {
    label: "fp32-webgpu",
    modelUrl: "/models/htdemucs.onnx",
    eps: ["webgpu"],
  },
  {
    label: "fp32-wasm",
    modelUrl: "/models/htdemucs.onnx",
    eps: ["wasm"],
  },
  {
    label: "fp16-webgpu",
    modelUrl: "/models/htdemucs_fp16weights.onnx",
    eps: ["webgpu"],
  },
  {
    label: "fp16-wasm",
    modelUrl: "/models/htdemucs_fp16weights.onnx",
    eps: ["wasm"],
  },
];

interface Environment {
  userAgent: string;
  hardwareConcurrency: number;
  deviceMemoryGB: number | null;
  crossOriginIsolated: boolean;
  webgpuAdapter: string | null;
}

declare global {
  interface Window {
    __SPIKE_RESULTS__?: { env: Environment; results: SpikeResult[] };
  }
}

async function collectEnvironment(): Promise<Environment> {
  let adapter: string | null = null;
  try {
    const gpu = navigator.gpu;
    if (gpu) {
      const a = await gpu.requestAdapter();
      if (a) {
        const info = a.info;
        adapter = [info.vendor, info.architecture, info.device, info.description]
          .filter(Boolean)
          .join(" / ");
      }
    }
  } catch {
    adapter = null;
  }
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGB:
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    crossOriginIsolated: window.crossOriginIsolated,
    webgpuAdapter: adapter,
  };
}

export default function SpikePage() {
  const [log, setLog] = useState<string[]>([]);
  const [results, setResults] = useState<SpikeResult[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const startedRef = useRef(false);

  const append = (line: string) =>
    setLog((l) => [...l, `${new Date().toISOString().slice(11, 19)} ${line}`]);

  const run = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setRunning(true);
    const env = await collectEnvironment();
    append(`webgpu adapter: ${env.webgpuAdapter ?? "NONE"}`);
    append(`crossOriginIsolated: ${env.crossOriginIsolated}, threads: ${env.hardwareConcurrency}`);
    const collected: SpikeResult[] = [];
    // Probe overrides: ?only=<label-prefix>&optoff=1&createTimeout=<ms>
    const params = new URLSearchParams(window.location.search);
    const only = params.get("only");
    const createTimeout = params.get("createTimeout");
    const queue: SpikeRequest[] = BENCHMARKS.filter(
      (b) => !only || b.label.startsWith(only),
    ).map((b) => ({
      ...b,
      ...(params.get("optoff") === "1"
        ? { label: `${b.label}-optoff`, graphOptimizationLevel: "disabled" as const }
        : {}),
      ...(createTimeout ? { createTimeoutMs: Number(createTimeout) } : {}),
    }));
    while (queue.length > 0) {
      const bench = queue.shift()!;
      append(`starting ${bench.label}`);
      const result = await new Promise<SpikeResult>((resolve) => {
        const worker = new Worker(
          new URL("../spike/spike.worker.ts", import.meta.url),
          { type: "module" },
        );
        // Watchdog: a hung EP (e.g. WebGPU device never resolving) must not
        // stall the whole spike. Any progress message resets the clock.
        const WATCHDOG_MS = 8 * 60 * 1000;
        const fail = (error: string) => {
          worker.terminate();
          resolve({
            label: bench.label,
            modelUrl: bench.modelUrl,
            eps: bench.eps,
            ok: false,
            error,
          });
        };
        let watchdog = setTimeout(
          () => fail(`watchdog: no progress for ${WATCHDOG_MS / 60000} minutes`),
          WATCHDOG_MS,
        );
        worker.onmessage = (e) => {
          clearTimeout(watchdog);
          if (e.data.type === "progress") {
            append(e.data.payload as string);
            watchdog = setTimeout(
              () =>
                fail(`watchdog: no progress for ${WATCHDOG_MS / 60000} minutes`),
              WATCHDOG_MS,
            );
          }
          if (e.data.type === "result") {
            worker.terminate();
            resolve(e.data.payload as SpikeResult);
          }
        };
        worker.onerror = (e) => {
          clearTimeout(watchdog);
          fail(`worker error: ${e.message}`);
        };
        worker.postMessage(bench);
      });
      collected.push(result);
      setResults([...collected]);
      append(
        result.ok
          ? `${bench.label}: steady-state ${result.steadyStateMs}ms for ${result.chunkSeconds}s chunk`
          : `${bench.label}: FAILED — ${result.error ?? "no error captured"}`,
      );
      // Failed session creation gets one retry with graph optimisation off,
      // which lowers the optimiser's peak memory.
      if (!result.ok && (bench.graphOptimizationLevel ?? "all") === "all") {
        queue.unshift({
          ...bench,
          label: `${bench.label}-optoff`,
          graphOptimizationLevel: "disabled",
        });
        append(`queueing ${bench.label}-optoff retry`);
      }
    }
    window.__SPIKE_RESULTS__ = { env, results: collected };
    setRunning(false);
    setDone(true);
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("autorun") === "1") {
      const id = setTimeout(() => void run(), 0);
      return () => clearTimeout(id);
    }
  }, [run]);

  return (
    <main className="mx-auto max-w-4xl p-8" style={{ color: "var(--engrave)" }}>
      <h1 className="label mb-4" style={{ fontSize: 14 }}>
        Separation spike — Night 1
      </h1>
      <p className="mb-4" style={{ fontSize: 13, color: "var(--engrave-dim)" }}>
        Dev-only harness. Runs a test chunk through htdemucs fp16 (WebGPU,
        WASM) and fp32 (WebGPU) and records timings, memory, and output
        sanity. Models are served from the local gitignored /models folder.
      </p>
      <button
        type="button"
        className="hw-btn"
        style={{ width: "auto", padding: "4px 16px", height: 30 }}
        disabled={running}
        onClick={() => void run()}
        data-testid="spike-run"
      >
        {running ? "RUNNING" : done ? "DONE" : "RUN SPIKE"}
      </button>
      <pre
        className="mt-6 overflow-x-auto p-4"
        style={{
          background: "var(--well)",
          fontFamily: "var(--font-lcd)",
          fontSize: 12,
          color: "var(--lcd-fg)",
          minHeight: 120,
        }}
        data-testid="spike-log"
      >
        {log.join("\n")}
      </pre>
      <pre
        className="mt-4 overflow-x-auto p-4"
        style={{
          background: "var(--well)",
          fontFamily: "var(--font-lcd)",
          fontSize: 11,
          color: "var(--engrave)",
        }}
        data-testid="spike-results"
        data-done={done ? "1" : "0"}
      >
        {JSON.stringify(results, null, 2)}
      </pre>
    </main>
  );
}
