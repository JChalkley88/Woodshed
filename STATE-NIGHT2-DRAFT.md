# Draft skeleton for Night 2 STATE.md — benchmarks pending
(working notes, deleted before commit)

- shipped: separation pipeline, stem cache, resume, 4 stems on desk, cache rack
- tests: 79 unit + 10 e2e (incl. real integration 33s headless wasm)
- decisions:
  1. hand-rolled IDB wrapper (idb is ISC, constraint is MIT/BSD/Apache)
  2. incremental overlap-add finalising to Int16 per chunk (float working set = one overlap region)
  3. single 8-channel stretch node for sample-lock (one clock/rate/loop)
  4. AudioContext pinned 44.1kHz (decode = demucs = playback rate)
  5. partials quantised to 16-bit (identical reconstruction fresh vs resumed)
  6. worker storage-free; orchestrator owns IDB (mockable boundary)
  7. two-step EP creation (webgpu then wasm) so the running EP is always known
  8. auto-separation on load; single-track player stays live during separation
- known issues:
  - stem store size ~169MB per 4-min song (plan's 50MB estimate was optimistic; compression is a Night 3+ candidate)
  - solo absent by design (Night 3)
  - per-lane playheads (spec wants one spanning line; Night 3 polish)
- benchmarks: 4-min webgpu = ?, cache reopen = ?, 7-min memory = ?, wasm = ?
