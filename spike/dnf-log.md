# Spike run history — recorded results, including DNFs

All on: Windows 11, Intel Xe-LPG integrated GPU (Meteor Lake era), 14
threads, 16GB RAM, Chrome 150, crossOriginIsolated=true, onnxruntime-web
1.27.0, models served same-origin, ORT runtime served locally from /ort.

## Run 1 (uninstrumented, 30 min timeout)
- fp16-webgpu, fp16-wasm (8 threads), fp32-webgpu: all appeared hung at
  `InferenceSession.create`; no per-run visibility. Whole run timed out.

## Run 2 (8-minute silent watchdog per benchmark)
- fp16-webgpu — DNF: no progress in 8 minutes during session creation.
- fp16-wasm (8 threads) — DNF: no progress in 8 minutes during session creation.
- fp32-webgpu — killed with the run; same pattern at abandonment.

## Run 3 (heartbeat instrumentation, fresh worker per row)
- fp16-wasm-1thread — FAILED in 12s: "Can't create a session. ERROR_CODE: 6,
  ERROR_MESSAGE: std::bad_alloc" (WASM heap exhausted parsing/optimising the
  166MB fp16 model with graphOptimizationLevel "all", model passed as bytes).
- fp16-webgpu — **DNF: session creation abandoned at 705s+** (heartbeats
  confirmed the call was alive, never resolved; worker had the hardware
  WebGPU adapter: "intel xe-lpg"). Recorded as a result, not a gap: on this
  machine fp16 htdemucs session creation on WebGPU does not complete in any
  usable time.
