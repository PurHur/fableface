# WISP IV — research synthesis & concept

*2026-07-11. Two research tracks: (1) iconic sci-fi hologram/AI visual languages
(Joi/BR2049, Cortana, JARVIS-FUI, Star Wars, HAL/GLaDOS/Ghost, Vision, Matrix,
GITS solograms, Ex Machina, Westworld, Arrival, Annihilation + Territory
Studio/Ash Thorp/Jayse Hansen FUI principles); (2) real volumetric-display and
point-cloud aesthetics + motion-animacy research (Koblin/House of Cards, Voxon,
POV spinners, Pepper's ghost, Odradek scan pulses, curl-noise/Bridson,
murmurations, Blue Brain cortical visualization, Heider-Simmel animacy
literature). Full agent reports in the session; sources cited there.*

## The organizing insight

WISP I–III are *renderings of a head*. Every landmark reference splits into two
halves that our stack can finally unify:

- **The costume** (what the hologram is made of): rim-lit hollow glass, scan
  rows, slice sweeps, chromatic misconvergence, transmission artifacts.
- **The nervous system** (why it feels alive): reaction-at-a-distance,
  traveling activation, goal-directed reassembly, state-as-optical-artifact.

Animacy research is unambiguous: **self-initiated reaction without contact is
the strongest "it's alive" trigger**; traveling signals (not twinkling) read as
computation; strict periodicity flips perception from creature to machine — so
everything loud must be event-gated and Poisson-timed.

**WISP IV = "SIGNAL BEING": a presence whose inner state is physically visible
in its own light.** Not a better dust cloud — software with feelings, rendered
as optics.

## The composition stack (all vertex-shader-only on the existing 105k buffer)

### 1 · Material — "hollow glass being" (always on)
- **Fresnel rim weighting** (1 dot product; normals already per-particle):
  silhouette runs hot, camera-facing skin goes dim/glassy. *Also fixes additive
  white-clipping in the face center — correctness + style in one term.*
- **Depth-weighted hollow shell** (Joi backshell): back-facing particles at
  ~30% — you see the inside of the back of her head through the face.
- **Thin LiDAR honesty** (seasoning): range jitter along the view ray, grazing
  dropout, rare sector loss.

### 2 · Metabolism — never still (always on)
- **Curl-noise breath**: divergence-free micro-circulation, amplitude *masked
  near eyes/mouth* so identity anchors stay crisp (Arrival's rule: liquid that
  never stops; nothing may look CG).
- **Data-skin substrate** (Cortana): glyph/code luminance crawling under the
  surface in head-UV; contrast + scroll rate rise with `thinking`.

### 3 · Nervous system — the animacy layer (event-driven)
- **Startle dodge** (murmuration): pointer approaches → local patch of the
  cloud flinches away, then settles. Reaction-at-a-distance = the #1 animacy
  cue. Uses existing pointer + a poke uniform.
- **Cortical storms**: epicenter waves of white-hot activation traveling
  across the head (propagation delay ∝ distance). Rate gated by driver state:
  sparse embers idle, dense storms while `thinking` — a legible cognition
  meter. Trail buffer turns every spike into a fading ember for free.
- **Uncertainty moiré** (Joi-in-rain): two near-frequency gratings multiply
  brightness into traveling interference bands while `listening`/contradicted,
  resolving as "confidence" returns.
- **Pause-freeze** (Joi emanator): on interrupt/stop — velocities zero in one
  frame, 20% desaturate, dim flicker; resume ripples outward from the chest.

### 4 · Voice — direction = meaning
- **Chromatic plane separation** (Joi giant): per-particle R/G/B channel
  assignment with small depth offsets — converged at rest (sums back to white
  cyan), **misconverging with speech energy and head motion**. Additive
  blending is the native medium for this; single pass.
- **Scan pulses**: radiate *outward from the mouth* when speaking, *converge
  inward* when listening (Odradek grammar: hot leading edge + tinted echoes).

### 5 · Transitions — entrances are vocabulary
- **Slice-plane materialization** (GITS/Westworld) for wake/boot: bright
  leading band sweeps up, particles overshoot and settle; pre-activation shown
  as dim matte-white lattice.
- **Ink dissolve/reform** (Arrival) for sleep: staggered curl-field departure;
  reassembly toward home = goal-directed motion (a burst of perceived agency).
- **Rampancy corruption** (Cortana, rare): `alarm`/overload only — hue slams
  red, jagged displacement, 2–3 ghost duplicates flickering ±5–10cm.

### 6 · Ornament — meaning-bearing only (Territory rule)
Evolve the orbit rings into **tiered instrument rings**: inner ring = live
emotion arc (fill = intensity, color = emotion), mid = speech level ticks,
outer = state glyph train. Every element means something; no static decoration.

## Optional "costume modes" (switchable renderer personalities)
The hardware-mimicry looks compose as alternate materials over the same
nervous system: **Koblin raster** (structured-light scan rows + dropout),
**Voxon sweep** (reciprocating slice plane + persistence via trail buffer),
**Matrix code-face** (mirrored-glyph takeover for introspection moments),
**POV spinner** (diagnostic mode). Cheap to add later; not core.

## Feasibility notes
- Everything is per-particle math on existing attributes (home/normal/seed) +
  existing uniforms; no inter-particle communication, no CPU sim.
- Trail ping-pong (WISP III) is reused as persistence-of-vision + ember decay.
- Chromatic separation = per-particle channel assignment (seed%3) — one pass.
- New uniforms needed: uPointer (head-space), uInterrupt, uConfidence,
  uStormRate (all derivable from existing driver channels + tiny driver adds).
- Perf: same particle count, ~30 extra VS ALU — SwiftShader unaffected-ish.

## Recommendation
Build the full **SIGNAL BEING** stack (1–6) as `face-wisp4.js`, default tab.
It is a true generational claim: III made the hologram *move*; IV makes it
*legibly think, feel, doubt, and react* — the correct face for a real AI
companion. Costume modes ship later as a settings row if wanted.
