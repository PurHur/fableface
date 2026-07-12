# Math research round — 2026-07-11 (applied in WISP VII)

Two web-research reports (motion math / surface math) distilled to what was applied.
Architecture rule that made it all feasible: **per-particle = closed-form field of
(rest position, id, t, uniforms); anything needing integration or a global sum =
one CPU update per frame, broadcast as a uniform.**

## Applied — CPU (driver.js, benefits every face)

1. **Ornstein-Uhlenbeck gaze micro-motion** (exact discretization, no Euler error):
   `X' = X·e^(−θΔt) + σ√((1−e^(−2θΔt))/(2θ))·N(0,1)`; θ = 1.8+2.4·coh (LMA bound
   flow), σ ≈ 0.0095·energy-scaled; stationary std ≈ old sine amplitude (0.004).
   Plus Poisson-timed microsaccade impulses (rate ~1.4 Hz/sacc, amp 0.005–0.012)
   relaxed by the same OU pull — tuned to fixational-eye-movement statistics.
2. **1/f pink breathing**: 5 octaved sines, amplitude 2^(−k/2), f0=0.013 Hz;
   modulates breath rate ±16% and depth ±15%; also exported as `s.pinkG` for a
   ±4% rim-glow drift. Periodic = robotic; 1/f = biological (HRV, postural sway).
3. **Kuramoto mean-field coherence**: 24 real oscillators in the driver
   (ω ≈ N(1.35, 0.28) via Irwin-Hall), coupling `K = 7·coh²` spans the critical
   point (K_c ≈ 1.6σ ≈ 0.45), ×1.2 while speaking. Order parameter r and mean
   phase ψ EMERGE and are exported (`s.cohR`, `s.cohPsi`). New emotion channel
   `coh` (EMO_BASE 0.72; confused 0.12 … determined 0.95).
4. **SH emotion silhouette**: 5 real spherical-harmonic coefficients (Y00 swell,
   Y1y droop/lift, Y1x lean, Y20 stretch, Y4p4 sparkle; y-up forms) from emotion
   channels through springs (τ=0.8 s) + incommensurate LFOs (0.31/0.47/0.73/1.09/
   0.59 rad/s); capped |a| ≤ 0.005 (~5% head radius — beyond that features smear).

## Applied — GPU (face-wisp7.js vertex shader)

5. **Kuramoto shimmer**: `shim = mix(sin(ownPhase), sin(ψ+seed·0.7), r)` — blend
   OUTPUTS not phases (no wraparound pop); ±0.0007 normal displacement + rim
   ±(5–14)%. Calm = unison breathing glow; confusion = desynced scintillation.
6. **Chladni voice resonance**: 3D standing-wave field `cos(cx·x)+cos(cy·y)+cos(cz·z)`
   (Bourke), modes laddered by voice level (34/47/28 → 72/91/60 across the head),
   antinode vibration along the normal (0.0035·level), nodal-line CONTRAST
   `(exp(−22F²)−0.32)·level` clamped [0.55,1.6]× rim. Lesson repeated: additive
   glow at this coverage re-triggers "bloom ate the face" — make patterns
   luminance-conserving contrast shifts, never pure adds.
7. **Divergence-free tangent flow**: scalar-potential 2D curl in the tangent
   plane, `v = T1·∂f/∂T2 − T2·∂f/∂T1` via 4 finite-diff noise evals — flow
   particles stream along noise iso-lines (coherent rivers, never clumping).
8. **Thomas-attractor chaos**: `v = (sin qy, sin qz, sin qx) − 0.19·clamp(q)` at
   scrolled q=26·p — displacement ×(1−r): vanishes for a coherent mind, chaotic
   drift for a confused one. Deterministic chaos as an EMOTION channel.
9. **Loxodromic Möbius dust stream** (replaced the spark risers): stereographic
   `z → e^((ρ+iα)t)·z`, ρ = 0.10+0.30·(energy−0.55), α = 0.45+0.55·r; conformal
   flow of the sphere — circles stay circles; pole fade masks respawn. Calm =
   elliptic orbit, excitement = pole-to-pole spirals.

## Parked (worth a future round)

- Hopf-fibration orbital mode (transcendent state showpiece), phasor/phacelle
  directional stripe noise (runevision 2026-01, ~25× cheaper than phasor),
  quaternion-Julia scene world via the existing quarter-res raymarcher
  (c = 0.45·cos(0.03t+vec4(0.5,3.9,1.4,1.1)), orbit-trap coloring),
  warped-caustics + Beer-Lambert ocean scene, superformula n1-bloom halo
  punctuation, Fibonacci/Vogel golden-angle sampling as distribution infra.

## Affective-motion mapping (research-backed wiring)

Arousal → frequency/amplitude/advection speed (velocity↔arousal r≈0.61);
valence → smoothness (low jerk) + coherence r + up/down bias;
LMA Flow (bound↔free) → OU θ and Kuramoto r together.
