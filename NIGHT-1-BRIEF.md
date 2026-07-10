# NIGHT-1-BRIEF.md — Woodshed, Night 1 of 5

You are running Night 1 of a five-night one-shot autonomous build. Work through the whole brief without stopping to ask questions; make sensible decisions, record them, and keep going. British English throughout, no em dashes.

## Read first, in this order

1. `practice-studio-build-plan.md` (the full project plan; tonight you execute Night 1 only)
2. `woodshed-design-spec.md` (the design contract; its tokens and component anatomy are law)
3. `woodshed-desk-mockup.html` (the approved visual reference; open it, study it, match it)
4. `models/vite-ort-config-reference.txt` (bundler config for onnxruntime-web; basis for the Vite config, with the amendments in the Constraints section below)
5. `woodshed-reference/` (working browser separation demo scaffolded from the MIT-licensed demucs-onnx package; treat as the reference implementation for the spike and Night 2. Note it was scaffolded around a single-stem specialist model; our models are 4-stem, so output shapes differ)

If any of files 1 to 4 are missing, stop immediately and write STATE.md explaining what was absent.

## Project

Woodshed, a browser-based practice studio for musicians. Everything runs client-side. Tonight is the engine foundation plus the separation feasibility spike.

## Tonight's scope (Night 1 in the plan, nothing from later nights)

1. Scaffold: Vite + React + TypeScript + Tailwind, ESLint, Vitest, Playwright smoke test, npm scripts for dev/build/test/lint. Git init with clean conventional commits at each milestone.
2. Token file and self-hosted typefaces per design spec sections 1 and 2. If woff2 files are not present in `/assets/fonts`, use system fallbacks, log it in STATE.md, and carry on.
3. `hardware/` component library: Knob, Fader, Button, LEDMeter, LCD, ScribbleStrip, Transport, built exactly to design spec section 4, with a visual QA route at `/hardware` showing every component in every state.
4. Audio: file load via drag-drop and picker (mp3, wav, m4a, flac) decoded to AudioBuffer with friendly errors; canvas waveform per design spec 4.9; transport with play, pause, seek; A-B loop with markers; keyboard shortcuts (space, L, arrows).
5. Time-stretch: integrate signalsmith-stretch in an AudioWorklet for pitch-preserved speed 50 to 120 percent on the single loaded track, controlled by the Tempo fader component.
6. SPIKE (do not skip, do not leave until last): load `models/htdemucs_fp16weights.onnx` in a Web Worker via onnxruntime-web. Run one 10-second audio chunk on the WebGPU execution provider and again on the WASM provider. Repeat the WebGPU run with `models/htdemucs.onnx` (fp32) for a quality and speed comparison. Record chunk inference time, memory use, and output sanity for all runs. Consult `woodshed-reference/demo.js` for working session setup, preprocessing, and chunking code before writing your own.
7. Tests: unit tests for engine maths (loop boundaries, stretch ratios, sample conversions), component render tests for the hardware library, one Playwright flow (load file, play, set loop, change speed).

## Constraints

- Only design-spec tokens for colour; no hard-coded hex in components
- No localStorage or sessionStorage anywhere; in-memory state tonight, IndexedDB comes Night 2
- Licences: MIT/BSD/Apache dependencies only; no GPL, no AGPL (no Rubber Band, no essentia.js)
- Design spec section 10 (things to resist) applies to every decision
- Vite config: use `models/vite-ort-config-reference.txt` as the basis, with two amendments. First, create ONNX sessions with `executionProviders: ["webgpu", "wasm"]` so WebGPU is tried first with WASM fallback. Second, bundle the onnxruntime-web .wasm files locally; do NOT use the CDN wasmPaths suggestion in the file's comments. The product must work fully offline
- Keep the COOP and COEP headers from the reference config in the dev server; note in STATE.md that production on Cloudflare Pages needs the same two headers via a `_headers` file
- The `models/` folder is gitignored; never commit model files
- Do not start Night 2 work even if you finish early; spend surplus time on test coverage and polishing the `/hardware` page

## Done means

I can drop in an mp3, loop a section at 75 percent speed with correct pitch using the hardware controls, the `/hardware` page shows every component in every state, all tests pass, and the spike benchmarks exist for both models on both execution providers.

## End of run

Write STATE.md at the repo root containing: what shipped, commit list, test count and status, the spike benchmark table (WebGPU vs WASM timings for fp16 and fp32, projected full-song separation time for a 4-minute track on each), decisions made and why, known issues, and your recommendation for Night 2 including an explicit GO or SWITCH-TO-2-STEM call based on the benchmarks and a recommendation of fp16 or fp32 as the shipping model. Finish by ensuring the working tree is clean and committed.
