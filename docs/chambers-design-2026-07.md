# FABLEFACE — Chambers: research & design (2026-07-12)

Realistic environments the AI companion "lives in" and chooses to fit the moment.
Synthesized from three research passes (companion environments & situations;
lighting/colour/biophilic psychology; real-time atmospheric GLSL). This is the
build spec for replacing the abstract scenes with parameterisable, premium rooms.

## Design principles (premium, not "low-poly")
1. **No uniform light / no hard grid.** Every backdrop is gradients + one motivated
   key light + soft vignette. Replace every `step` with `smoothstep`, every branch
   with `mix`.
2. **Volumetric light + haze + depth layering** (aerial perspective) — the #1 cue
   that reads as "shot", not "rendered". 3+ parallax depth planes.
3. **Ambient life** — dust/embers/pollen/ripples/stars; small autonomous motion.
4. **HDR budget for bloom:** base 0.02–1.0, mid-glows 0.3–1.5, hot cores (sun,
   ember, pedestal, glints) 3–30. Only deliberate elements exceed 1.0. Dither
   before quantise to kill banding.
5. **Colour-temperature = mood dial** (measured): 2200–2700K warm = comfort/calm
   (2700K measurably reduces fear bias); 4000–5000K neutral-cool = focus;
   >5500K cool = alert (use sparingly). Warm lights vs cool shadows = cinematic.
6. **Hue→emotion:** blue-green/teal = calm; amber/gold = warmth/joy; indigo/violet
   = focus+awe; red/orange = energy accents only.
7. **Biophilia** (strongest stress-reducer): daylight + greenery + water together.
   Keep organic noise complexity in the calming fractal band **D≈1.3–1.5** (not
   razor detail). **Prospect-refuge:** dark enclosing foreground + bright deep vista.
8. **Awe = vastness** (tiny near-field vs enormous deep field → "small self").
9. **Motion is slow** (0.005–0.15 Hz drift, breathing light). Fast = cheap.

## Universal scene parameters (the LLM's vocabulary — every chamber accepts these)
`light` (night↔day / brightness) · `warmth` (cool↔warm CCT) · `fog` (haze/air) ·
`energy` (ambient motion tempo) · `ambient` (particle density) · `saturation` ·
`accent` (ties head emissive/rim to the room). Each chamber ships sensible
defaults the AI overrides, e.g. `setScene('hearth', { warmth: 0.9, light: 0.2 })`.

## The lineup (core 6 + 2 specials + the 2 existing chambers)

| Chamber | Situation | Lighting (CCT) | Palette (sRGB) | Ambient life | Signature params |
|---|---|---|---|---|---|
| **Solarium** *(default)* | greeting / idle | daylight key 3800–4500K | cream `#F4E4C1`, honey `#E8B15A`, teal-grey shadow `#3A4A4E`, foliage `#6FA07A` | dust motes in god-ray, slow foliage sway | `god_ray`, `dust`, `foliage_sway`, `sky_clarity` |
| **Hearth** | comfort / user sad | firelight 2200–2700K, low | shadow `#160D07`, glow `#B4531E`, core `#FF7A2A`, ember `#FFC46B` | fire flicker (6–12 Hz), rising embers, rain-on-glass | `fire`, `flicker`, `rain_glass`, `enclosure` |
| **Verdant** | calm / restoration | dappled canopy 5000–5500K | canopy shadow `#0F2419`, sunlit leaf `#8FBF6A`, shaft `#FBF3C9`, sky peek `#CDE7F0` | pollen drift, dappled light wobble, falling leaf | `canopy_dapple`, `pollen`, `sky_peek`, `sway` |
| **Stillwater** | meditation / rest / night | soft high-key 5500K (night→2700K) | mist `#CFDAD7`, water `#5E807F`, stone `#8B8578`, sky `#E0ECEA` | breath-synced ripples, mirror reflection, drifting mist | `mist`, `ripple` (breath-sync), `reflection`, `night_dim` |
| **Observatory** | deep thinking / awe | near-black + cool rim, brass accents 3000K | space `#05060F`, nebula violet `#4A2E6E`, teal `#1E5A6B`, star `#EAF2FF` | slow star parallax, nebula billow, orrery rotation | `star_density`, `nebula`, `orrery`, `constellation_link` |
| **Terrace** | celebration / good news | warm key 2200K vs 5000K sky | coral `#FF7E5F`, violet sky `#6A4C93`, gold bokeh `#FFC978` | rising lanterns / sparks, city bokeh twinkle | `sky_gradient`, `city_lights`, `celebration_burst`, `warmth_flush` |
| *Clearmind* (special) | focused work / help | even diffuse 4000–5000K | off-white `#EAEEF1`, slate `#2E3B45`, cool accent `#5B87A6` | near-none (restraint = focus) | `focus_beam`, `clutter=0`, `grid_subtlety` |
| *Signal Room* (special) | alert / urgent | low ambient, hard amber/red accent | charcoal `#14171C`, amber `#FFB020`, red `#FF4D4D` | almost none — one slow scan sweep | `alert_level` (amber→red), `vignette`, `strip_ambient` |
| **Chamber II** *(exists)* | neutral premium studio | soft cyan stage | — | orrery of orbital motes around the head | (uses universal set) |
| **Chamber** *(exists)* | classic holo-room | cyan grid | — | instrument rings | (uses universal set) |

## Situation → chamber routing (what the AI picks)
| Situation | Chamber | Key tweaks |
|---|---|---|
| Greeting / idle | Solarium | `light`=match user clock, `energy`=low |
| Sad / needs comfort | Hearth | `warmth`≈0.95, `light`=low, `enclosure`=high, `rain_glass`=on |
| Stressed / anxious | Verdant or Stillwater | biophilia / blue-green + slow motion |
| Low mood, lift it | Solarium (golden) or Terrace | warm gold, gentle bloom |
| Celebration | Terrace | `celebration_burst`=high, `warmth_flush` on delivery, pull camera back |
| Deep thinking | Observatory | `star_density`=high, `constellation_link`→1 as answer forms |
| Focus / working | Clearmind | 4500K even, `focus_beam` tight, `clutter`=0 |
| Meditation / breathing | Stillwater | `ripple`=breath-synced, `reflection`=high |
| Rest / night / goodbye | Stillwater (night) | `night_dim`=on, 2700K, `energy`=minimal |
| Alert / urgent | Signal Room | `strip_ambient`=1, `alert_level`=amber (red = true danger) |

## Build approach
- One shared background fragment shader (`SCENE_BG_FS`, `sc==id` branch per chamber),
  fed universal-param uniforms (`uSLight/uSWarmth/uSFog/uSEnergy/uSAmbient/…`), with a
  `uCustom` flag so legacy faces fall back to baked defaults.
- WISP VIII gets a signature particle-FX mode per chamber (like Chamber II's orrery):
  embers (Hearth), pollen (Verdant), ripple reflections (Stillwater), star/orrery
  (Observatory), lanterns (Terrace).
- Expose via SCENE chips + `FableFace.setScene(key, params)` / `setSceneParam` /
  `getScene`, and a Scene section in the TUNE panel.

## GLSL technique index (from research — see also live shader)
sky+ToD (palette + Mie `hg` glow) · god rays (analytic angular / SS radial scatter)
· fog (IQ distance+height, sun-tinted) · clouds/nebula (domain-warped fbm) ·
starfields (grid-hash + twinkle, layered) · aurora (triangle-noise curtains) ·
water (ray∩y=0, fbm ripple normal, Fresnel + sharp glint, reflection) · rain-on-glass
(cell drops refract background) · fireplace (warm flicker pool + rising embers) ·
canopy dapple (fbm leaf mask × shaft) · snow/pollen (parallax layers) · stage floor
(soft radial rings + pedestal glow, NOT grid) · dither before output.
Refs: IQ (iquilezles.org: fog, warp, functions, dither), Shadertoy (Seascape Ms2SD1,
Auroras XtGGRt, Heartfelt rain ltffzl), GPU Gems 3 ch.13 (god rays).
