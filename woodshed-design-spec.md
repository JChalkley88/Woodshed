# Woodshed — Design Specification v1

Companion to `practice-studio-build-plan.md`. This document is an input to Night 1 and the reference for the Night 3 polish pass. The approved visual reference is `woodshed-desk-mockup.html` (10 Jul 2026). Where this spec and the mockup disagree, this spec wins.

Design intent in one line: **a piece of studio hardware that happens to live in a browser.** Reference points are an SSL channel strip, a Technics SL-1200 pitch fader, and a Tascam tape deck. Nothing should read as a web app: no cards, no pill buttons, no SaaS chrome.

---

## 1. Design tokens

Implement as CSS custom properties in `tokens.css`. These are the only colour values permitted in components.

### Surfaces
| Token | Value | Use |
|---|---|---|
| `--panel` | `#232427` | Console panel face |
| `--panel-hi` | `#2C2D31` | Panel top-edge catchlight |
| `--panel-lo` | `#18191B` | Panel bottom edge |
| `--well` | `#101113` | Recessed areas (deck, fader slots) |
| `--chassis` | `#0B0B0C` | Page background behind the desk |
| `--edge` | `#0D0E10` | Panel border lines |

### Engraving (panel text)
| Token | Value | Use |
|---|---|---|
| `--engrave` | `#9A9B96` | Primary panel labels |
| `--engrave-dim` | `#6B6C68` | Secondary labels, scale numerals |
| `--engrave-faint` | `#4F504C` | Footer, legal, serial plate |

### Stem identity colours (permanent, never reassigned)
| Token | Value | Stem |
|---|---|---|
| `--stem-vocals` | `#E8A33D` | Vocals (also the brand accent) |
| `--stem-drums` | `#D85A5A` | Drums |
| `--stem-bass` | `#9B8CE8` | Bass |
| `--stem-other` | `#4FB8A0` | Other (guitars, keys, everything else) |

### LEDs
| Token | Value | Use |
|---|---|---|
| `--led-green` | `#6FE08E` | Meter segments 1 to 9 |
| `--led-amber` | `#E8C34D` | Meter segments 10 to 12, solo LED, loop lamp |
| `--led-red` | `#E24B4A` | Meter segments 13 to 14, mute LED, clip |
| `--led-off` | `#1C1D1F` | Unlit segment |

### LCD
| Token | Value | Use |
|---|---|---|
| `--lcd-bg` | `#0C1810` | LCD background |
| `--lcd-fg` | `#7CE08A` | Lit segments and text |
| `--lcd-dim` | `#1E3A26` | Unlit or upcoming text (future chords) |
| `--lcd-past` | `#3E6B4A` | Elapsed content (past chords) |

LCD text always carries `text-shadow: 0 0 8px rgba(124,224,138,0.5)`.

### Tape (scribble strips and song label)
`--tape: #E9E4D8`, border `#C9C2B0`, ink `#3A342A`. Every tape element gets a random rotation between -1deg and +1deg, assigned once and stored, not re-randomised on render.

### Wood
End cheeks: `repeating-linear-gradient(175deg, #4A3220 0 3px, #3D2917 3px 5px, #553B25 5px 9px)`.

There is no light mode. The product ships dark only. This is a deliberate positioning choice, not a shortcut; state it in the FAQ.

## 2. Typography

| Role | Face | Usage |
|---|---|---|
| Panel engraving | Barlow Semi Condensed 500 | All labels. Uppercase, letter-spacing 0.14 to 0.22em, sizes 9 to 11px |
| Brand plate | Barlow Semi Condensed 600 | WOODSHED at 0.32em tracking |
| LCD and numerals | Share Tech Mono | Time, tempo, pitch, chords, loop points. Tabular by nature |
| Scribble | Caveat 600 | Tape labels only. Never for UI controls |

Rules: no font below 8px (scale numerals only at 8px). Panel labels are always uppercase. LCD content is never uppercase-forced; chords render as written (Dm7, Bb). Self-host all three faces for offline PWA use; do not rely on Google Fonts at runtime.

## 3. Materials and depth

Skeuomorphism is achieved with exactly four devices, used consistently:

1. **Recession.** Anything that holds content (deck, fader slot, meter, LCD) is a well: `--well` or darker plus `inset` shadow, top-weighted.
2. **Extrusion.** Anything you grab (knob, fader cap, button) is raised: vertical gradient light-to-dark plus a 1px top catchlight `rgba(255,255,255,0.1 to 0.2)` plus a drop shadow.
3. **Engraving.** Text sits directly on the panel in `--engrave` tones. No text boxes, no backgrounds behind labels.
4. **Hardware furniture.** Corner screws, wooden cheeks, brand plate, serial plate. These appear once each; do not scatter them.

Forbidden: border-radius above 4px except circles, glassmorphism, blur, coloured drop shadows except LED glow, gradients on text.

## 4. Component anatomy

Build these as the `hardware/` component library on Night 1. Each is a controlled React component with real props, not decoration.

### 4.1 Knob
52px circle, radial gradient catchlight at 32% 28%. Indicator: 2.5px white line from centre to edge, rotation range -135deg to +135deg mapped to the value range. Skirt of 11 tick marks at 27deg intervals. Interaction: vertical drag (drag up increases), double-click resets to default, scroll wheel steps, arrow keys step when focused. Focus state: 1px `--stem-vocals` ring around the skirt. Props: `value, min, max, default, label, onChange`.

### 4.2 Fader
Slot: 9px wide well with inset shadow, rounded 4px. Cap: 30 x 44px, vertical brushed gradient, single horizontal scored line at its centre (2px, `#101113`). Scale to the left: dB markings +10 to -infinity in `--engrave-dim` 8px. Throw: 190px in channel strips. Interaction: vertical drag, double-click to unity (0dB), keyboard arrows when focused. The cap never travels beyond the slot ends.

### 4.3 Tempo fader (master)
Same anatomy, longer: 230px throw, 40 x 30px cap with an amber scored line (`--stem-vocals` with glow). Scale 50 to 120 with a machined zero-line across the slot at 100%. This is the single most touched control in the product; its drag physics get real attention on Night 3 (1:1 pointer tracking, no easing).

### 4.4 Button (MUTE, SOLO)
34 x 26px, 2px radius, extruded. LED window: 6 x 3.5px bar at top centre. States: off (LED `--led-off`), on (MUTE red, SOLO amber, with glow), pressed (translate down 1px, shadow reduced). Label engraved on the button face at 9px. Latching behaviour, not momentary.

### 4.5 LED meter
11px wide well containing 14 segments, 7px tall, 2px gap, bottom-up. Colour map: 1 to 9 green, 10 to 12 amber, 13 to 14 red. Driven by real per-stem RMS from the audio engine at roughly 30fps with a fast-attack slow-release ballistic (attack 0.25, release 0.08 per frame). Muted stems read zero. Lit segments carry a soft glow of their own colour.

### 4.6 LCD
Well with `--lcd-bg`, 2px near-black border, inset shadow. Content in Share Tech Mono with green glow. Variants: time counter (30px), tempo and pitch readouts (14px), loop in/out (12px, two lines), chord lane (15px chips). The current chord gets full `--lcd-fg` with a 1px `#2A4A33` outline; past chords `--lcd-past`; upcoming `--lcd-dim`.

### 4.7 Scribble strip
Tape rectangle under each fader. v1 behaviour: click to edit, plain text, 24 characters max, persisted per song in IndexedDB. Default text is the stem's short name. This is a real feature, not decoration; it appears in the Night 3 task list.

### 4.8 Transport
Round buttons: 44px standard, 56px play. Play is amber-filled with dark glyph; others are panel-toned with light glyphs. Loop button glyph in `--led-amber` when loop is engaged, plus a separate 7px loop lamp that blinks at 1.6s intervals (steps, not fade). Blink suppressed under `prefers-reduced-motion`.

### 4.9 Waveform lane
52px tall well per stem. Bars 2px wide at 3px pitch, colour = stem identity. Opacity states: in-loop 0.95, out-of-loop 0.45, muted 0.16, solo-excluded 0.16. Loop region: amber wash at 0.09 alpha with 1px amber edges, drawn once across all lanes. Playhead: 1.5px near-white line with subtle glow, spanning all lanes. Canvas rendered at 2x for sharpness; redraw on resize only, playhead moved by transform not redraw.

## 5. Layout

Fixed vertical order, one screen, no navigation:

1. Top rail: brand plate left, tape song label centre (flex), time LCD right
2. Deck: chord lane, then four waveform lanes
3. Console: four channel strips plus master section (master takes 1.35x strip width)
4. Footer: privacy line left ("All processing on this device — nothing uploaded"), serial plate right

Desk max-width 1160px, centred, wooden cheeks 26px each side. Breakpoints: below 1024px the console wraps to two rows (strips row, master row full-width horizontal); below 768px show a politely worded "Woodshed is built for a desktop or laptop" panel with the marketing pitch, since practice with a mouse-only phone layout is not a v1 target.

## 6. Motion

Budget is small and diegetic: things that would move on real hardware move; nothing else does.

- Meters: continuous, ballistic as in 4.5
- Playhead and time LCD: continuous during playback
- Loop lamp: 1.6s blink while engaged
- Buttons: 1px press translate, 80ms
- Fader and knob: zero easing, direct 1:1 tracking
- Forbidden: page transitions, skeleton shimmers, hover lifts, parallax

`prefers-reduced-motion`: meters update at 4fps without glow animation, loop lamp solid, playhead still moves (it is information, not decoration).

## 7. States and feedback

- Separation in progress: the deck shows the mixed waveform in grey with an LCD progress readout styled as tape transport ("SEPARATING 42%  EST 0:51"), channel strips present but faders locked with LEDs off
- Cached song reopened: lanes appear immediately, no progress state
- WebGPU absent: amber LCD warning line under the deck with plain-English wording and the estimated WASM time
- Error: red LED strip message in the deck well, message plus action, no modals
- Paid features unlicensed: control physically present but its LED unlit and its LCD reads "LOCKED"; clicking opens the licence panel styled as a rack unit. Never hide hardware; grey it

## 8. Accessibility floor

Keyboard: every control focusable, arrow keys adjust knobs and faders, space play/pause, L sets loop points, M and S per focused strip. Focus ring: 1px amber, offset 2px, visible on all controls. All controls carry aria labels and `role="slider"` with value text where applicable ("Bass fader, minus 3 decibels"). Meter values exposed via `aria-live="off"` (decorative) but stem mute state announced. Contrast: engraved labels on panel pass 4.5:1 (`#9A9B96` on `#232427` passes); scale numerals at `--engrave-dim` are decorative duplicates of accessible values.

## 9. Build plan amendments

- Night 1, add task: build the `hardware/` component library (Knob, Fader, Button, LEDMeter, LCD, ScribbleStrip, Transport) with a Storybook-style test page at `/hardware` for visual QA, driven by this spec's tokens
- Night 1 pre-flight: self-host the three typefaces
- Night 3, add task: editable scribble strips persisted per song
- Night 3 visual pass now means: audit every screen state against sections 3 to 7 of this document, not invent

## 10. Things to resist

Written down because overnight builds drift: no light mode, no settings for changing stem colours, no rounded friendly buttons in the licence flow, no toasts (LCD messages instead), no emoji anywhere, and the tape labels are Caveat only. If a feature cannot be expressed as hardware, the design answer is to redesign the feature, not to bolt a web widget onto the desk.
