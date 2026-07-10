# NIGHT-2-BRIEF.md — Woodshed, Night 2 of 5

You are running Night 2 of a five-night one-shot autonomous build. Work through the whole brief without stopping to ask questions; make sensible decisions, record them, and keep going. British English throughout, no em dashes.

## Decision context (read before anything else)

The daylight gate after Night 1 succeeded. The confirmed call, made by Jack, is **GO with htdemucs 4-stem fp16 as the one and only separation path for v1**. The plan's original 90-second criterion is superseded: separation is a one-time, cached, honestly-presented import cost (~6.5 minutes for a 4-minute song on this machine's iGPU, faster on better hardware), not a blocking wait. Do NOT implement Open-Unmix or any 2-stem path tonight. A fast-preview hybrid is a v1.1 candidate only.

## Read first, in this order

1. `STATE.md`, especially "Daylight gate results" — the working ORT recipe in there is law
2. `practice-studio-build-plan.md` (Night 2 section)
3. `woodshed-design-spec.md` sections 4, 5, and 7 (stem lanes, strips, and the separation progress state)
4. `spike/gate0-results.json` and the spike worker source — reuse its session code, do not rewrite it

## The ORT recipe (non-negotiable, from the gate)

- onnxruntime-web 1.27.0 (unless the daylight tasks below change the pin; check STATE.md for updates before assuming)
- Session creation: `numThreads = 1`, `graphOptimizationLevel: "disabled"`, model loaded **by URL**, never by bytes
- After creation succeeds, raise `numThreads` to `min(4, hardwareConcurrency)` before first inference on the WASM path (thread pool initialises lazily)
- Execution providers `["webgpu", "wasm"]`, WebGPU first, and record which one actually ran
- Model: `models/htdemucs_fp16_preopt.onnx` (updated after the daylight follow-ups, 10 Jul: offline basic-level pre-optimised copy — session create 2.3s vs 40s, steady-state 7.96s vs 9.31s per chunk on WebGPU. Trade-off recorded in STATE.md: the optimiser folds the fp16 weights to fp32, so the file is 345MB vs 166MB; if R2 download size ends up mattering more than the one-time 40s create, `models/htdemucs_fp16weights.onnx` remains valid with the identical recipe)
- The graph is shape-bound to the canonical 343,980-sample segment (7.8s at 44.1kHz); all chunking maths derives from that constant

## Tonight's scope

1. **Separation worker, production-grade.** Promote the spike worker into `separation/`: full-song pipeline with 25% overlap between 7.8s segments and correct overlap-add reconstruction (consult the reference implementation in `woodshed-reference/` and the demucs-onnx docs for the weighting; demucs convention is triangular/transition weighting across the overlap). Resample to 44.1kHz stereo on the way in if the source differs; restore original length on the way out.
2. **Session lifecycle.** Create the session once, off the critical path, the first time separation is requested, behind a distinct "WARMING UP THE SEPARATOR" LCD state (creation alone takes 9 to 40 seconds). Keep the session alive for subsequent songs in the same visit.
3. **Progress and control.** Per-chunk progress with a running time estimate, rendered as the tape-transport LCD state in design spec section 7 ("SEPARATING 42%  EST 4:10"). Cancel works cleanly (abort between chunks, free tensors, session survives for reuse). Warn via `beforeunload` if separation is in flight. Progress estimates must be honest: derive from measured chunk times, not hope.
4. **Resume safety.** Persist completed chunk outputs incrementally so a cancelled or crashed separation resumes from the last completed chunk rather than restarting; wipe partials on completion.
5. **IndexedDB stem cache.** Keyed by content hash of the decoded audio plus model identifier. Stems stored as 16-bit PCM to halve footprint (~50MB per song); instant reopen of previously separated songs; purge-per-song and cache-size readout in a minimal settings surface (hardware-styled, no web furniture).
6. **Memory discipline.** Release tensors per chunk, never hold more than the working set (current chunk in, four stem segments out, plus the growing output buffers as 16-bit arrays, not Float32 hoards). Prove it with a 7-minute track end to end.
7. **Four stems on the desk.** Sample-locked playback of the four separated stems through the existing engine: four waveform lanes per spec 4.9 with per-stem colour, four channel strips (fader, mute, live RMS meter each). Solo logic is Night 3; mute must work tonight. Time-stretch applies to all stems in sync. This resolves the Night 1 "empty master section" known issue.
8. **Fallback messaging.** If WebGPU is absent or session creation on it fails, fall back to WASM with the thread-raise recipe and show the amber LCD warning line from spec section 7 with an honest revised estimate.
9. **Tests.** Unit: chunking maths (segment boundaries, overlap weights, edge chunks, length restoration), 16-bit round-trip, cache keying. Integration: separate a short fixture end to end, assert stem count, shapes, finite values, differentiated RMS, and mix-reconstruction error under 5%. Playwright: the import flow against a mocked worker (progress, cancel, resume, cached reopen).

## Constraints

- Everything from Night 1 still applies: tokens only, no localStorage/sessionStorage (IndexedDB is correct and expected tonight), MIT/BSD/Apache only, design spec section 10, models/ never committed
- Do not regress the single-track player: it must still work for songs that have not been separated
- Do not start Night 3 scope (solo logic, pitch shift, saved loops, scribble persistence)
- If overlap-add reconstruction quality is audibly wrong at segment boundaries and cannot be fixed within the night, ship with the artefact, document it precisely in STATE.md with a proposed fix, and do not let it block the rest

## Done means

Drop in a full song, watch honest warming and separation progress on the LCD, end with four coloured stem lanes and four working channel strips where muting the "other" stem leaves a clean backing mix; reload the page and reopen the same song instantly from cache; cancel mid-separation and resume without restarting; all tests green.

## End of run

Write STATE.md: what shipped, commits, test counts, measured end-to-end separation time and peak behaviour for a real 4-minute song on both EPs if obtainable (WebGPU at minimum), which EP ran, cache hit behaviour, decisions and why, known issues, and a recommendation for Night 3. Clean committed tree.
