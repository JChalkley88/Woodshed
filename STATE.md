# STATE.md — Night 1 aborted before build start

**Date:** 10 Jul 2026
**Status:** STOPPED at pre-flight, per the brief's own instruction. No build work was done.

## Why the run stopped

`NIGHT-1-BRIEF.md` requires four files to be read before starting and says: "If any of files 1 to 4 are missing, stop immediately and write STATE.md explaining what was absent."

File 3, **`woodshed-desk-mockup.html`** (the approved visual reference for the design spec), is not present anywhere in the repository. A full-tree search for `*mockup*` and `*.html` found only `woodshed-reference/index.html`, which is the demucs-onnx browser demo page from the reference scaffold, not the desk mockup.

## Pre-flight inventory

| Required file | Present |
|---|---|
| 1. `practice-studio-build-plan.md` | Yes (read in full) |
| 2. `woodshed-design-spec.md` | Yes (read in full) |
| 3. `woodshed-desk-mockup.html` | **No — absent, run stopped** |
| 4. `models/vite-ort-config-reference.txt` | Yes |
| 5. `woodshed-reference/` (demo.js, index.html, README.md) | Yes |

Also present: `models/htdemucs.onnx` (316 MB, fp32) and `models/htdemucs_fp16weights.onnx` (166 MB, fp16), so the spike is unblocked once the mockup lands. No `/assets/fonts` directory exists yet, so unless the woff2 files are added the build will fall back to system typefaces as the brief permits.

## What shipped

Nothing. No scaffold, no commits, no tests, no spike benchmarks. The working tree contains only the input documents plus this file.

## Why not proceed anyway

The design spec is detailed enough to build the token file and much of the hardware library, but the brief names the mockup as "the approved visual reference; open it, study it, match it" and makes its absence an explicit hard stop. Overriding a hard stop on night 1 of a five-night autonomous chain risks baking in a look that fails the morning review and poisons Nights 2 to 5, so the conservative reading wins.

## Recommendation for relaunch

1. Drop `woodshed-desk-mockup.html` into the repo root (the design spec dated it 10 Jul 2026, so it should exist somewhere on this machine).
2. Optionally add the three woff2 faces under `/assets/fonts` (Barlow Semi Condensed 500/600, Caveat 600, Share Tech Mono) to avoid the system-fallback path.
3. Relaunch the same Night 1 brief unchanged. Everything else needed for the full night, including both ONNX models for the spike, is already in place.
