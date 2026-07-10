# Practice Studio — Five-Night Build Plan

Working title: **Woodshed** (musician slang for practising; rename at will)
Author: Claude, for Jack Challis
Date: 10 Jul 2026
Build style: one-shot autonomous overnight builds, STATE.md handoff reviewed each morning before the next night launches. British English throughout. No em dashes.

---

## 1. Product definition

A browser-based practice studio for musicians. The user drops in any song from their own library and the tool:

1. Splits it into stems (vocals, drums, bass, other) on their own machine
2. Lets them mute, solo, and rebalance stems to play along
3. Slows the track down without changing pitch, and shifts pitch without changing speed
4. Loops any section with A-B markers
5. Detects and displays chords in sync with playback

Everything runs client-side. No uploads, no servers, no per-user cost. Works offline once loaded.

**Positioning:** the local, private, one-time-purchase alternative to Moises. £30 to £50 one-off via Lemon Squeezy against their subscription.

**Free tier:** separation, slowdown, looping, stem mixing.
**Paid:** stem export to WAV, chord detection, pitch shift. (Adjustable later; gate is a licence key, not accounts.)

## 2. Scope

### In scope for v1
- Load local audio files (mp3, wav, m4a, flac)
- 4-stem separation via Demucs ONNX on WebGPU, with fallback ladder
- Multi-stem synchronised playback with per-stem gain, mute, solo
- Time-stretch 50% to 120% pitch-preserved; pitch shift ±6 semitones
- Waveform display, seek, A-B loop, keyboard shortcuts
- Chord detection (chromagram plus template matching) with synced chord lane
- Stem export to WAV (paid)
- Licence key gating via Lemon Squeezy
- Project persistence in IndexedDB (recent files, cached stems, saved loops)
- PWA offline support
- Landing page

### Out of scope for v1
- Accounts, cloud sync, mobile apps
- 6-stem models (piano and guitar split) — v1.1 candidate
- Lyrics, tabs, score display
- Recording yourself over the track
- Metronome and count-in (stretch goal Night 4, cut without guilt)

## 3. Architecture

**Stack:** Vite + React + TypeScript + Tailwind. Static hosting on Cloudflare Pages. Model files served from Cloudflare R2 (free egress). No backend.

**Layers:**

1. **UI layer** — React. Transport, waveform (canvas), stem mixer, chord lane, settings.
2. **Audio engine** — Web Audio API with an AudioWorklet doing the mixing and time-stretch. Time-stretch and pitch-shift via **Signalsmith Stretch** (MIT, official WASM build on npm as `signalsmith-stretch`). Do not use Rubber Band (GPL) or SoundTouch (LGPL complications). Engine holds N stem buffers, plays them sample-locked through one worklet.
3. **Separation worker** — Web Worker running ONNX Runtime Web, WebGPU execution provider, WASM EP fallback. Demucs (htdemucs) exported to ONNX, processed in overlapping chunks with overlap-add reconstruction. Streams progress to UI. Results cached in IndexedDB keyed by file hash so a song is only ever separated once.
4. **Analysis worker** — chord detection. Chromagram (constant-Q or FFT-based pitch-class profile) plus chord template matching with Viterbi smoothing. Hand-rolled, licence-clean. Do not use essentia.js (AGPL).
5. **Storage** — IndexedDB via `idb`. Stems stored as compressed Float32 or 16-bit PCM to keep quota sane. Budget roughly 50MB per song at 4 stems 16-bit; warn and offer purge in settings.
6. **Licensing** — Lemon Squeezy licence key activation endpoint called client-side, result cached locally with periodic revalidation, graceful offline behaviour (paid features keep working offline once activated).

**Model sourcing (do in daylight before Night 1, roughly an hour):** obtain or export Demucs htdemucs to ONNX. Known open ports exist (search GitHub for demucs onnx and free-music-demixer for prior art). If export friction is high, fall back to the 2-stem route for the spike and revisit. Upload model files to R2 before Night 2.

## 4. Risk register

| Risk | Likelihood | Fallback |
|---|---|---|
| Demucs too slow on WebGPU consumer hardware | Medium | 2-stem model (vocals/accompaniment), smaller variant, or accept 1 to 2 min processing with good progress UI. Separation is cached, so one-time cost per song is acceptable |
| WebGPU unavailable (Safari, older machines) | Certain for some users | WASM EP with honest time estimate and a "leave it running" flow; detect and message clearly |
| ONNX export of Demucs fails cleanly | Low-Medium | Use existing community ONNX ports; else 2-stem Open-Unmix (well-supported ONNX path) for v1 |
| Multi-stem time-stretched playback drifts out of sync | Medium | Single worklet mixes all stems then stretches the mixed-per-stem output with shared phase; integration test with click tracks |
| IndexedDB quota exceeded | Low | 16-bit storage, per-song purge, cache cap setting |
| Chord detection quality disappoints | Medium | Ship as beta label; it is a paid extra, not the core promise |

The whole project hinges on risk 1. That is why Night 1 contains the spike and Night 2 has a morning decision gate.

## 5. The five nights

Each night is a one-shot autonomous Claude Code run. Each ends by writing `STATE.md`: what shipped, test count, timings and benchmarks where relevant, open issues, and a recommendation for the next night. Jack reviews each morning and adjusts the next night's brief before launch.

---

### Night 1 — Engine foundation plus the go/no-go spike

**Objective:** a working single-track practice player, and hard data on separation feasibility.

Tasks:
1. Scaffold Vite + React + TS + Tailwind, ESLint, Vitest, Playwright smoke test, CI-ready scripts
2. Build the `hardware/` component library per `woodshed-design-spec.md` (Knob, Fader, Button, LEDMeter, LCD, ScribbleStrip, Transport) with a visual QA page at `/hardware`; implement the token file and self-hosted typefaces first
3. File load and decode (drag-drop and picker) to AudioBuffer; format sniffing and friendly errors
3. Canvas waveform with seek, zoom, and A-B loop markers
4. Transport: play, pause, seek, loop, keyboard shortcuts (space, L for loop, arrows)
5. Integrate signalsmith-stretch in an AudioWorklet: pitch-preserving speed 50% to 120% on the single track
6. **Spike:** load Demucs ONNX in a worker with ONNX Runtime Web. Run one 10-second chunk on WebGPU and on WASM. Record timings, memory, and output sanity to STATE.md. This is the go/no-go data
7. Unit tests for engine maths (loop boundaries, stretch ratios, sample conversion)

Done means: I can drop in an mp3, loop a section at 70% speed with correct pitch, and STATE.md contains spike benchmarks.

**Morning gate:** if WebGPU chunk time projects to under ~90 seconds for a 4-minute song on Jack's machine, proceed as planned. If not, Night 2 switches to the 2-stem fallback and STATE.md should say so explicitly.

---

### Night 2 — The separation pipeline

**Objective:** full-song 4-stem separation, cached, cancellable, with honest progress.

Tasks:
1. Chunked inference with overlap-add reconstruction across the full song
2. Progress UI (per-chunk, time remaining), cancel, and resume-safe behaviour
3. WebGPU detection with WASM fallback path and clear messaging
4. IndexedDB stem cache keyed by file hash; instant reopen of previously separated songs
5. Memory management: release tensors per chunk, cap concurrent buffers, test with a 7-minute track
6. Minimal stem playback proof: play the four stems sample-locked through the engine (mixer UI is Night 3)
7. Integration test: separate a known track, assert stem RMS profiles differ as expected

Done means: a full song separates end to end on my machine, survives a reload from cache, and plays back as four synced stems.

---

### Night 3 — The practice experience

**Objective:** the product feels like a practice tool, not a tech demo.

Tasks:
1. Stem mixer: per-stem gain, mute, solo with proper solo-group logic
2. Time-stretch and pitch-shift applied across all stems in sync; pitch ±6 semitones
3. Loop workflow polish: nudge markers, loop count-based speed ramping (start 70%, +5% per pass) as a stretch item
4. Project persistence: recent songs list, saved loops per song, last-used mixer state
5. Editable scribble strips per stem, persisted per song (design spec section 4.7)
6. Keyboard-first UX pass and a visual audit of every screen state against `woodshed-design-spec.md` sections 3 to 7; this is compliance against a locked spec, not invention
7. Performance pass: waveform rendering at 60fps during playback, no audio dropouts while UI is busy
8. Playwright flows: load, separate (mock worker), mix, loop, reload

Done means: learn-a-bassline test passes: drop song, solo bass, slow to 75%, loop the bridge, and it feels good.

---

### Night 4 — Chords and export

**Objective:** the paid feature set exists.

Tasks:
1. Chromagram extraction in the analysis worker (FFT-based pitch-class profile, tuned window and hop)
2. Chord template matching (maj, min, 7th triads to start) with Viterbi smoothing over frames
3. Chord lane on the timeline, synced with playback, tap a chord block to seek
4. Stem export to WAV (16-bit and 24-bit), zip of all stems
5. Feature-flag plumbing: free versus paid gates in place but permissive in dev
6. Accuracy check against three known songs; log honest results in STATE.md; label the feature beta in UI
7. Stretch only: metronome with count-in. Cut first if time is short

Done means: chords display in sync on a well-known song with credible accuracy, and stems export cleanly.

---

### Night 5 — Productisation and launch readiness

**Objective:** a stranger can find it, try it, pay, and use it offline.

Tasks:
1. Lemon Squeezy licence key activation, local caching, offline grace, deactivation
2. Free/paid gating live; upgrade prompts that are polite, not naggy
3. PWA: service worker, model and app caching, genuine offline function post first load
4. Model delivery from R2 with progress on first download and integrity check
5. Landing page: demo video placeholder, privacy pitch (your audio never leaves your device), pricing, FAQ
6. Cross-browser QA: Chrome and Edge full path, Safari and Firefox degrade gracefully with clear messaging
7. Error handling and telemetry-free diagnostics (local log export for support)
8. Final STATE.md: launch checklist, known issues, v1.1 candidate list

Done means: clean machine test passes: fresh browser, land on page, buy with a test key, separate a song, go offline, keep practising.

---

## 6. Pre-flight checklist (daylight tasks, not build nights)

- [ ] Buy domain (£10 to £15)
- [ ] Cloudflare account: Pages project plus R2 bucket
- [ ] Obtain Demucs ONNX model files; upload to R2 (before Night 2)
- [ ] Lemon Squeezy account and product created with test mode key (before Night 5)
- [ ] Pick the name (Woodshed is now the working assumption; the design spec is built around it)
- [ ] Download woff2 files for Barlow Semi Condensed, Caveat, and Share Tech Mono for self-hosting (before Night 1)
- [ ] Gather test material: three well-known songs plus one of Jack's own recordings

## 7. Costs

Domain £10 to £15 a year. Hosting and R2 effectively £0 at launch. Lemon Squeezy roughly 5% plus 50p per sale. Total cash to market: under £50.
