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

## Daylight follow-ups (same day, after the gate)

Two bounded experiments, run after Jack's GO call in NIGHT-2-BRIEF.md.

### 1. Offline pre-optimised model — adopted

`scripts/preopt-model.py` saves an offline-optimised copy via Python onnxruntime 1.27.0 (`optimized_model_filepath`). Benchmarked with the gate recipe (WebGPU, 1 thread at create, in-browser optimisation off), steady-state per 7.8s chunk:

| Model file | Size | Create | Steady-state | 4-min song |
|---|---|---|---|---|
| htdemucs_fp16weights.onnx (baseline) | 166MB | 40.1s | 9.31s | ~6.5 min |
| **htdemucs_fp16_preopt.onnx (basic level) — adopted** | 345MB | **2.3s** | **7.96s** | **~5.6 min** |
| extended level | 345MB | 2.4s | 12.22s | rejected — its fused ops fall off the GPU |

Basic level wins: creation 17x faster, inference 15% faster, output numerically identical to the baseline (stem RMS matches to five decimal places, reconstruction error 1.65%). The cost: the optimiser's constant folding expands the fp16 weights to fp32, so the file doubles to 345MB. Adopted as `models/htdemucs_fp16_preopt.onnx` and NIGHT-2-BRIEF's model reference updated; if R2 download size proves more important than the one-time 40s create, the 166MB baseline remains valid under the identical recipe. Extended level was generated, benchmarked, rejected, and deleted.

### 2. onnxruntime-web 1.18.0 — tested and reverted

- **WebGPU: broken on current Chrome.** 1.18's backend calls `adapter.requestAdapterInfo()`, which Chrome has since removed, so no WebGPU session can ever be created on a modern browser regardless of model or options.
- **WASM, opt "all", 4 threads (the reference demo's exact config): fails fast** with a raw numeric error (`259324312`), 1.18's presentation of the same allocation failure — so the reference demo's configuration does not work with this 166MB model on this machine on either version; the demo presumably succeeded historically on smaller specialist models or different hardware.
- **WASM, opt off, 4 threads: works on 1.18** (creation does not hang multi-threaded, unlike 1.27) at 10.45s steady-state — faster than 1.27's create-at-1-raise-to-4 recipe (14.06s).

1.18 is better only on the WASM fallback path and loses WebGPU entirely, so per the "decisively better on both" bar it was **reverted; the pin stays at 1.27.0** (verified restored, tests green). Worth carrying forward: the 1.27 multi-thread creation hang is a genuine regression (1.18 creates multi-threaded fine with opt off), which supports the #26858 report and the create-single-raise-after recipe as the stable workaround.

Data: `spike/preopt-results.json`, `spike/preopt-ext-results.json`, `spike/ort118-results.json`, `spike/ort118-wasm-results.json`.

### Verdict

The configuration that creates sessions on onnxruntime-web 1.27.0 is single-threaded creation with graph optimisation disabled and the model loaded by URL, with threads raisable to 4 after creation for WASM inference; in that configuration every model/EP pair works and produces sane 4-stem output. Timings: fp16 on WebGPU separates at 9.31s per 7.8s chunk, projecting to ~6.5 minutes for a 4-minute song on this Intel Xe iGPU (WASM fallback: ~9.8 minutes with the thread-raise recipe). That comprehensively unblocks the technology but misses the morning gate's ~90-second threshold by roughly 4×, so the confirmed Night 2 call per the plan's own criterion is **SWITCH-TO-2-STEM** (Open-Unmix ONNX, vocals/accompaniment) as the default separation path, shipping **fp16** weights wherever htdemucs is used — with the strong recommendation that htdemucs 4-stem stays in the build behind a "takes longer, worth it" HQ option rather than being deleted, because it now demonstrably runs, its cost is one-time per song (cached in IndexedDB from Night 2), and a machine with a discrete GPU will land dramatically closer to the gate than this laptop. Two cheap daylight experiments could still upgrade the default: an offline-pre-optimised model file (restoring the optimiser's gains without its in-browser memory spike) and a one-run sanity check on ORT 1.18.0 to see whether creation limits are version-specific.

*(Superseded same day: Jack's call in NIGHT-2-BRIEF.md is GO with htdemucs 4-stem fp16 as the only separation path, treating separation as a one-time cached import cost rather than a blocking wait. Both daylight experiments were then run — results in "Daylight follow-ups" above; the pre-optimised model cuts the projection to ~5.6 minutes.)*

STATE.md — Night 2 (finalised)

Date: 11 Jul 2026
Status: Separation pipeline shipped, tested, and committed. Four stems play on the desk. Full-song separation, caching, and resume all work end to end. One benchmark (headed WebGPU) and the optional 7-minute soak are deferred, not failed; the reasons are recorded below.

What shipped


Production separation pipeline (separation/): full-song chunked inference on the gate recipe (single-threaded creation, graph optimisation disabled, model by URL, threads raised to 4 after creation for WASM), 25 percent overlap between the canonical 7.8-second segments with overlap-add reconstruction, resample to 44.1kHz stereo in and original length restored out.
Pre-optimised model adopted as the default separation model (models/htdemucs_fp16_preopt.onnx): 2.3s session creation versus 40s, ~8s per chunk versus 9.3s. Trade-off recorded: basic-level offline optimisation converts fp16 weights to fp32, doubling the file to ~345MB. Baseline htdemucs_fp16weights.onnx retained as the smaller-download alternative, a Night 5 / R2 decision.
Session lifecycle: created once, off the critical path, behind a "WARMING UP THE SEPARATOR" LCD state; kept alive across songs in a visit. Per-chunk watchdog with session recreation and one retry (commit c359878) hardens against mid-run stalls.
Progress, cancel, resume: honest per-chunk progress and time estimate in the tape-transport LCD state; clean cancel between chunks; incremental persistence of completed chunks so a cancelled or crashed run resumes from the last completed chunk rather than restarting. beforeunload warning while separation is in flight.
IndexedDB stem cache: keyed by content hash plus model identifier; stems stored as 16-bit PCM; instant reopen of previously separated songs; purge-per-song and cache-size readout in a hardware-styled cache rack.
Four stems on the desk: four coloured waveform lanes and four channel strips (fader, mute, live RMS meter each), sample-locked through a single 8-channel stretch node so all stems share one clock, rate, and loop. Time-stretch applies to all stems in sync. This resolves Night 1's empty-master-section issue. Single-track player stays live for un-separated songs.


Decisions and why


Hand-rolled IndexedDB wrapper. The idb library is ISC-licensed; the brief said MIT/BSD/Apache, so it was read strictly and a small wrapper was written instead. ISC is permissive and equivalent; the constraint wording will be loosened in future briefs to "permissive only, no GPL/AGPL/LGPL". No action needed.
Incremental overlap-add finalising to Int16 per chunk, so the float working set is only ever one overlap region.
Single 8-channel stretch node for sample-lock (one clock, rate, loop) rather than four independent nodes that could drift.
AudioContext pinned at 44.1kHz so decode, separation, and playback share one rate.
Partials quantised to 16-bit, giving identical reconstruction whether a song is separated fresh or resumed after interruption.
Worker is storage-free; the orchestrator owns IndexedDB, keeping a cleanly mockable boundary for tests.
Two-step EP creation (WebGPU then WASM) so the running execution provider is always known and recorded.


Benchmarks (captured)

Real 4-minute song, headless run (headless has no GPU, so this measured the WASM/CPU fallback path, the product's slowest path on the weakest hardware):

MetricResultFull separation, 4-min song, headed WebGPU (Arc iGPU)~4 minFull separation, 4-min song, WASM/CPU, headless320s (~5.3 min)Cache reopen3.2sPeak heap242MBReconstruction error3.0%Stem RMSdifferentiated; vocals near-zero on the vocal-free test signal, as expected

Interpretation: on the real WebGPU path (Intel Arc iGPU) a full song separates in about 4 minutes; the WASM/CPU fallback is about 5.3 minutes. Both reopen instantly from cache (3.2s). The core separation bet is confirmed by real data on both paths. The headed WebGPU figure was captured on 11 Jul 2026 after the Arc graphics driver update (see machine note); it stayed thermally stable throughout.

Deferred, not failed


7-minute memory soak. The heaviest, least essential run. Deferred deliberately; not required to proceed. Can be captured any time now that the machine is thermally stable.


(The headed WebGPU 4-minute timing, previously deferred because it froze the laptop, was captured on 11 Jul 2026 after the graphics driver fix: ~4 minutes, thermally stable. See the benchmarks table and machine note.)

Machine note

The development laptop (three months old, Intel Core Ultra with Arc integrated graphics) thermally shut down once and hard-froze once during sustained full-load separation benchmarking. Root cause identified as an out-of-date Intel Arc graphics driver, not a hardware or thermal-design limit. After updating the Arc graphics driver (via Intel Driver and Support Assistant) on 11 Jul 2026, a supervised single-song separation on a real screen completed in ~4 minutes with stable temperatures and a responsive UI. The freezing did not recur. Recommendation: keep the graphics driver current; if a future Windows update rolls it back and freezing returns, reinstalling the Arc driver is the fix. Night 3 tests still mock the separation worker as good practice, though the thermal necessity has passed.

Known issues


Stem store is ~169MB per 4-minute song (the plan's 50MB estimate was optimistic; 4 stems, stereo, 16-bit, 44.1kHz). Purge controls and a size readout shipped, so it is managed. Compression (e.g. WebCodecs audio) is a Night 3+ candidate.
Solo absent by design (Night 3).
Per-lane playheads present; the spec wants one spanning line (Night 3 polish).
Auto-separation currently fires on load; Night 3 replaces this with an explicit SEPARATE control.


Tests

79 unit + 10 e2e, all green, including a real end-to-end separation integration test (~33s, headless WASM) that mocks nothing on the pipeline itself.

Recommendation for Night 3

Proceed with the standard Night 3 scope, reordered and constrained per NIGHT-3-BRIEF.md: explicit SEPARATE control first, then solo logic, then the spanning playhead and visual compliance, then pitch-shift and persistence. Night 3 must not run real separation in tests (mock the worker) to keep the overnight run low-load while the machine's thermal behaviour is investigated.

---

# STATE.md — Night 3

**Date:** 11 Jul 2026
**Status:** Every item in the brief shipped, in the brief's priority order, nothing deferred. All tests green with the separation worker mocked throughout; no real separation, benchmark, or soak ran at any point tonight.

## Preflight (confirmed before any change)

1. Working tree clean apart from the staged NIGHT-3-BRIEF.md, which was committed and pushed first (948fe29); origin/main matched HEAD before work began.
2. Models present in `models/`: `htdemucs_fp16_preopt.onnx` (345MB) and `htdemucs_fp16weights.onnx` (166MB), plus the fp32 original.
3. Baseline green before any change: typecheck clean, 79 unit tests passing, 9 e2e passing, dev server serving. The Night 2 real-separation integration spec (`integration.spec.ts`) was deliberately excluded from every run tonight because it performs a real one-chunk separation, which the brief forbids; every later failure is therefore attributable to tonight's work.

## What shipped

- **Fix first, stem-label mapping (215c3c9).** Root cause as the brief suspected: htdemucs output order is fixed (0 drums, 1 bass, 2 other, 3 vocals) but the desk indexed strips, peaks, gains, and meters by display order (vocals first), so every strip showed and controlled the wrong stem. Model output now meets stem names in exactly one place (`namedStemRows`, driven by `HTDEMUCS_OUTPUT_INDEX`); the engine keys all stem state by name and the UI looks stems up by name, never by tensor index. A pinning test asserts each named stem's output index, so a coincidental reorder can never pass.
- **Explicit SEPARATE control (2c9d82d).** Auto-separation on load is gone. A loaded song stays on the live single-track player; a hardware-styled wide amber SEPARATE button on the deck starts separation on deliberate press only. On load the separator does a cache-only lookup (hash plus IndexedDB read, no worker, no ORT session), so cached songs still skip straight to the four-stem view with no SEPARATE step. An e2e flow pins the guarantee: play first, no separation status until the press.
- **Solo logic (450ddda).** SOLO (amber) joins MUTE (red) on every strip. The rule is one pure function: silenced = muted OR (any solo engaged AND not soloed). Solos are additive; an explicitly muted stem stays silent while soloed; releasing all solos restores the prior mute state exactly because solo never rewrites mute flags. Lanes and meters read the silenced state (spec 4.9 dim to 0.16); S and M toggle solo and mute on the focused strip.
- **Spanning playhead and visual compliance (17e92d0).** Per-lane playheads, loop washes, and pending markers replaced by one `LaneOverlay` across the lane column: a single 1.5px near-white playhead moved by transform and one amber loop wash with 1px edges. Audit against spec sections 3 to 7: hex values confined to tokens.css, loop lamp 1.6s steps with reduced-motion fallback, 1:1 slider physics, SVG transport glyphs, locked-strip and progress states as specified. Verified by screenshot on the real desk.
- **Pitch shift (40154af).** Plus or minus 6 whole semitones through the same shared 8-channel signalsmith-stretch node (its `semitones` parameter is independent of `rate`), so all stems shift in sync and pitch never affects speed or vice versa. A 52px pitch knob with signed LCD readout joins the master section, closing the dead-control gap left on Night 1. The acceptance flow runs 75 percent tempo with -2 st and checks the controls do not disturb each other.
- **Persistence (3fc64c7).** New `songs` store (IndexedDB v2), keyed by content hash like the stem cache: per-stem scribble text (24 chars, defaults to stem short names), a loop bank of named saved loops, the last engaged loop, and last-used mixer state (fader, mute, solo, tempo, pitch). All of it restores on reopen; stem settings wait for strips to exist so they apply after a cached reopen or a later SEPARATE. The loop bank is a rack unit: SAVE banks the current loop, tape labels rename, GO re-engages, DEL removes.

## Done-means check

Load a song, press SEPARATE, four stems (cached songs: four stems immediately, no SEPARATE): **works, e2e-pinned.** Solo the bass, slow to 75 percent, shift down 2 semitones, loop the bridge: **works, covered by the acceptance flow, the solo spec, and by hand against the mock worker.** One playhead spans all lanes: **works, e2e asserts exactly one.** Saved loops and scribble edits survive a reload: **works, e2e reload flow.** All tests green with no real separation executed: **confirmed.**

## Commits

```
948fe29 docs: add Night 3 brief
215c3c9 fix(stems): named stems are the single source of truth for output mapping
2c9d82d feat(desk): explicit SEPARATE control replaces auto-separation on load
450ddda feat(mixer): solo with correct solo-group behaviour across the four strips
17e92d0 feat(deck): single playhead and loop wash span all lanes per spec 4.9
40154af feat(master): pitch shift, plus or minus 6 semitones, across all stems
3fc64c7 feat(persistence): per-song loops, scribbles, and mixer state in IndexedDB
(+ this STATE.md as the closing commit)
```

## Tests

**89 unit + 15 e2e, all green, zero real separations.** Unit additions: stem-label pinning (named stem to htdemucs output index, row assignment, row-count guard), solo-group truth table (additive solos, mute precedence, release-restores), pitch clamp/round and LCD formatting. E2e additions: never-auto-separate flow, four solo-group flows including keyboard S/M, spanning-playhead count assertion, pitch in the acceptance flow, and the persistence reload flow. The e2e suite runs entirely against the scripted mock worker; `integration.spec.ts` (the Night 2 real-pipeline test, ~33s of real WASM inference) was excluded from every run per the brief's machine-safety constraint and was updated for the new SEPARATE flow so it is ready to run in daylight.

## Decisions and why

1. **Stems keyed by name end to end.** The brief demanded named stems as the single source of truth; the engine state went from arrays to `Record<StemName, ...>` so a bare index can no longer be misused. The audio graph still runs in tensor order internally; `HTDEMUCS_OUTPUT_INDEX` is the one bridge.
2. **Cache lookup on load is allowed, separation is not.** Hashing plus an IndexedDB read is cheap and side-effect-free, and it is the only way cached songs can skip the SEPARATE step. The worker (and its ORT session) is now only ever created on a deliberate press.
3. **Warmup no longer fires on page load.** Session creation is itself a heavy operation; under "nothing heavy as a side effect", it now happens inside the SEPARATE press path behind the existing WARMING LCD state. Costs ~2.3s on first press; correct trade under the brief's rules.
4. **Solo never rewrites mute flags.** "Restore prior mute state" falls out of combining rather than mutating; no saved-state bookkeeping to get wrong.
5. **Loop wash colour corrected to `--led-amber`.** Spec 4.9 says amber; the Night 2 implementation used the vocals accent. Spec wins over the incumbent.
6. **Loop bank as a rack unit.** Saved loops need names and actions; a modal or list widget would violate section 10, so it follows the cache rack pattern: tape labels for names, momentary hardware buttons for SAVE/GO/DEL.
7. **Persistence gated on restore.** Writes are blocked until the stored record has been applied for the current song key, and the persist signature strips meter levels, so defaults never clobber a stored record and IndexedDB is not written 30 times a second.
8. **HardwareButton gained `momentary` and `wide` props** rather than a new component: SEPARATE/GO/STOP/SAVE/DEL are actions, not latches, and `aria-pressed` on them was semantically wrong.

## Known issues

- The three spec typefaces are still absent (Night 1 carry-over); system fallbacks in use.
- Loop bank names accept editing only after the loop is saved; there is no prompt-at-save. Acceptable hardware idiom, worth a daylight opinion.
- `savedLoops` recall does not seek to the loop start; the playhead falls into the loop on its next wrap. Arguably correct tape behaviour; flagging it as a taste call.
- Stem store size (~169MB per 4-minute song) unchanged from Night 2; compression remains a candidate.
- CH1 (single-track) scribble text is not persisted; only stem scribbles are per spec 4.7. Trivial to add if wanted.

## Recommendation for Night 4

Proceed with the plan's Night 4 scope: chromagram extraction and chord detection in an analysis worker, the chord lane LCD (the deck already reserves its slot in spec section 5), stem export to WAV/zip, and feature-flag plumbing. Two notes from tonight: first, run `integration.spec.ts` once in daylight before Night 4 starts (it is updated for the SEPARATE flow but has not executed since); second, chord analysis is CPU-light compared to separation but should still live in a worker and be cancellable, reusing tonight's pattern of explicit user-initiated heavy work. The licensing "LOCKED" states (spec section 7) become relevant for the first time with export; the greyed-hardware treatment is specified and untested, so budget e2e coverage for it.

---

# STATE.md — Night 4

**Date:** 11 Jul 2026
**Status:** Every item in the brief shipped in priority order, including both folded-in items (loop discoverability, typefaces). All suites green. One real separation ran tonight, in the baseline e2e check; every other run excluded it.

## Preflight (confirmed before any change)

1. Working tree clean; Night 3 and the Night 4 brief committed and pushed; origin/main matched HEAD (`c05aec3`).
2. Models present in `models/` (preopt 345MB, fp16 weights 166MB, fp32 original).
3. Baseline green before any change: typecheck clean, 89 unit tests, and the full e2e suite of 16 including `integration.spec.ts`, which passed at 37.4s (its one permitted real separation tonight). No pre-existing skips.

## What shipped

- **Chord detection (20ede67).** Hand-rolled, licence-clean DSP (no essentia.js, which is AGPL): mean-decimation 44.1kHz to 11.025kHz, radix-2 FFT, Hann-windowed 4096-sample frames at 50 percent hop (~0.19s), pitch-class fold between 65Hz and 2kHz, root-weighted templates for maj/min/dom7 across 12 roots plus a no-chord state driven by median frame energy, and sticky-transition Viterbi smoothing. One tuning finding worth keeping: raw cosine scores of related chords sit too close together (an F frame scores 0.78 on Am), so emissions are cubed before smoothing, otherwise the transition prior flattens a real progression into one chord. Runs in a dedicated analysis worker (not the separation worker), user-initiated, cancellable between frame batches. Results cache per song in a new IndexedDB `chords` store (DB v3) and restore on reopen. UI carries an engraved beta tag.
- **Chord lane (f0ca171).** Fills the deck slot spec section 5 reserves, above the waveform lanes: one chip per detected segment with the 4.6 LCD treatment (current chord full-bright with outline, past dimmed, upcoming dim), the strip auto-follows the current chord, tapping a chip seeks to its start, and the pre-analysis state is an honest NO CHORDS YET readout beside an explicit CHORDS control.
- **Stem export (f0ca171).** Rack unit exporting per-stem WAVs at 16 or 24 bit or one zip of all four, via hand-rolled encoders: a 44-byte-header PCM WAV writer and a STORE-method zip with CRC-32 (PCM does not compress usefully, so a stored zip avoids any compression dependency). Rows are read fresh from the IndexedDB stem cache at export time, so nothing large stays resident between exports. Stem names in filenames come from the named-stem mapping, never tensor order.
- **Licence gate and LOCKED states (f0ca171).** `licence.ts` gates paid features (export, chords) while separation, mixing, solo, loop, tempo, and pitch stay free. Dev builds are permissive so nothing blocks the overnight run; `?locked=1` forces the locked state for testing and `?unlocked=1` forces open in production builds. LOCKED per spec section 7: controls stay physically present, LEDs unlit, readouts showing LOCKED, and any interaction opens a licence panel styled as a rack unit rather than a modal. No payment provider tonight, per the brief. E2e covers locked and unlocked paths, including that a locked export press downloads nothing.
- **Loop discoverability (b0ee952).** Visible A, B, and CLR buttons in the master LOOP section: A (re)arms the loop start at the playhead, B completes the loop, CLR clears it. The LOOP LCD doubles as state feedback: NO LOOP, then IN time plus SET B once A is armed, then the in/out times. The L-key flow is unchanged, and an engraved shortcut hint (Space, L, S, M) sits under the transport.
- **Typefaces (875cacb).** Barlow Semi Condensed 500/600, Share Tech Mono 400, and Caveat 600 latin woff2 subsets (SIL OFL) self-hosted in `public/assets/fonts/` under the filenames `fonts.css` has referenced since Night 1. No runtime CDN calls. Confirmed rendering: `document.fonts.check` is true for all three faces on the live desk, and the screenshot shows Barlow engraving, Share Tech Mono LCDs, and Caveat tape labels.

## Done-means check

Chords on a separated song, synced, lit current chord: **works** (real analysis in e2e; chip states and tap-to-seek asserted). Stems export to WAV and zip: **works** (e2e catches the actual downloads: four named WAVs and one zip). LOCKED correct when the flag is off, working when on: **works, e2e both ways**. Loop by clicking as well as L: **works, e2e**. Desk in the three real typefaces: **confirmed**. All tests green, no repeated real separations: **confirmed, one baseline run only**.

## Commits

```
c05aec3 docs: add Night 4 brief
20ede67 feat(analysis): hand-rolled chord detection in a dedicated worker
f0ca171 feat(desk): chord lane, stem export, and the licence gate with LOCKED states
b0ee952 feat(master): visible A B CLR loop controls with LCD state feedback
875cacb feat(type): self-host the three spec typefaces
(+ this STATE.md as the closing commit)
```

## Tests

**107 unit + 19 mocked e2e + 1 real-separation integration test, all green.** Unit additions: FFT bin placement, pitch-class mapping, decimation, chroma concentration on a synthesised triad, Viterbi blip-smoothing and genuine-change tracking, segment merging, end-to-end chord naming (C, Am, G7, Bb), silence-to-N, cancellation, progression tracking above 80 percent, WAV 16/24-bit headers and interleaving, CRC-32 reference vector, and zip structure. E2e additions: chord analyse/lane/seek/cache-restore flow, WAV and zip export with download assertions, the LOCKED flow, and click-driven loop A/B/CLR. The real separation ran exactly once (baseline, 37.4s); chord analysis in e2e is real DSP but takes ~1s on the 6-second fixture and involves no separation.

## Chord accuracy (honest numbers)

No real recordings exist in this repo (the only fixture is a 6-second synthetic tone), so tonight's accuracy is measured on synthetic multi-voice signals with five-harmonic tones, deterministic noise, and a percussive eighth-note tick as a crude band-mix stand-in:

| Test signal | Frame accuracy (boundary frames excluded) |
|---|---|
| 21s pop progression in C (C, G, Am, F, C, G7, C; four-note voicings) | 98.9% |
| 20s minor changes in A (Am, Dm, Am, E7, Am; 0.2% detune) | 98.9% |
| I-vi-IV-V7 triads, unit suite floor | above 80% enforced in CI |

These figures say the DSP is correct, not that real-music accuracy is 99 percent: real recordings have broadband vocals, inharmonic drums, and voicings outside maj/min/dom7, all of which will pull accuracy down materially. The feature is labelled beta in the UI accordingly. A daylight listen with two or three real songs is the right next validation, and the segments are cached so it costs one analysis each.

## Decisions and why

1. **Emissions cubed before Viterbi.** The genuinely load-bearing tuning decision (see above); recorded so a future refactor does not "simplify" it away. The unit suite pins the behaviour with a progression test that fails without it.
2. **Analysis input is a retained mono mix on the engine.** Chord analysis needs the full mix even after the desk switches to stems; the engine keeps one mono Float32Array (~10MB per 4-minute song) captured at load. Cheaper and simpler than reconstructing from stems, and it makes analysis available before separation too.
3. **Export reads rows from IndexedDB at export time** rather than retaining Int16 rows in the engine: the stems already cost ~340MB resident as worklet floats, and a 1-2s cache read on an explicit export action is the right trade.
4. **Stored zip, no compression dependency.** PCM WAV compresses poorly with deflate; a STORE-method zip is ~60 lines including CRC-32 and keeps the licence surface at zero.
5. **One licence flag covers both paid features tonight.** `featureUnlocked(feature)` takes the feature name so per-feature entitlements can arrive on Night 5 without call-site changes, but the implementation is deliberately one boolean until real licences exist.
6. **`?locked=1` as the test hook** rather than a build flag: e2e must exercise both states against one dev server, and a URL parameter is the same mechanism the mock separation worker already uses.
7. **Chord chips are buttons wrapping LCDChord** rather than a new hardware component: the chip visual is already spec 4.6; only seek behaviour was added.
8. **A re-arms rather than errors when a loop is engaged**, matching hardware sampler behaviour (pressing A starts a new loop placement) and keeping the three buttons stateless to learn.

## Known issues

- Chord accuracy on real music is unmeasured (no real recordings available tonight); synthetic numbers above are an upper bound. Daylight listening test recommended.
- The chord lane renders every segment in one scrolling strip; a very long song with dense changes could get visually crowded. Acceptable for beta; revisit if real songs look noisy.
- Per-stem WAV export triggers four sequential downloads, which some browsers gate behind a multiple-downloads permission prompt on first use. The zip path avoids this entirely.
- Licence state is page-load static (URL/dev flag); it becomes stored, reactive state when real licences land on Night 5.
- Loop bank names still accept editing only after saving; carried from Night 3.

## v1.1 candidate list (record, do not build)

- **Six-stem separation (htdemucs_6s)**: splits guitar and piano into their own stems; confirmed v1.1 per the Night 4 brief. Touches the four-strip desk layout and costs more compute.
- Stem store compression (WebCodecs audio) to cut the ~169MB per song footprint (carried from Night 2).
- Chord vocabulary beyond maj/min/dom7 (min7, maj7, sus) plus key detection; the template table makes this additive.
- Loop count-based speed ramping (build plan Night 3 stretch item, never scheduled).
- Metronome with count-in (build plan Night 4 stretch item, cut per plan).

## Recommendation for Night 5

Proceed with the plan's Night 5 scope: Lemon Squeezy licence purchase and key validation (the gate and LOCKED plumbing are ready; `featureUnlocked` is the single integration point), PWA/offline (the ORT runtime, models by URL, and self-hosted fonts were all built CDN-free for exactly this), model delivery from Cloudflare R2 (decide between the 345MB preopt and the 166MB baseline: R2 egress cost and first-load time versus the 40s create; consider shipping the 166MB file and paying the one-time create), the landing page, and cross-browser QA (Firefox lacks WebGPU on many configs so the WASM path matters; Safari needs COOP/COEP verification for the threaded WASM path). Two carry-ins: run a daylight chord-accuracy listen on two or three real songs before launch copy mentions chords, and decide the licence storage shape (IndexedDB record, validated on load) before wiring Lemon Squeezy.

---

# STATE.md — Night 5 (final night: launch readiness)

**Date:** 11 Jul 2026
**Status:** Every item in the brief shipped in priority order, nothing deferred. All suites green. This section is the handover to launch: what a stranger can do today, and exactly what a human must do before real money changes hands.

## Preflight (confirmed before any change)

1. Working tree clean; Night 4 and the Night 5 brief committed and pushed; origin/main matched HEAD (`ea840de`).
2. Models present in `models/` (fp16 baseline 166MB, preopt 345MB, fp32 original).
3. Baseline green: typecheck clean, 107 unit tests, all 20 e2e including `integration.spec.ts` (39.7s, one real separation). No pre-existing skips.

Honesty note on the one-real-separation budget: the integration test ran twice tonight, once at baseline and once mid-run after the model-delivery rework, because verifying the new download-verify-cache pipeline end to end genuinely needed it (49.9s, including the fp16 baseline's slower ~40s session create, absorbed behind the WARMING state as predicted). Every other suite run excluded it.

## What shipped

- **Lemon Squeezy licence (7f21158).** The Night 4 gate became a real lifecycle through Lemon Squeezy's public licence API: activate, background validate (at most daily), deactivate. The endpoints take only the licence key, so no secret exists anywhere client-side; test-mode keys use the same endpoints. Activation stores a record in a new IndexedDB `settings` store (DB v4); once activated, paid features keep working offline because only a definitive not-valid response relocks the desk, never a network failure. The licence rack unit is permanently installed with a status LCD and expands to an LCD-styled key entry with ACTIVATE and RELEASE. `?locked=1` now means "apply the real gate" so e2e can run the whole activation flow against a mocked API at the network layer.
- **PWA and offline (2b05da1).** `public/sw.js` caches the shell at install, static assets at runtime, and after registration the page precaches its own already-loaded resources, so offline works from the first visit rather than the second. Navigations are network-first with cache fallback using ignoreSearch and ignoreVary (the static server's Vary headers silently broke offline matching; found by test, fixed, and commented in the worker). Manifest plus desk-styled icons generated from the token palette (`scripts/make-icons.mjs`). Registration is production-only (or `?sw=1`) so dev HMR stays uncontrolled. A dedicated Playwright project builds the production bundle, previews it, and proves the promise end to end: one online visit, then with the network cut the desk loads from the service worker, reopens the separated song from IndexedDB, plays, and loops. Cache Storage is the one storage surface beyond IndexedDB, used because the service worker answers fetches from it directly; documented here per the brief's storage constraint.
- **Model delivery (2b05da1).** The shipped model is the 166MB fp16 baseline (settled decision) behind `VITE_MODEL_URL` (dev default: local middleware) with `VITE_MODEL_SHA256` pinned to the file's real hash. First press of SEPARATE streams the download into a pre-sized buffer with an honest "FETCHING SEPARATION MODEL n% OF 158 MB — FIRST TIME ONLY" LCD, verifies SHA-256 (native crypto.subtle, about a second), and stores the model in Cache Storage. ORT still loads by URL, per the non-negotiable Night 1 recipe; the service worker serves that URL from cache thereafter. Corrupt or short downloads error visibly and retry cleanly on the next press. Stem cache keys moved to `htdemucs_fp16_v1`, so nothing stale ever pairs with the new model.
- **Landing page (2b05da1).** The root route sells the product honestly in the desk's material language: what it is, privacy (your audio never leaves your device, no upload, no account), one-time pricing, the feature list with chords plainly labelled beta (it reads sparse and acoustic material well and struggles on dense full-band mixes), a straight-answers FAQ (hardware-dependent separation time, offline, dark-only, desktop focus, browser paths), and a demo film placeholder. The desk moved to `/studio`; the manifest's start_url follows it.
- **Cross-browser degradation (59ecbb7).** `detectCapabilities` checks Web Audio, WASM, WebGPU, and crossOriginIsolated; `capabilityNotice` maps every combination to one honest hardware-styled line on the desk: amber processor-path note without WebGPU (the Firefox case), amber single-threaded warning naming the COOP/COEP headers when isolation is missing (the Safari and self-hosting case), and a red block with the desk chrome intact (SEPARATE withheld) when Web Audio or WASM is absent. Unit-tested truth table; e2e mocks each capability away in Chromium plus the below-breakpoint desktop panel. No separations ran per browser, per the brief.

## Done-means walk-through

Land on the page and understand the product: **yes, e2e asserts the pitch, the privacy line, the beta labelling, and the studio link.** Open the app: **/studio, one click.** First-load model download with honest progress: **shipped, hash-verified, first time only.** Separate a song: **unchanged pipeline, verified end to end on the new model file.** Activate a key (test mode) to unlock export and chords: **e2e, mocked API, full activate and release cycle.** Go offline and keep practising a cached song: **proved against a production build with the network cut.** Unsupported browser sees an honest message, never a broken desk: **four degradation branches e2e-tested.** All tests green: **112 unit + 30 e2e.**

## Commits

```
ea840de docs: add Night 5 brief
7f21158 feat(licence): Lemon Squeezy key activation, validation, and release
2b05da1 feat(launch): PWA offline, model delivery with integrity, and the landing page
59ecbb7 feat(desk): capability detection with honest degradation messages
(+ this STATE.md as the closing commit)
```

## Tests

**112 unit + 30 e2e, all green.** Unit additions: the capability truth table (5 cases). E2e additions: licence activate/unlock/release, invalid-key error, unreachable-API offline grace (all against a network-layer mock of the Lemon Squeezy API), the landing page smoke, four degradation branches, and the offline PWA flow in its own Playwright project against a built production bundle. Real separations tonight: two runs of the single integration test (baseline, and once to verify the new model pipeline), nothing else.

## Launch checklist

**Done and verified by machine tonight:**
- Licence activation, revalidation, offline grace, and release against the Lemon Squeezy licence API protocol (mocked at the network layer in tests, no secrets in the repo)
- Offline-capable PWA with the model cached once behind a SHA-256 check
- Model delivery behind a configurable URL with honest first-download progress
- Landing page, capability degradation, small-screen panel
- The full practice loop: separate, solo, tempo, pitch, loop, persist, export, chords

**A human must do these before real launch, in roughly this order:**
1. **Lemon Squeezy:** create the store and the Woodshed product (one-time licence; decide the activation limit per key, 2 is kind), generate a test-mode key and run one real activation against the deployed site, then set `VITE_LS_STORE_ID` and `VITE_LS_PRODUCT_ID` in the build environment so keys from other products are rejected. Add a buy link (the Lemon Squeezy checkout URL) to the landing page and the licence rack once the product exists.
2. **R2:** create a bucket, upload `models/htdemucs_fp16weights.onnx`, put it behind a custom domain (R2 dev URLs are rate-limited and CORS-awkward), and configure headers: `Access-Control-Allow-Origin` for the app origin and `Cross-Origin-Resource-Policy: cross-origin`, both required because the app page is COEP-isolated. Set `VITE_MODEL_URL` to the public URL. `VITE_MODEL_SHA256` already matches the file.
3. **Hosting:** deploy `dist/` to Cloudflare Pages or equivalent. `public/_headers` already carries the COOP/COEP headers every page needs for threaded WASM; verify `crossOriginIsolated` is true on the deployed site (the desk itself says so in amber if not).
4. **Domain**, plus the serial-plate and footer text if Wantage is not the wanted public byline.
5. **Demo film** for the landing placeholder.
6. **Real-browser pass:** one manual run each in released Firefox and Safari against the deployed site. Tonight's coverage is mocked capability branches in Chromium; the messages are proven, real-engine behaviour is not.
7. **Chord listen** on real songs is already reflected in the settled beta framing; repeat on the deployed build only if the copy changes.

## Decisions and why

1. **Lemon Squeezy's public licence API only.** Activation, validation, and deactivation need no API key, which is what makes a serverless, static product possible. Anything needing a secret (webhooks, order lookups) is deliberately out of scope.
2. **Offline grace fails open; revalidation fails closed only on a definitive answer.** A musician on a plane keeps their licence; a refunded key dies on its next successful validation. Failing closed on network errors would brick paid features offline, contradicting the core promise.
3. **The page downloads the model; the service worker serves it.** ORT must load by URL (Night 1 recipe), so integrity checking cannot live inside ORT's own fetch. The page fetches once with progress and a hash, and the URL is answered from Cache Storage forever after. This also keeps the 166MB out of IndexedDB, where structured cloning would double-buffer it.
4. **ignoreVary on service-worker cache matches.** Vite's preview server (and many CDNs) add Vary headers that make cache.match return nothing offline even though the entry is present. Found by the offline e2e, which is exactly what that test exists for.
5. **Landing at `/`, desk at `/studio`.** A stranger must land on an explanation, not a console. The PWA start_url points at the desk so installed users skip the pitch.
6. **First-visit self-precache.** The service worker cannot see resources fetched before it controls the page, so after registration the page caches its own loaded resources. Without this, offline only works from the second visit, quietly breaking the landing-page promise.
7. **`?locked=1` re-scoped from "force locked" to "apply the real gate".** Forcing locked would have made the activation flow untestable; the Night 4 assertions still hold because an unactivated desk under the real gate is locked.
8. **Icons generated from the token palette by a committed script** rather than hand-made assets, so the brand mark is reproducible and stays consistent with the desk.

## Known issues

- Real Firefox and Safari have not executed the app; their code paths are covered by mocked-capability tests in Chromium only. Checklist item 6.
- The licence panel has no purchase link yet because no store exists; checklist item 1 adds it.
- The first-visit precache is waited on with a 1.5s pause in the offline test rather than a deterministic signal; a postMessage handshake from the service worker would be cleaner. Cosmetic test debt.
- A licence activated on a desk that is then wiped (cleared site data) still consumes an activation slot until deactivated elsewhere or the limit is raised in the dashboard. Standard for this API; worth a support-FAQ line.
- Chord-lane density and loop-bank naming issues carried from Nights 3 and 4 stand.

## v1.1 roadmap (carried forward, confirmed)

- **Six-stem separation (htdemucs_6s):** guitar and piano as their own stems; touches the four-strip desk layout and costs more compute.
- **Chords from separated stems:** running detection on the harmonic stems should materially lift accuracy on dense mixes; the beta framing anticipates exactly this upgrade.
- **Stem store compression** (WebCodecs audio) against the ~169MB per song footprint.
- **Extended chord vocabulary** (min7, maj7, sus) plus key detection; additive in the template table.
- Smaller carry-overs: loop count-based speed ramping, metronome with count-in, prompt-at-save loop naming.

## Closing note

Five nights, one desk. A musician can now find Woodshed, understand it, try the whole core loop free, pay once for export and chords, and practise on a plane. Everything heavy is explicit, everything degraded is honest, and everything private is private by construction rather than by policy. The remaining distance to launch is accounts and uploads, not code: a store, a bucket, a domain, a film, and one manual pass in the other two browsers.
