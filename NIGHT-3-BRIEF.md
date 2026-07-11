# NIGHT-3-BRIEF.md — Woodshed, Night 3 of 5

You are running Night 3 of a five-night one-shot autonomous build. Work through the whole brief without stopping to ask questions; make sensible decisions, record them, and keep going. British English throughout, no em dashes.

## Machine-safety constraint (read first, applies to everything)

The development laptop has thermally shut down and hard-frozen under sustained full-load separation. **Night 3 must not run a real full-song separation at any point, including in tests.** Mock the separation worker exactly as the existing e2e tests do. No benchmark, soak, or full-load task. This is non-negotiable and takes priority over completeness. Night 3 scope is deliberately light-load UI, interaction, and persistence work that does not stress the machine.

## Read first, in this order

1. `STATE.md`, Night 2 section (what shipped, the working pipeline, known issues)
2. `practice-studio-build-plan.md`, Night 3 section
3. `woodshed-design-spec.md`, sections 4, 5, and 7 (strips, layout, states), plus section 10 (things to resist)

## Fix first: stem-label mapping bug (from Night 2)

Separated stems are currently displayed with mismatched labels (drums shown as bass, vocals as drums, and so on). Root cause is almost certainly a wrong stem-order mapping between the htdemucs output tensor and the UI's stem list. htdemucs output order is fixed: index 0 drums, 1 bass, 2 other, 3 vocals. Fix the mapping at the point where model output is assigned to named stems, so the named order is the single source of truth; the UI then displays in whatever order the design spec wants by looking up by name, never by index. Add a test asserting each named stem maps to its correct output index. Do NOT fix this by reordering labels to match one test song, which can coincidentally line up and break elsewhere. This must be correct before the solo work, because solo and mute act on named stems and would otherwise silence the wrong track.

## Scope, in priority order

Do these in order. If time runs short, the later items are the ones to defer to a Night 4, not the earlier ones.

### 1. Explicit SEPARATE control (do first)
Replace auto-separation-on-load. A loaded but un-separated song shows the single-track player, live and usable, plus a clearly-labelled SEPARATE control on the desk (hardware-styled, per the design language, not a web button). Separation runs only on deliberate press of that control. This is both the correct product design and a safety measure: the heavy operation must never fire as a side effect of dropping a file. Cached (already-separated) songs skip straight to the four-stem view with no SEPARATE step.

### 2. Solo logic (the core interaction, this is the acceptance test)
Solo across the four channel strips with correct solo-group behaviour: engaging solo on one or more stems mutes all non-soloed stems; multiple solos are additive; releasing all solos restores the prior mute state. Solo and mute interact correctly (an explicitly muted stem stays muted even if soloed elsewhere, per standard console behaviour). Waveform lanes dim for silenced stems per spec 4.9. Keyboard: S toggles solo on the focused strip, M toggles mute.

### 3. Single spanning playhead and visual compliance
Replace the current per-lane playheads with one playhead line spanning all lanes, per the design spec. Then audit every screen state against design-spec sections 3 to 7 and fix drift: materials, engraving, LED behaviour, LCD states, the separation-progress and locked-feature states. This is compliance against a locked spec, not invention.

### 4. Pitch-shift across all stems
Pitch-shift, plus or minus 6 semitones, applied to all stems in sync, reusing the existing 8-channel stretch node (signalsmith-stretch supports independent pitch and rate). Add the pitch control to the desk (it was intentionally omitted on Night 1 as a dead control). Independent of tempo: changing pitch must not change speed and vice versa.

### 5. Persistence (defer first if time is short)
In IndexedDB: saved loops per song (name, in/out points, restore on reopen) and editable scribble strips per stem (click to edit, 24 chars, per song, default to stem name), per design spec 4.7. Last-used mixer state (fader, mute, solo, tempo, pitch) restored on reopen.

## Constraints

- Everything from Nights 1 and 2 still applies: design-spec tokens only, no localStorage/sessionStorage (IndexedDB is correct), permissive licences only (no GPL/AGPL/LGPL), design spec section 10, models never committed.
- Do not regress the single-track player or the Night 2 separation pipeline.
- Tests mock the separation worker; no real separation runs. Keep the overnight run low-load.
- Do not start Night 4 scope (chord detection, stem export, licensing).

## Done means

Load a song, press SEPARATE, get four stems (or, for a cached song, four stems immediately with no SEPARATE step); then solo the bass, slow to 75 percent, shift down 2 semitones, loop the bridge, and it feels good; one playhead spans all lanes; saved loops and scribble edits survive a reload; all tests green with no real separation executed.

## End of run

Write the Night 3 section of STATE.md: what shipped, commits, test counts (confirming no real separation ran in the suite), decisions and why, known issues, and a recommendation for Night 4. Ensure the working tree is clean, committed, and pushed to origin.
