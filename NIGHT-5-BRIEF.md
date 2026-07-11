# NIGHT-5-BRIEF.md — Woodshed, Night 5 of 5 (launch readiness)

You are running Night 5, the final night, of a five-night one-shot autonomous build. Work through the whole brief without stopping to ask questions; make sensible decisions, record them in STATE.md, and keep going. British English throughout, no em dashes, no exclamation marks.

## Goal

Turn the working build into something a stranger can find, try, pay for, and use offline. After tonight a person should be able to land on the page, understand what Woodshed is, try it, buy a licence, separate a song, go offline, and keep practising.

## Load and safety note

The machine is thermally stable (earlier freezing was a graphics-driver bug, now fixed). Keep tests light regardless: do not build suites that run repeated real separations. The existing `e2e/integration.spec.ts` (one real separation, ~37s) may run once as a baseline. Cross-browser QA tonight is about code paths and graceful degradation, not running real separations in every browser.

## Preflight (confirm and record in STATE.md before any change)

1. git status clean; Night 4 committed and pushed; origin/main matches HEAD.
2. Models present in `models/`.
3. Baseline green: typecheck, unit suite, e2e suite (including the one real-separation integration test). Note any pre-existing skips.

## Read first, in this order

1. `STATE.md`, Night 4 section (the licence gate and `featureUnlocked` integration point, PWA-ready CDN-free choices, the model-size discussion)
2. `practice-studio-build-plan.md`, Night 5 section
3. `woodshed-design-spec.md` sections 2, 7, and 10 (typefaces now present, LOCKED and licence states, things to resist)

## Settled decisions (do not relitigate)

- **Model shipped from R2: the 166MB fp16 baseline** (`htdemucs_fp16weights.onnx`), not the 345MB pre-optimised file. Smaller first download and lower egress win; the ~40s one-time-per-session warmup is absorbed behind the existing WARMING UP state. Keep the pre-optimised file documented as a fallback if warmup complaints surface, but ship the 166MB file.
- **Chord detection ships as a labelled beta**, not a headline feature. It works on sparse and acoustic material and struggles on dense full-band mixes (validated on real songs). Launch copy must present it honestly as beta that shines on sparse arrangements, never as a core promise. Chord detection from separated stems is a v1.1 upgrade.

## Scope, in priority order

### 1. Licence purchase and validation (Lemon Squeezy)
Wire real licence purchase and key validation into the existing gate via the single `featureUnlocked` integration point. Licence key activation against Lemon Squeezy's API, activation result stored in IndexedDB, revalidated periodically, with graceful offline behaviour: once activated, paid features keep working offline. Deactivation path. A licence panel styled as a rack unit (already specced) for entering and activating a key. Use Lemon Squeezy test mode; do not hard-code any secret. If live product/variant IDs are not available in the environment, build against test-mode placeholders and note in STATE.md exactly what must be filled in before real launch.

### 2. PWA and offline
Service worker caching app shell, the ORT runtime, the model, and the self-hosted fonts, so the tool genuinely works offline after first load (everything was built CDN-free for this). Honest first-load experience: the model is 166MB, so first load shows clear download progress with an integrity check; subsequent loads are instant and offline-capable. Cached-once, works-forever. Test the offline path (load, go offline, separate a cached song, keep practising).

### 3. Model delivery from R2
Serve the 166MB model from Cloudflare R2 (free egress) with first-download progress and an integrity check (hash verify). Document the R2 bucket setup and the production `_headers` requirement (COOP/COEP for the threaded WASM path) in STATE.md. If R2 credentials are not in the environment, build the delivery and progress code against a configurable model URL and note what to point it at.

### 4. Landing page
A single landing page that sells the product honestly: what Woodshed is (a local, private, one-time-purchase practice studio), the privacy pitch (your audio never leaves your device), pricing (one-time licence), an honest feature list (separation, stem mixing, solo, loop, tempo, pitch-shift; chords as beta), and an FAQ (offline, dark-only, desktop-focused, how separation time varies by hardware). Hardware and brand aesthetic consistent with the desk. A demo video placeholder is fine. No overclaiming, no "transform/leverage/unlock", no em dashes or exclamation marks.

### 5. Cross-browser QA and graceful degradation
Chrome and Edge: full WebGPU path. Firefox: WebGPU often absent, so verify the WASM fallback path and clear messaging. Safari: verify COOP/COEP and the threaded WASM path, and the honest revised-time message. Below the desktop breakpoint: the "Woodshed is built for desktop" panel per the design spec. Every degradation path shows an honest hardware-styled message, never a broken desk. Add e2e coverage for the capability-detection and messaging branches (mock the capabilities; do not run real separations per browser).

### 6. Final launch checklist
End with a STATE.md launch checklist: what is done, what still needs a human before real launch (live Lemon Squeezy IDs, R2 credentials and upload, domain, demo video, the daylight chord listen already done), and known issues.

## Constraints

- Everything from Nights 1 to 4 applies: design-spec tokens only, no localStorage/sessionStorage except where the service worker/PWA legitimately requires its own storage (document any such use), permissive licences only, design spec section 10, models never committed.
- Do not regress any existing feature.
- No real payment secrets or credentials committed; test mode and configurable placeholders only.
- Keep tests light; no repeated real separations.

## Done means

A stranger can: load the landing page and understand the product; open the app; on first load see honest model-download progress; separate a song; activate a licence key (test mode) to unlock export and chords; go offline and keep practising a cached song; and on an unsupported browser see an honest degradation message rather than a broken desk. All tests green. STATE.md ends with a clear, honest launch checklist of the human steps remaining.

## End of run

Write the Night 5 section of STATE.md: what shipped, commits, test counts, the launch checklist (done versus human-still-needed), decisions and why, known issues, and the v1.1 roadmap (six-stem, chords-from-stems, stem compression, extended chord vocabulary). Ensure the working tree is clean, committed, and pushed to origin. This is the final build night; make the closing STATE.md read as a genuine handover to launch.
