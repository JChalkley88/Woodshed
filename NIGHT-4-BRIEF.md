# NIGHT-4-BRIEF.md — Woodshed, Night 4 of 5

You are running Night 4 of a five-night one-shot autonomous build. Work through the whole brief without stopping to ask questions; make sensible decisions, record them in STATE.md, and keep going. British English throughout, no em dashes, no exclamation marks.

## Machine and load note

The laptop's earlier freezing was traced to an out-of-date graphics driver and is fixed; the machine is now thermally stable. Even so, keep this night low-load: chord analysis is CPU-light compared with separation, but it must run in a worker and be cancellable, and tests must not run repeated real full-song separations. The existing `e2e/integration.spec.ts` (one real separation, ~34s) may run once if needed for an export test, but do not build suites that separate repeatedly.

## Preflight (confirm and record in STATE.md before any change)

1. git status clean; Night 3 committed and pushed; origin/main matches HEAD.
2. Models present in `models/`.
3. Baseline green before any change: typecheck, unit suite, and e2e suite (including `integration.spec.ts`, which passed supervised at 34.5s on 11 Jul 2026). Note any pre-existing skips.

## Read first, in this order

1. `STATE.md`, Night 3 section (what shipped, the named-stem model, the SEPARATE flow, persistence)
2. `practice-studio-build-plan.md`, Night 4 section
3. `woodshed-design-spec.md`: section 5 (the deck already reserves the chord lane slot), section 4.6 (LCD), section 7 (states, including the LOCKED greyed-hardware treatment), section 2 (typefaces), section 10 (things to resist)

## Scope, in priority order

Do these in order. If time runs short, defer from the bottom.

### 1. Chord detection
Chromagram extraction plus chord recognition in a dedicated analysis worker (not the separation worker). FFT-based pitch-class profile with a tuned window and hop; chord template matching over maj, min, and dominant-7 triads to start, with Viterbi (or equivalent) smoothing over frames so the output does not flicker chord-to-chord. Runs on user action, in a worker, cancellable, reusing the explicit-heavy-work pattern from Night 3. Licence-clean: hand-rolled chromagram and templates, no essentia.js (AGPL). Cache results per song in IndexedDB alongside stems. Label the feature beta in the UI; accuracy is credible-not-perfect and that is fine.

### 2. Chord lane
Render detected chords in the chord lane the deck already reserves (spec section 5), synced with playback: the current chord lit per the LCD chord treatment in spec 4.6 (current full-bright with outline, past dimmed, upcoming dim). Tapping a chord block seeks to it. Honest empty state before analysis has run.

### 3. Stem export
Export separated stems to WAV (16-bit and 24-bit) and a zip of all stems. Hardware-styled controls, no web furniture. This is a paid feature (see licensing below): present but gated. Use it as the first real exercise of the LOCKED state.

### 4. Licensing feature-flag plumbing and LOCKED states
Put the free/paid gate in place but permissive in dev (a dev flag unlocks everything so nothing blocks the build). Paid features tonight: stem export, chord detection. Free: separation, mixing, solo, loop, tempo, pitch. Implement the LOCKED state exactly per spec section 7: the control stays physically present on the desk, its LED unlit, its readout showing LOCKED; interacting opens a licence panel styled as a rack unit (no modal, no web dialog). Do NOT integrate Lemon Squeezy tonight; that is Night 5. Tonight is only the gate, the flag, and the LOCKED visual, with e2e coverage of both locked and unlocked states.

### 5. Loop discoverability (folded in from Night 3 hand-testing)
The loop engine works but its entry is hidden behind the L key. Add visible A and B loop controls to the existing LOOP section of the master, so a loop can be set, engaged, and cleared by clicking as well as by keyboard. Make the LOOP LCD double as state feedback: NO LOOP, then SET B (after A is placed), then the in/out times once both are set. Keep the existing L-key workflow exactly as is. Add a small always-visible shortcut hint. Hardware idiom throughout, per section 10.

### 6. Typefaces (folded in from Night 1 carry-over)
The three spec typefaces are still absent; system fallbacks are active. Fetch Barlow Semi Condensed, Share Tech Mono, and Caveat (all free, Google Fonts / SIL OFL), generate or obtain woff2 files, and place them in `public/assets/fonts/` matching the filenames already referenced in `src/styles/fonts.css`. Self-hosted only, no runtime CDN calls (offline requirement). Confirm in STATE.md that the desk renders in the real typefaces.

## Constraints

- Everything from Nights 1 to 3 applies: design-spec tokens only, no localStorage/sessionStorage (IndexedDB is correct), permissive licences only (no GPL/AGPL/LGPL), design spec section 10, models never committed.
- Do not regress the player, the separation pipeline, solo, loop, pitch, or persistence.
- Chord analysis runs in a worker, cancellable, on user action; no heavy work as a page-load side effect.
- Do not integrate the real payment provider tonight (Night 5).
- Do not start Night 5 scope (Lemon Squeezy, PWA/offline, model on R2, landing page, cross-browser QA).

## v1.1 note (record, do not build)

Six-stem separation (htdemucs_6s, which splits guitar and piano into their own stems) is a confirmed v1.1 upgrade, not v1. It touches the four-strip desk layout and costs more compute, so it is out of scope for the five-night build. Note it in STATE.md's v1.1 candidate list so it is not lost.

## Done means

Run chord detection on a separated song and see synced chords in the lane with a lit current chord; export stems to WAV and a zip; the export and chord controls show a correct LOCKED state when the dev unlock flag is off and work when it is on; a loop can be set and cleared by clicking as well as by L; the desk renders in Barlow, Share Tech Mono, and Caveat; all tests green with no repeated real separations.

## End of run

Write the Night 4 section of STATE.md: what shipped, commits, test counts (noting no repeated real separations), chord accuracy observed on a couple of test songs (honest numbers), decisions and why, known issues, the v1.1 candidate list, and a recommendation for Night 5 (Lemon Squeezy, PWA offline, R2 model delivery, landing page, cross-browser QA). Ensure the working tree is clean, committed, and pushed to origin.
