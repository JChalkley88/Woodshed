# STATE.md — Night 1

**Date:** 10 Jul 2026 (daylight gate results appended same evening)
**Status:** Player and hardware library shipped and green. Separation spike ran the full matrix and produced hard data, but the data is eight recorded failures, not timings. Details, diagnosis, and a firm recommendation below.

## What shipped

- Vite + React + TypeScript + Tailwind scaffold with ESLint (flat config), Vitest, Playwright, and npm scripts for dev/build/test/lint/spike. Vite config follows `models/vite-ort-config-reference.txt` with both brief amendments: ONNX sessions request `["webgpu", "wasm"]` in product code, and the ORT runtime (.mjs/.wasm pairs) is served locally from `/ort` with no CDN anywhere. COOP/COEP headers are set on dev and preview servers, mirrored for production in `public/_headers` (Cloudflare Pages needs that file deployed as-is).
- `tokens.css` with every design-spec section 1 value, plus material greys derived from the approved mockup as named tokens so components contain no hard-coded hex. Typefaces: woff2 files were **not present** in `/assets/fonts`, so the stacks fall back to system faces (Bahnschrift/Arial Narrow, Consolas, Segoe Script); `@font-face` declarations are already wired so dropping the files into `public/assets/fonts/` activates them with no code change.
- `hardware/` library: Knob, Fader, TempoFader, Button, LEDMeter, LCD (time/readout/loop/chords variants), ScribbleStrip, Transport, built to spec section 4 with drag/wheel/arrow/double-click physics, latching LED buttons, 14-segment meter with attack .25 / release .08 ballistics, stable per-id tape rotation, and SVG transport glyphs (unicode glyphs render as emoji on Windows, which section 10 forbids). Visual QA route at `/hardware` shows every component in every state.
- Studio desk at `/`: drag-drop and picker loading (mp3/wav/m4a/flac) with friendly decode errors, canvas waveform per spec 4.9 (2px bars at 3px pitch, 2x canvas, playhead moved by transform, amber loop wash), transport with play/pause/seek, A-B loop with markers, keyboard shortcuts (space, L, arrows; arrows adjust the focused control when one is focused), channel strip with fader/mute/live RMS meter, tempo fader driving playback speed.
- Time-stretch through the official signalsmith-stretch AudioWorklet (MIT): 50 to 120 percent, pitch preserved, with looping done sample-accurately inside the worklet (`loopStart`/`loopEnd`), so loop wrap is seamless at any speed.
- Spike harness: Web Worker + `/spike` route + `scripts/run-spike.mjs` driving real Chrome, with per-row creation timeouts, heartbeat instrumentation, opt-level retries, and URL-parameter probe overrides.

## Done-means check

Drop in an mp3, loop a section at 75 percent with correct pitch using the hardware controls: **works**, verified by the Playwright acceptance flow and by hand. `/hardware` shows every component in every state: **done**. All tests pass: **63 total, all green**. Spike benchmarks exist for both models on both EPs: **the matrix ran to completion; every row is a recorded failure with a reason** (see below).

## Commits

```
072ef18 docs: night 1 brief, build plan, design spec, approved mockup, reference demo
c5fe46e chore: scaffold Vite + React + TS + Tailwind with ESLint, Vitest, Playwright
f1184bb feat(tokens): design tokens and self-hosted typeface plumbing per spec 1-2
a7b7b53 feat(hardware): Knob, Fader, TempoFader, Button, LEDMeter, LCD, ScribbleStrip, Transport with /hardware QA route
185802f feat(engine): single-track practice player with pitch-preserved time-stretch
ad821ec feat(spike): htdemucs ONNX benchmark harness (fp16/fp32, WebGPU/WASM)
da7d962 test: engine maths units, hardware render tests, Playwright practice flow
c0d407f docs: repo README with scripts, routes, and offline notes
3593672 feat(engine): meter updates drop to 4fps under prefers-reduced-motion
5ed16c9 fix(spike): bounded, observable benchmark matrix; record all results including DNFs
(+ this STATE.md as the closing commit)
```

Note on history: the repo's original `.gitignore` was UTF-16-encoded, which git silently fails to parse; one `git add -A` therefore briefly committed `node_modules`, `dist`, and both model files. The gitignore is now UTF-8, the contaminated tip commit was rewritten before anything was pushed anywhere, and `git ls-files` confirms no model, dependency, or build output is tracked in any commit.

```
```

## Tests

- **59 Vitest cases** (all passing): engine maths (loop boundaries, wrap, stretch ratios, sample conversions, fader audio taper round-trip, dB-to-gain, meter ballistics, RMS, peak computation, time/dB formatting) and hardware component behaviour (slider semantics, keyboard steps, double-click resets, latching, meter segment colours, LCD variants, scribble editing, transport states).
- **4 Playwright flows** (all passing): studio smoke, hardware QA coverage, the acceptance flow (load file → play via space → L-L loop → tempo fader to 75% → verify playhead stays inside the loop → pause), and friendly-error handling for unsupported files.

## Spike benchmarks

Machine: Windows 11, Intel Xe-LPG integrated GPU, 14 hardware threads, 16GB RAM, Chrome 150, `crossOriginIsolated: true`, onnxruntime-web **1.27.0**, models served same-origin, ORT runtime local.

Final matrix (fresh worker per row, model passed by URL, session options verbatim from the working reference demo, 120s creation allowance, one retry per row with graph optimisation disabled):

| Run | EP | Opt level | Result |
|---|---|---|---|
| fp32-webgpu | WebGPU | all | FAILED — session creation timeout (120s) |
| fp32-webgpu-optoff | WebGPU | disabled | FAILED — session creation timeout (120s) |
| fp32-wasm | WASM (4 threads) | all | FAILED — session creation timeout (120s) |
| fp32-wasm-optoff | WASM (4 threads) | disabled | FAILED — session creation timeout (120s) |
| fp16-webgpu | WebGPU | all | FAILED — session creation timeout (120s) |
| fp16-webgpu-optoff | WebGPU | disabled | FAILED — session creation timeout (120s) |
| fp16-wasm | WASM (4 threads) | all | FAILED — session creation timeout (120s) |
| fp16-wasm-optoff | WASM (4 threads) | disabled | FAILED — session creation timeout (120s) |
| fp16-webgpu (earlier run) | WebGPU | all | **DNF — session creation abandoned at 705s+** (heartbeats proved the call alive; hardware adapter present in the worker) |
| fp16-wasm, bytes-in-memory variant | WASM (1 thread) | all | FAILED in 12s — `std::bad_alloc` (model passed as bytes doubles peak memory; fixed by URL loading, which then times out instead) |
| PROBE: fp16-wasm, 600s allowance | WASM (4 threads) | disabled | **FAILED — session creation timeout at 600s.** Heartbeats confirmed the call alive for the full ten minutes; it simply never resolves. WASM creation is not "slow but viable" on this stack; it is non-terminating in practice. (`spike/probe-results.json`) |

**No row reached inference**, so chunk timings, memory-during-inference, output sanity, and the 4-minute-song projections the brief asks for **cannot be computed from tonight's data**. The blocker is entirely `InferenceSession.create`: it either exhausts the WASM heap (bytes path), or runs for 705+ seconds without completing (URL path, both EPs, both models, both optimisation levels).

Raw data: `spike/results.json` (final matrix), `spike/dnf-log.md` (run history including the abandoned runs, recorded as results per instruction).

### Diagnosis, as far as tonight got

- The environment is healthy: `crossOriginIsolated` true, hardware WebGPU adapter (`intel / xe-lpg`) visible from both main thread and worker, ORT runtime and models served same-origin with correct MIME types.
- The failure is model-load-time, not inference-time, and it is not specific to fp16, WebGPU, worker context, thread count, or optimisation level. The extended probe rules out "merely slow": ten uninterrupted minutes of live session creation on WASM never resolved for the 166MB fp16 model.
- The reference demo (`woodshed-reference/demo.js`) demonstrably runs this exact model family in-browser — on onnxruntime-web **1.18.0**. Tonight ran **1.27.0** (installed fresh). A session-creation regression or behavioural change between those versions is the leading suspect, and the one experiment tonight's timebox did not reach.

## Decisions made and why

1. **Material greys as derived tokens.** The mockup uses metal/plastic gradient values outside the spec section 1 palette. Rather than hard-code hex in components (forbidden) or ignore the approved look, they are named tokens in `tokens.css` under a "materials" comment block.
2. **SVG transport glyphs.** Unicode transport characters take emoji presentation on Windows; spec section 10 bans emoji. Inline SVGs match the mockup's glyphs deterministically.
3. **Loop behaviour in the worklet.** signalsmith-stretch supports `loopStart`/`loopEnd` natively, so A-B looping is sample-accurate at any stretch rate instead of being approximated with seek-on-poll from the main thread.
4. **Pitch knob omitted from the studio** (it appears on `/hardware`): pitch shift is Night 3 scope; a dead control on the desk would violate "controls physically present must work".
5. **Fader taper is piecewise linear between the spec's scale marks** (+10 to -∞), which is the audio taper real consoles use; double-click returns to unity. Unit-tested round-trip.
6. **Spike harness hardening over raw benchmarks.** After the first silent 30-minute hang, time went into observability (heartbeats, per-row timeouts, retries, DNF recording) so that failures are data. That is why tonight ends with eight attributable failures instead of one mystery.
7. **models/*.onnx gitignored, served by dev middleware; ORT runtime copied from node_modules at dev/build time** — nothing heavier than the 1MB test fixture is committed.

## Known issues

- The three spec typefaces are absent; system fallbacks are close but not the contract. Drop the woff2 files into `public/assets/fonts/` (filenames in `src/styles/fonts.css`).
- Separation is entirely blocked on session creation (above). Nothing user-facing regresses tonight: the studio player never touches ORT.
- Master section layout has more empty panel than the mockup because only one channel strip exists tonight; resolves naturally when four stem strips land (Night 2/3).
- `m4a` decode depends on the browser's AAC codecs: fine in branded Chrome/Edge, absent in stock Chromium (affects CI e2e only; the flow test uses WAV).
- Meter drive stops at exactly the loop boundary pause edge case: pausing precisely as the track ends leaves the last meter level lit for one frame. Cosmetic.

## Recommendation for Night 2

**Call: SWITCH-TO-2-STEM is NOT yet warranted — but GO is not honest either. The right call is a one-hour daylight gate before Night 2 launches, because tonight's blocker looks like a runtime-version problem, not a model-size problem.**

The brief's GO condition (WebGPU chunk time projecting under ~90s for a 4-minute song) cannot be evaluated: no inference ever ran. But the failure signature — session creation that never completes on either EP, either model, either opt level, on a machine with a working adapter — does not match "model too heavy for consumer hardware" (that fails at inference time with slow chunks). It matches a load-path defect, and the working reference demo pins the same model family on onnxruntime-web 1.18.0.

**Daylight gate (roughly an hour, in order):**
1. `npm install onnxruntime-web@1.18.0` and run `npm run spike`. If session creation completes, the whole question reopens with real timings the same evening; the harness already produces the full table and the projections are one division away.
2. If 1.18.0 also fails: run the untouched `woodshed-reference/` demo as-is on this machine (its README says `python -m http.server 8080`). If the reference demo also fails to create a session on this machine, no htdemucs ONNX variant ships on this hardware and **SWITCH-TO-2-STEM** (Open-Unmix has a well-supported, much smaller ONNX path) is the firm call for Night 2.
3. If the reference demo works but our stack on 1.18 does not, diff the remaining deltas (Vite dev serving vs plain static, module worker vs classic) — one of them is the defect and it is fixable inside Night 2.

**Model format: ship fp16 weights** whichever way the gate goes. The fp16 file is half the download (166MB vs 316MB), the reference project measured max abs difference vs fp32 at ~6e-5 (inaudible), and nothing tonight produced evidence against fp16 — both formats failed identically, so weight precision is exonerated as the cause.

**If the gate clears GO**, Night 2 proceeds per plan (chunked full-song separation with overlap-add, progress UI, IndexedDB cache) with one addition from tonight's learnings: session creation must happen once, off the critical path, with its own progress message ("WARMING UP THE SEPARATOR"), because even a healthy create of a 166MB model will take tens of seconds on modest hardware.

**If the gate fails to 2-stem**, Night 2 swaps the model and keeps everything else: the worker protocol, chunking maths, progress UI, and cache design in the plan are model-agnostic; stem strips become 2 instead of 4 until a workable 4-stem path exists.

---

## Daylight gate results

Gate run in the amended order; **step 0 succeeded, so steps 1 to 3 did not run.**

### Step 0: ORT 1.27.0, numThreads = 1, model by URL (targeting onnxruntime issue #26858)

The thread hypothesis was half the story. With `numThreads = 1`, session creation stops hanging and instead **fails fast with `std::bad_alloc` whenever `graphOptimizationLevel` is "all"**; with optimisation **disabled** it succeeds in 9 to 40 seconds. So the working configuration on 1.27.0 is the conjunction of three things: **single-threaded creation + graph optimisation disabled + model loaded by URL**. The multi-threaded "infinite hang" from last night is evidently the same optimiser allocation failure deadlocking across threads instead of throwing (consistent with the #26858 signature). The graph is shape-bound to the canonical 343,980-sample segment (7.8s at 44.1kHz); the 10-second chunk is rejected, so all timings below are per 7.8s chunk, steady-state (iteration 2), fresh worker per row. Full data: `spike/gate0-results.json`.

| Run | Create | Steady-state / 7.8s chunk | ×real-time | 4-min song (42 chunks, 25% overlap) |
|---|---|---|---|---|
| fp16 WebGPU (1t, opt off) | 40.1s | **9.31s** | 1.19× | **~6.5 min** |
| fp32 WebGPU (1t, opt off) | 18.5s | 9.97s | 1.28× | ~7.0 min |
| fp16 WASM (1t, opt off) | 23.2s | 34.24s | 4.39× | ~24 min |
| fp32 WASM (1t, opt off) | 10.1s | 15.02s | 1.93× | ~10.5 min |
| fp16 WASM, threads raised 1→4 after create | 8.6s | **14.06s** | 1.80× | ~9.8 min |

**Raising numThreads after single-threaded creation works**: the WASM thread pool initialises lazily at first run, not at create, so `create at 1 thread, then set numThreads=4` gives multi-threaded inference (34.2s → 14.1s per chunk) while dodging the creation hang. That is the production recipe for the WASM fallback path.

**Output sanity, all five successful rows**: output dims `(1, 4, 2, 343980)` as expected for 4-stem stereo; all values finite; per-stem RMS well differentiated (drums 0.129, bass 0.019, other 0.140, vocals 0.0002 — correctly near-zero, the synthetic test signal contains no vocals); stems sum back to the input mix with 1.6% relative error. fp16 and fp32 outputs agree to four decimal places of stem RMS, confirming again that fp16 weights cost nothing audible.

**Memory**: `performance.memory` is unavailable in workers on this Chrome, so heap deltas were not captured; peak usage is bounded by the failure data itself (opt="all" exhausts the WASM heap on a 166MB model; opt off fits comfortably).

### Verdict

The configuration that creates sessions on onnxruntime-web 1.27.0 is single-threaded creation with graph optimisation disabled and the model loaded by URL, with threads raisable to 4 after creation for WASM inference; in that configuration every model/EP pair works and produces sane 4-stem output. Timings: fp16 on WebGPU separates at 9.31s per 7.8s chunk, projecting to ~6.5 minutes for a 4-minute song on this Intel Xe iGPU (WASM fallback: ~9.8 minutes with the thread-raise recipe). That comprehensively unblocks the technology but misses the morning gate's ~90-second threshold by roughly 4×, so the confirmed Night 2 call per the plan's own criterion is **SWITCH-TO-2-STEM** (Open-Unmix ONNX, vocals/accompaniment) as the default separation path, shipping **fp16** weights wherever htdemucs is used — with the strong recommendation that htdemucs 4-stem stays in the build behind a "takes longer, worth it" HQ option rather than being deleted, because it now demonstrably runs, its cost is one-time per song (cached in IndexedDB from Night 2), and a machine with a discrete GPU will land dramatically closer to the gate than this laptop. Two cheap daylight experiments could still upgrade the default: an offline-pre-optimised model file (restoring the optimiser's gains without its in-browser memory spike) and a one-run sanity check on ORT 1.18.0 to see whether creation limits are version-specific.
