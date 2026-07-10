# Woodshed

A browser-based practice studio for musicians. Drop in a song from your own
library, slow it down without changing pitch, loop the hard bars, and (from
Night 2) split it into stems — all on your own machine. Nothing is uploaded.

Built as a five-night autonomous build; see `practice-studio-build-plan.md`
for the plan, `woodshed-design-spec.md` for the design contract, and
`STATE.md` for the current state of the build.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :5173 (COOP/COEP headers on, /models and /ort served locally) |
| `npm run build` | Typecheck and production build |
| `npm test` | Vitest unit and component tests |
| `npm run test:e2e` | Playwright flows (starts the dev server itself) |
| `npm run lint` | ESLint |
| `npm run spike` | Night 1 separation benchmark in real Chrome (needs `models/*.onnx`) |

## Routes

- `/` — the studio desk
- `/hardware` — visual QA page: every hardware component in every state
- `/spike` — dev-only ONNX separation benchmark harness

## Notes

- Model files live in the gitignored `models/` folder and are served only in
  dev; production delivery comes from Cloudflare R2 (Night 2+).
- The ONNX Runtime WASM/WebGPU runtime is bundled locally (no CDN), so the
  product works fully offline. Cloudflare Pages needs the COOP/COEP headers
  in `public/_headers`.
- Typefaces are self-hosted; drop the woff2 files into `public/assets/fonts/`
  (see `src/styles/fonts.css`) and they activate without code changes.
