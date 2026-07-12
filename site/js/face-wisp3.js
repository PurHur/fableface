// face-wisp3.js — WISP III: the living hologram.
// Generation three. Everything WISP II learned, plus:
//   · TRAIL PERSISTENCE — particles render into a decaying ping-pong buffer:
//     motion leaves luminous afterglow, sparks and streams draw light-paths.
//   · FLOW-LIFE — a share of the cloud is never still: particles fade in,
//     drift along the surface, fade out and respawn — the face is continuously
//     woven out of moving energy instead of pinned dust.
//   · TECH-IRIS EYES — structured rotating iris discs (spokes, limbal ring,
//     orbiter dots) that read as living eyes at LOW brightness — no more
//     white-hot blobs.
//   · DEPTH ATMOSPHERE — far-side particles dim and cool: the head reads 3D.
//   · VOICE-WAVEFORM RINGS — the orbit rings ripple with the syllables.
// Same emotional recolor, contour lines, feed streams, glitch bursts, floor
// reflection and holo-chamber backdrop as WISP II.

import { program, fullscreenVAO } from './gl.js';
import { GLSL_COMMON, GLSL_SDF, GLSL_EYE, glslHeader } from './headsdf.js';
import { sampleSurfaceWeighted, extractFeatureEdges, mulberry32 } from './gridmesh.js';
import { SCENE_BG_VS as HOLO_BG_VS, SCENE_BG_FS as HOLO_BG_FS } from './scenes.js';

const EMO_COL = {
  neutral: [0.20, 0.80, 1.00], joy: [1.0, 0.72, 0.25], delight: [1.0, 0.62, 0.3],
  warm: [1.0, 0.5, 0.55], love: [1.0, 0.32, 0.6], proud: [0.95, 0.75, 0.3],
  mischievous: [0.7, 0.35, 1.0], awe: [0.55, 0.7, 1.0], sad: [0.25, 0.42, 0.95],
  angry: [1.0, 0.26, 0.12], irritated: [1.0, 0.45, 0.2], fear: [0.72, 0.72, 0.95],
  disgust: [0.5, 0.9, 0.4], embarrassed: [1.0, 0.5, 0.5], curious: [0.5, 0.68, 1.0],
  confused: [0.72, 0.58, 1.0], thinking: [0.45, 0.55, 1.0], skeptical: [0.6, 0.7, 0.9],
  determined: [0.95, 0.85, 0.35], concerned: [0.55, 0.72, 0.95], surprise: [0.95, 0.9, 0.45],
  bored: [0.3, 0.6, 0.7], sleepy: [0.22, 0.5, 0.62], alarm: [1.0, 0.18, 0.15],
};

// ---------------- trail composite shaders ----------------
const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// decay pass: previous trail frame, faded + gently expanding upward
const DECAY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uPrev;
uniform float uDecay;
out vec4 outColor;
void main(){
  vec2 uv = (vUv - 0.5)*0.9982 + 0.5 + vec2(0.0, -0.00055);
  vec3 c = texture(uPrev, uv).rgb*uDecay;
  c = max(c - 0.0015, 0.0); // hard floor so trails truly die
  outColor = vec4(c, 1.0);
}
`;

// composite: additive trail buffer over the backdrop
const COMP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uGain;
out vec4 outColor;
void main(){ outColor = vec4(texture(uTex, vUv).rgb*uGain, 1.0); }
`;

// ---------------- particle shader ----------------
const PT_VS = glslHeader() + GLSL_COMMON + GLSL_SDF + GLSL_EYE + /* glsl */ `
layout(location=0) in vec3 aPos;   // volume/contour: position · ring: (cos·r, lvl, sin·r) · iris: (r, ang, side)
layout(location=1) in vec3 aNrm;
layout(location=2) in float aMat;
layout(location=3) in float aSeed;
layout(location=4) in float aType;   // 0 volume, 1 contour, 2 ring, 3 iris

uniform mat4 uProj, uView;
uniform mat3 uHeadRot;
uniform vec3 uHeadPos, uCamPos;
uniform float uTime, uReveal, uPixelScale, uMirror;
uniform float uJaw, uSpread, uBlink, uBrowL, uBrowR, uLevel, uGlow, uReactW, uBreath;
uniform vec3 uGazeDir, uEmoCol;

out vec3 vColor;
out float vFade;
flat out float vType;

void main(){
  vType = aType;
  bool isRing = aType > 1.5 && aType < 2.5;
  bool isContour = aType > 0.5 && aType < 1.5;
  bool isIris = aType > 2.5;

  vec3 p = aPos;
  float spark = 0.0, feed = 0.0;
  float ta = 1.0;
  float lifeA = 1.0;
  float vFade0 = 1.0;
  vec3 base = mix(vec3(0.20, 0.80, 1.00), uEmoCol, clamp(uGlow*1.25, 0.0, 0.8));
  vec3 holo = base;

  if (isIris) {
    // ---- TECH-IRIS: structured rotating discs, readable at low brightness ----
    float r = aPos.x, ang = aPos.y, side = aPos.z;
    vec3 eyeC = vec3(EYE_X*side, 0.0, 0.050);
    vec3 gd = normalize(uGazeDir + vec3(-side*0.04, 0.0, 0.0));
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), gd));
    vec3 up = cross(gd, right);
    float pupilR = 0.0021*(uPupil > 0.01 ? uPupil : 1.0);
    float orbiter = step(0.968, aSeed);
    float rr = r;
    float aa = ang;
    if (orbiter > 0.5) { rr = 0.00685; aa = aSeed*371.0 + uTime*(1.1 + aSeed); }
    // pupil breathes with the voice
    rr = max(rr, pupilR + 0.0004 + rr*0.06*uLevel);
    float blinkC = clamp(uBlink, 0.0, 1.0);
    float yy = sin(aa)*rr*(1.0 - 0.35*blinkC);
    p = eyeC + gd*0.02415 + right*(cos(aa)*rr) + up*yy;
    // lid shadow: top-down cut as the lids close (+ widen slightly opens more)
    float cut = mix(0.0062, -0.0045, blinkC) - 0.0012*clamp(-uBlink, 0.0, 0.4);
    vFade0 *= 1.0 - smoothstep(cut - 0.0009, cut + 0.0009, yy);
    vFade0 *= 1.0 - smoothstep(0.72, 0.94, blinkC);
    // iris pattern: spokes rotate slowly, limbal ring glows, pupil is a hole
    float spin = uTime*0.35 + side*1.7;
    float spokes = 0.55 + 0.45*sin(aa*14.0 + spin + sin(aa*5.0 - spin*0.7));
    float limbal = exp(-pow((rr - 0.00615)*2400.0, 2.0));
    float hole = smoothstep(pupilR, pupilR + 0.0006, rr);
    vec3 irisTint = mix(vec3(0.45, 0.95, 1.05), uEmoCol*1.1, uGlow*0.45);
    base = irisTint*(0.30 + 0.42*spokes*(1.0 - 0.5*rr/0.0065) + 1.1*limbal)*hole;
    base += irisTint*orbiter*0.9;
    ta = clamp((uReveal - 0.3)/0.6, 0.0, 1.0);
  } else if (isRing) {
    // ---- VOICE-WAVEFORM RINGS ----
    float dir = aSeed < 0.5 ? 1.0 : -1.0;
    float w = uTime*(0.22 + aSeed*0.1)*dir;
    float c = cos(w), s = sin(w);
    p.xz = mat2(c, -s, s, c)*p.xz;
    float ang = atan(p.z, p.x);
    float wave = sin(ang*22.0 - uTime*9.0)*uLevel + 0.35*sin(ang*7.0 + uTime*2.0)*uGlow;
    p.xz *= 1.0 + wave*0.055;
    p.y += wave*0.012;
    ta = clamp((uReveal - 0.5)/0.5, 0.0, 1.0);
  } else {
    // ---- volume + contour: posed by the shared warp ----
    p = headWarpFwd(aPos, uJaw, uSpread, uBlink, uBrowL, uBrowR);

    float amp = (0.0010 + uLevel*0.0042 + uReactW*0.0035)*(isContour ? 0.38 : 1.0);
    vec3 nz = vec3(
      vnoise(aPos*40.0 + vec3(0.0, uTime*0.9, 0.0)),
      vnoise(aPos*40.0 + vec3(7.1, uTime*0.8, 3.0)),
      vnoise(aPos*40.0 + vec3(2.3, 5.9, uTime*0.7))) - 0.5;
    p += aNrm*(nz.x*amp*2.0) + nz*amp;

    // FLOW-LIFE: 45% of the volume cloud is continuously rewoven — each cycle a
    // particle is born at home, slides along the surface tangent, and dissolves.
    float flow = step(0.55, fract(aSeed*13.7))*(1.0 - step(0.94, aSeed))*(isContour ? 0.0 : 1.0);
    if (flow > 0.5) {
      float u = fract(uTime*(0.10 + fract(aSeed*7.3)*0.12) + aSeed*11.0);
      vec3 tflow = normalize(cross(aNrm, vec3(
        vnoise(aPos*9.0 + uTime*0.05),
        vnoise(aPos*9.0 + 4.7),
        vnoise(aPos*9.0 + 9.1)) - 0.5) + 1e-5);
      p += tflow*u*0.011 + aNrm*0.0016*sin(u*6.28318);
      lifeA = smoothstep(0.0, 0.18, u)*(1.0 - smoothstep(0.62, 1.0, u));
      lifeA = 0.35 + 0.65*lifeA;
    }

    spark = step(0.978, aSeed);
    feed = step(0.956, aSeed)*(1.0 - spark);
    if (spark > 0.5) {
      float ph = fract(uTime*0.05 + aSeed*17.0);
      p += vec3(sin(aSeed*231.0 + uTime*0.6)*0.06, ph*0.34 - 0.05, cos(aSeed*117.0 + uTime*0.5)*0.05)*0.85;
    }
    if (feed > 0.5) {
      float ph = fract(uTime*(0.10 + aSeed*0.08) + aSeed*29.0);
      vec3 src = vec3(sin(aSeed*400.0)*0.10, -0.42, 0.02 + cos(aSeed*300.0)*0.06);
      vec3 arc = mix(src, aPos, ph);
      arc.x += sin(ph*6.28318 + aSeed*40.0)*0.03*(1.0 - ph);
      p = mix(arc, p, smoothstep(0.75, 1.0, ph));
    }

    vec3 rnd = hash33(vec3(aSeed*911.7, aSeed*133.1, aSeed*77.7))*2.0 - 1.0;
    vec3 shell = normalize(rnd + 1e-4)*(0.40 + aSeed*0.15);
    shell.xz = mat2(cos(uTime + aSeed*9.0), -sin(uTime + aSeed*9.0),
                    sin(uTime + aSeed*9.0),  cos(uTime + aSeed*9.0))*shell.xz;
    ta = clamp((uReveal - aSeed*0.45)/0.55, 0.0, 1.0);
    ta = ta*ta*(3.0 - 2.0*ta);
    p = mix(shell + vec3(0.0, -0.05, 0.0), p, ta);
  }

  // glitch: rare ambient slices + hard burst when startled
  float gAmt = uReactW*0.9;
  float gseed = hash11(floor(uTime*1.7));
  if (gseed > 0.72) gAmt = max(gAmt, (gseed - 0.72)*0.9);
  if (gAmt > 0.01 && !isRing) {
    float band = step(abs(fract(p.y*9.0 + hash11(floor(uTime*11.0))*7.0) - 0.5), 0.10*gAmt);
    p.x += band*(hash11(floor(uTime*13.0) + floor(p.y*40.0)) - 0.5)*0.06*gAmt;
  }

  // scanlines + interlace (skip on the iris: its pattern carries the detail)
  float slice = 1.0;
  if (!isIris) {
    float slPhase = p.y*560.0 - uTime*2.8;
    slice = 0.72 + 0.36*pow(0.5 + 0.5*sin(slPhase), 1.6);
    float bandId = floor(slPhase/6.28318);
    p.x += (hash11(bandId*0.613 + floor(uTime*7.0)*13.7) - 0.5)*0.0009;
  }

  // DEPTH ATMOSPHERE: far half dims + cools before head rotation is applied
  float depthF = 0.50 + 0.50*smoothstep(-0.085, 0.045, p.z);
  vec3 world = isRing ? (p + uHeadPos*0.4 + vec3(0.0, -0.012, 0.0)) : (uHeadRot*p + uHeadPos);
  if (uMirror > 0.5) world.y = -0.36 - world.y;
  vec4 viewPos = uView*vec4(world, 1.0);
  gl_Position = uProj*viewPos;

  // ---- color (volume/contour materials; iris/ring set base above) ----
  float isEyeM = 0.0;
  if (!isIris && !isRing) {
    if (aMat > 0.5 && aMat < 1.5) {
      isEyeM = 1.0;
      base = holo*0.16; // dim eyeball backdrop — the tech-iris disc carries the eye
    } else if (aMat > 1.5 && aMat < 2.5) {
      base = mix(vec3(0.42, 0.62, 1.0), uEmoCol*1.15, uGlow*0.5);
    } else if (aMat > 2.5 && aMat < 3.5) {
      base = holo*0.20;
    } else if (aMat > 3.5 && aMat < 4.5) {
      base = vec3(0.85, 0.95, 1.0)*0.5;
    } else if (aMat > 5.5 && aMat < 6.5) {
      base = holo*vec3(0.28, 0.38, 0.42);
    } else if (aMat > 6.5) {
      base = holo*vec3(0.30, 0.34, 0.40);
    }
    // depth cooling: far particles shift toward deep blue
    base = mix(base*vec3(0.55, 0.75, 1.05), base, depthF);
  }
  float cs = sin(p.y*150.0 + uTime*0.9);
  base *= vec3(1.0 - (0.14 + gAmt*0.5)*cs, 1.0, 1.0 + (0.11 + gAmt*0.5)*cs);

  vec3 nw = uHeadRot*aNrm;
  float facing = dot(normalize(nw), normalize(uCamPos - world));
  float rim = mix(1.22, 0.58, abs(facing));
  float backFade = (isRing || isIris) ? 1.0 : mix(smoothstep(-0.20, 0.10, facing), 1.0, max(spark, feed));
  if (isContour) backFade = smoothstep(0.02, 0.22, facing);

  float mDist = length(aPos - vec3(0.0, -0.072, 0.070));
  float ripple = isIris ? 0.0 : sin(mDist*160.0 - uTime*11.0)*exp(-mDist*9.0)*uLevel;

  float sweep = exp(-pow((p.y - (fract(uTime*0.13)*0.9 - 0.5))*22.0, 2.0));
  float tw = 0.75 + 0.5*hash11(aSeed*997.0 + floor(uTime*7.0 + aSeed*20.0));
  float breathAmp = 0.92 + 0.08*uBreath;

  float amp2 = rim*tw*slice*(1.0 + sweep*1.1 + ripple*1.8)*(0.82 + uLevel*0.45 + uGlow*0.12)*breathAmp*depthF;
  if (isContour) amp2 = tw*(1.8 + sweep*0.8 + ripple*2.2)*(0.9 + uLevel*0.4 + uGlow*0.15)*depthF;
  if (isIris) amp2 = 0.95 + uLevel*0.25 + uGlow*0.15;
  if (isRing) amp2 = 1.0;
  vColor = base*amp2;

  float mouthGate = smoothstep(0.10, 0.40, uJaw);
  if (!isIris && !isRing && aMat > 2.5 && aMat < 4.5) vFade0 *= mouthGate;
  float mirrorFade = uMirror > 0.5 ? 0.15 : 1.0;
  vFade = vFade0*lifeA*ta*(spark > 0.5 ? 0.45 : 1.0)*(feed > 0.5 ? 0.6 : 1.0)*backFade*mirrorFade;

  float sz = isRing ? 0.0009 : isIris ? 0.00085 : isContour ? 0.0011 : (spark > 0.5 ? 0.0012 : 0.0016)*(0.8 + 0.6*aSeed);
  sz *= 1.0 + isEyeM*0.1;
  gl_PointSize = clamp(sz*uPixelScale/max(-viewPos.z, 0.05), 1.0, 8.0);
}
`;

const PT_FS = `#version 300 es
precision highp float;
in vec3 vColor;
in float vFade;
flat in float vType;
out vec4 outColor;
void main(){
  vec2 d = gl_PointCoord*2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float a = vType > 0.5 ? exp(-r2*4.6) : exp(-r2*3.2);
  outColor = vec4(vColor*a*vFade*0.14, 1.0);
}
`;

export class Wisp3Face {
  static title = 'WISP III';
  static tech = 'LIVING HOLOGRAM · TRAILS';
  static CAM = { dist: 0.62, targetY: -0.012 };
  static blurb =
    'Generation three. The cloud is never still: half the particles are continuously ' +
    'rewoven along the surface, every motion leaves luminous persistence in a decaying ' +
    'trail buffer, and the eyes are structured tech-iris discs — spokes, limbal ring, ' +
    'orbiting scanner dots — readable without glare. Depth-fogged for real dimension; ' +
    'the orbit rings ripple with the voice. It still recolors with feeling, and it ' +
    'still hates being poked.';

  constructor(gl, assets) {
    this.gl = gl;
    this._col = [0.20, 0.80, 1.00];

    const bg = program(gl, HOLO_BG_VS, HOLO_BG_FS, 'wisp3.bg');
    this.bgProg = bg.prog; this.bgU = bg.u;
    this.quadVao = fullscreenVAO(gl);

    const pt = program(gl, PT_VS, PT_FS, 'wisp3.pt');
    this.ptProg = pt.prog; this.ptU = pt.u;

    const decay = program(gl, QUAD_VS, DECAY_FS, 'wisp3.decay');
    this.decayProg = decay.prog; this.decayU = decay.u;
    const comp = program(gl, QUAD_VS, COMP_FS, 'wisp3.comp');
    this.compProg = comp.prog; this.compU = comp.u;

    // ---- trail ping-pong buffers (half resolution) ----
    this._fbo = [null, null];
    this._tex = [null, null];
    this._fw = 0; this._fh = 0;
    this._flip = 0;

    // ---- particle sets ----
    const sstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
    const weightFn = (x, y, z, mat) => {
      let w = 1;
      w *= 0.45 + 0.55 * sstep(-0.075, 0.045, z);
      w *= 1 + 1.1 * sstep(-0.02, 0.06, z);
      if (mat === 1) w *= 0.7;                   // eyeball: dim backdrop only — the iris disc is the eye
      else if (mat === 2) w *= 2.4;
      else if (mat === 7) w *= 3;
      else if (mat === 4 || mat === 3) w *= 1.2;
      const ng = Math.exp(-((x / 0.030) ** 2 + ((y + 0.018) / 0.048) ** 2)) * sstep(0.045, 0.065, z);
      w *= 1 + 1.7 * ng;
      const ex = Math.abs(x) - 0.0345;
      const eg = Math.exp(-(ex * ex + y * y) / 0.0009) * sstep(0.02, 0.045, z);
      w *= 1 + 0.7 * eg;
      return w;
    };
    const vol = sampleSurfaceWeighted(assets.mesh, 92000, weightFn, mulberry32(3033));

    const conRaw = extractFeatureEdges(assets.mesh, { angleDeg: 13, spacing: 0.0016, maxPoints: 15000, minZ: -0.01 });
    const keep = [];
    for (let i = 0; i < conRaw.count; i++) {
      const x = conRaw.positions[i * 3], y = conRaw.positions[i * 3 + 1], z = conRaw.positions[i * 3 + 2];
      const inMouth = Math.abs(x) < 0.034 && Math.abs(y + 0.072) < 0.024 && z < 0.0685;
      if (!inMouth) keep.push(i);
    }
    const con = {
      count: keep.length,
      positions: new Float32Array(keep.length * 3), normals: new Float32Array(keep.length * 3),
      mats: new Float32Array(keep.length), seeds: new Float32Array(keep.length),
    };
    keep.forEach((src, dst) => {
      for (let k = 0; k < 3; k++) {
        con.positions[dst * 3 + k] = conRaw.positions[src * 3 + k];
        con.normals[dst * 3 + k] = conRaw.normals[src * 3 + k];
      }
      con.mats[dst] = conRaw.mats[src];
      con.seeds[dst] = conRaw.seeds[src];
    });

    // orbit rings
    const ringN = 3600;
    const rp = new Float32Array(ringN * 3), rn = new Float32Array(ringN * 3), rm = new Float32Array(ringN), rs = new Float32Array(ringN);
    const rr = mulberry32(7);
    for (let i = 0; i < ringN; i++) {
      const ring = i < ringN * 0.55 ? 0 : 1;
      const a = rr() * Math.PI * 2;
      const rad = ring === 0 ? 0.185 : 0.215;
      const lvl = ring === 0 ? 0.005 : -0.085;
      const tilt = ring === 0 ? 0.10 : -0.06;
      rp[i * 3] = Math.cos(a) * rad;
      rp[i * 3 + 1] = lvl + Math.sin(a) * rad * tilt + (rr() - 0.5) * 0.0015;
      rp[i * 3 + 2] = Math.sin(a) * rad;
      rn[i * 3 + 1] = 1;
      rs[i] = ring === 0 ? rr() * 0.49 : 0.5 + rr() * 0.5;
    }

    // tech-iris discs: (r, ang, side) per point
    const irisPerEye = 1300;
    const irisN = irisPerEye * 2;
    const ip = new Float32Array(irisN * 3), inr = new Float32Array(irisN * 3), im = new Float32Array(irisN), isd = new Float32Array(irisN);
    const ir = mulberry32(41);
    for (let e = 0; e < 2; e++) {
      const side = e === 0 ? -1 : 1;
      for (let i = 0; i < irisPerEye; i++) {
        const ix = e * irisPerEye + i;
        const r = Math.sqrt(ir()) * 0.0064;
        const ang = ir() * Math.PI * 2;
        ip[ix * 3] = r; ip[ix * 3 + 1] = ang; ip[ix * 3 + 2] = side;
        inr[ix * 3 + 2] = 1;
        im[ix] = 1;
        isd[ix] = ir();
      }
    }

    const cat = (arrs) => {
      const total = arrs.reduce((n, a) => n + a.length, 0);
      const out = new Float32Array(total);
      let o = 0;
      for (const a of arrs) { out.set(a, o); o += a.length; }
      return out;
    };
    const positions = cat([vol.positions, con.positions, rp, ip]);
    const normals = cat([vol.normals, con.normals, rn, inr]);
    const mats = cat([vol.mats, con.mats, rm, im]);
    const seeds = cat([vol.seeds, con.seeds, rs, isd]);
    const types = new Float32Array(positions.length / 3);
    let off = 0;
    for (const [arr, ty] of [[vol, 0], [con, 1], [{ count: ringN }, 2], [{ count: irisN }, 3]]) {
      types.fill(ty, off, off + arr.count);
      off += arr.count;
    }
    this.count = positions.length / 3;
    this.contourCount = con.count;
    this.irisCount = irisN;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const attach = (loc, data, size) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attach(0, positions, 3);
    attach(1, normals, 3);
    attach(2, mats, 1);
    attach(3, seeds, 1);
    attach(4, types, 1);
    gl.bindVertexArray(null);
  }

  _ensureTrails(w, h) {
    const gl = this.gl;
    const fw = Math.max(2, w >> 1), fh = Math.max(2, h >> 1);
    if (fw === this._fw && fh === this._fh) return;
    this._fw = fw; this._fh = fh;
    for (let i = 0; i < 2; i++) {
      if (this._tex[i]) { gl.deleteTexture(this._tex[i]); gl.deleteFramebuffer(this._fbo[i]); }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this._tex[i] = tex; this._fbo[i] = fbo;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  draw(cm) {
    const gl = this.gl;
    const target = EMO_COL[cm.s.emotion] || EMO_COL.neutral;
    const k = 1 - Math.exp(-2.5 * cm.dt);
    for (let i = 0; i < 3; i++) this._col[i] += (target[i] - this._col[i]) * k;

    this._ensureTrails(cm.width, cm.height);
    const cur = this._flip, prev = 1 - this._flip;
    this._flip = prev;

    // ---- pass 1: decay previous trails into the current buffer ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo[cur]);
    gl.viewport(0, 0, this._fw, this._fh);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.decayProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._tex[prev]);
    gl.uniform1i(this.decayU.uPrev, 0);
    gl.uniform1f(this.decayU.uDecay, 0.78);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- pass 2: particles (reflection + hologram) into the trail buffer ----
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.ptProg);
    const u = this.ptU;
    gl.uniformMatrix4fv(u.uProj, false, cm.proj);
    gl.uniformMatrix4fv(u.uView, false, cm.view);
    gl.uniformMatrix3fv(u.uHeadRot, false, cm.headRot);
    gl.uniform3fv(u.uHeadPos, cm.headPos);
    gl.uniform3fv(u.uCamPos, cm.camPos);
    gl.uniform1f(u.uTime, cm.t);
    gl.uniform1f(u.uReveal, cm.reveal);
    gl.uniform1f(u.uPixelScale, this._fh / (2 * cm.tanHalf));
    gl.uniform1f(u.uJaw, cm.s.jaw);
    gl.uniform1f(u.uSpread, cm.s.spread);
    gl.uniform1f(u.uBlink, cm.s.blink);
    gl.uniform1f(u.uBrowL, cm.s.browL);
    gl.uniform1f(u.uBrowR, cm.s.browR);
    gl.uniform1f(u.uLevel, cm.s.level);
    gl.uniform1f(u.uGlow, cm.s.glow || 0);
    gl.uniform1f(u.uReactW, cm.s.reactW || 0);
    gl.uniform1f(u.uBreath, cm.s.breath || 0.5);
    if (u.uPupil) gl.uniform1f(u.uPupil, cm.s.pupil || 1);
    gl.uniform3fv(u.uGazeDir, cm.gazeDir);
    gl.uniform3fv(u.uEmoCol, this._col);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(u.uMirror, 1);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.uniform1f(u.uMirror, 0);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);

    // ---- pass 3: backdrop + composite trails to screen ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cm.width, cm.height);
    gl.useProgram(this.bgProg);
    gl.uniform2f(this.bgU.uRes, cm.width, cm.height);
    gl.uniform1f(this.bgU.uTime, cm.t);
    gl.uniform1f(this.bgU.uLevel, cm.s.level);
    gl.uniform1f(this.bgU.uGlow, cm.s.glow || 0);
    gl.uniform3fv(this.bgU.uEmoCol, this._col);
    if (this.bgU.uScene) gl.uniform1f(this.bgU.uScene, (cm.scene && cm.scene.bg) || 0);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.compProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._tex[cur]);
    gl.uniform1i(this.compU.uTex, 0);
    gl.uniform1f(this.compU.uGain, 0.82);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}
