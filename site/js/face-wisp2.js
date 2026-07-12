// face-wisp2.js — WISP II: the feature-dense emotional hologram.
// WISP's successor: the particle budget is spent where the expression lives
// (weighted sampling: eyes/lips/brows/nose ×3–5 density), crisp contour
// particles trace the feature lines (lip outline, eye rims, brow ridges — from
// smooth-normal curvature + material boundaries), data streams feed the
// projection from the emitter, orbit rings carry status, the floor reflects,
// voice ripples radiate from the mouth — and the whole hologram RECOLORS with
// the companion's emotion (driver glow/emotion channels) and glitches when
// startled (reactW).

import { program, fullscreenVAO } from './gl.js';
import { GLSL_COMMON, GLSL_SDF, GLSL_EYE, glslHeader } from './headsdf.js';
import { sampleSurfaceWeighted, extractFeatureEdges, mulberry32 } from './gridmesh.js';
import { SCENE_BG_VS as HOLO_BG_VS, SCENE_BG_FS as HOLO_BG_FS } from './scenes.js';

// emotion → hologram hue (lerped toward by glow amount)
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

// backdrop lives in holo-bg.js (shared with classic WISP)

const PT_VS = glslHeader() + GLSL_COMMON + GLSL_SDF + GLSL_EYE + /* glsl */ `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in float aMat;
layout(location=3) in float aSeed;
layout(location=4) in float aType;   // 0 volume, 1 contour, 2 orbit ring

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
  bool isRing = aType > 1.5;
  bool isContour = aType > 0.5 && aType < 1.5;

  vec3 p = aPos;
  float spark = 0.0, feed = 0.0;
  float ta = 1.0;

  if (isRing) {
    // orbit rings: world-ish space around the head, own rotation, dashes
    float dir = aSeed < 0.5 ? 1.0 : -1.0;
    float w = uTime*(0.22 + aSeed*0.1)*dir;
    float c = cos(w), s = sin(w);
    p.xz = mat2(c, -s, s, c)*p.xz;
    ta = clamp((uReveal - 0.5)/0.5, 0.0, 1.0);
  } else {
    // pose the neutral sample with the shared forward warp
    p = headWarpFwd(aPos, uJaw, uSpread, uBlink, uBrowL, uBrowR);

    // hologram turbulence: idle breath, boils with speech + reactions
    float amp = (0.0010 + uLevel*0.0042 + uReactW*0.0035)*(isContour ? 0.38 : 1.0);
    vec3 nz = vec3(
      vnoise(aPos*40.0 + vec3(0.0, uTime*0.9, 0.0)),
      vnoise(aPos*40.0 + vec3(7.1, uTime*0.8, 3.0)),
      vnoise(aPos*40.0 + vec3(2.3, 5.9, uTime*0.7))) - 0.5;
    p += aNrm*(nz.x*amp*2.0) + nz*amp;

    // sparks drift up; feed-streams flow IN from the projector below
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
      p = mix(arc, p, smoothstep(0.75, 1.0, ph)); // merge into the face at arrival
    }

    // assembly reveal: fly in from a swirling shell
    vec3 rnd = hash33(vec3(aSeed*911.7, aSeed*133.1, aSeed*77.7))*2.0 - 1.0;
    vec3 shell = normalize(rnd + 1e-4)*(0.40 + aSeed*0.15);
    shell.xz = mat2(cos(uTime + aSeed*9.0), -sin(uTime + aSeed*9.0),
                    sin(uTime + aSeed*9.0),  cos(uTime + aSeed*9.0))*shell.xz;
    ta = clamp((uReveal - aSeed*0.45)/0.55, 0.0, 1.0);
    ta = ta*ta*(3.0 - 2.0*ta);
    p = mix(shell + vec3(0.0, -0.05, 0.0), p, ta);
  }

  // glitch: ambient rare slices + a hard burst when startled (reactW)
  float gAmt = uReactW*0.9;
  float gseed = hash11(floor(uTime*1.7));
  if (gseed > 0.72) gAmt = max(gAmt, (gseed - 0.72)*0.9);
  if (gAmt > 0.01 && !isRing) {
    float band = step(abs(fract(p.y*9.0 + hash11(floor(uTime*11.0))*7.0) - 0.5), 0.10*gAmt);
    p.x += band*(hash11(floor(uTime*13.0) + floor(p.y*40.0)) - 0.5)*0.06*gAmt;
  }

  // slice scanlines + interlace shimmer
  float slPhase = p.y*520.0 - uTime*2.6;
  float slice = 0.68 + 0.42*pow(0.5 + 0.5*sin(slPhase), 1.6);
  float bandId = floor(slPhase/6.28318);
  p.x += (hash11(bandId*0.613 + floor(uTime*7.0)*13.7) - 0.5)*0.0009;

  vec3 world = isRing ? (p + uHeadPos*0.4 + vec3(0.0, -0.012, 0.0)) : (uHeadRot*p + uHeadPos);
  // floor reflection pass: mirror + heavy fade
  if (uMirror > 0.5) world.y = -0.36 - world.y;
  vec4 viewPos = uView*vec4(world, 1.0);
  gl_Position = uProj*viewPos;

  float vFade0 = 1.0;

  // ---- color ----
  vec3 holo = mix(vec3(0.20, 0.80, 1.00), uEmoCol, clamp(uGlow*1.25, 0.0, 0.8));
  vec3 base = holo;
  float isEye = 0.0;
  if (isRing) {
    // dashed status ring: brightness pattern circles with time
    float ang = atan(p.z, p.x);
    float dash = 0.25 + 0.75*step(0.5, fract(ang*14.0/6.28318 + uTime*0.7 + aSeed));
    base = holo*dash*(0.5 + uLevel*1.6 + uGlow*0.6);
  } else if (aMat > 0.5 && aMat < 1.5) {
    isEye = 1.0;
    base = shadeEye(aPos, uGazeDir, mix(vec3(0.5, 1.0, 1.0), uEmoCol*1.2, uGlow*0.5), 1.2)
         * vec3(0.5, 0.88, 1.05)*0.72;
  } else if (aMat > 1.5 && aMat < 2.5) {
    base = mix(vec3(0.42, 0.62, 1.0), uEmoCol*1.15, uGlow*0.5); // lips
  } else if (aMat > 2.5 && aMat < 3.5) {
    base = holo*0.20;                     // cavity: dim interior
  } else if (aMat > 3.5 && aMat < 4.5) {
    base = vec3(0.85, 0.95, 1.0)*0.5;     // teeth: soft white, flashes as it speaks
  } else if (aMat > 5.5 && aMat < 6.5) {
    base = holo*vec3(0.28, 0.38, 0.42);   // crown shell: dark silhouette mass
  } else if (aMat > 6.5) {
    base = holo*vec3(0.30, 0.34, 0.40);   // brows: dark accents
  }
  // chromatic banding + glitch chroma split
  float cs = sin(p.y*150.0 + uTime*0.9);
  base *= vec3(1.0 - (0.16 + gAmt*0.5)*cs, 1.0, 1.0 + (0.13 + gAmt*0.5)*cs);

  vec3 nw = uHeadRot*aNrm;
  float facing = dot(normalize(nw), normalize(uCamPos - world));
  float rim = mix(1.25, 0.55, abs(facing));
  float backFade = isRing ? 1.0 : mix(smoothstep(-0.20, 0.10, facing), 1.0, max(spark, feed));
  if (isContour) backFade = smoothstep(0.02, 0.22, facing); // contours: strictly front

  // voice ripples radiating from the mouth across the surface
  float mDist = length(aPos - vec3(0.0, -0.072, 0.070));
  float ripple = sin(mDist*160.0 - uTime*11.0)*exp(-mDist*9.0)*uLevel;

  // refresh sweep + twinkle + breath
  float sweep = exp(-pow((p.y - (fract(uTime*0.13)*0.9 - 0.5))*22.0, 2.0));
  float tw = 0.75 + 0.5*hash11(aSeed*997.0 + floor(uTime*7.0 + aSeed*20.0));
  float breathAmp = 0.92 + 0.08*uBreath;

  float amp2 = rim*tw*slice*(1.0 + sweep*1.1 + ripple*1.8)*(0.82 + uLevel*0.45 + uGlow*0.12)*breathAmp;
  if (isContour) amp2 = tw*(1.8 + sweep*0.8 + ripple*2.2)*(0.9 + uLevel*0.4 + uGlow*0.15); // lines stay crisp, no slice dimming
  vColor = base*amp2;
  float mirrorFade = uMirror > 0.5 ? 0.16*smoothstep(-0.36, -0.05, world.y + 0.0) : 1.0;
  // mouth interior only exists while the mouth is open (additive clouds have
  // no occlusion — closed-mouth teeth read as a static rectangle at the chin)
  float mouthGate = smoothstep(0.10, 0.40, uJaw);
  if (aMat > 2.5 && aMat < 4.5) vFade0 *= mouthGate;
  vFade = vFade0*ta*(spark > 0.5 ? 0.45 : 1.0)*(feed > 0.5 ? 0.6 : 1.0)*backFade*mirrorFade;

  float sz = isRing ? 0.0009 : isContour ? 0.0011 : (spark > 0.5 ? 0.0012 : 0.0016)*(0.8 + 0.6*aSeed);
  sz *= 1.0 + isEye*0.18;
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
  // contours & rings: tighter core so lines read hairline-crisp
  float a = vType > 0.5 ? exp(-r2*4.6) : exp(-r2*3.2);
  outColor = vec4(vColor*a*vFade*0.5, 1.0);
}
`;

export class Wisp2Face {
  static title = 'WISP II';
  static tech = 'FEATURE-DENSE HOLOGRAM';
  static CAM = { dist: 0.62, targetY: -0.012 };
  static blurb =
    'The hologram, generation two. The particle budget follows the expression — eyes, ' +
    'lips and brows get 3–5× the density — while contour particles trace the feature ' +
    'lines from surface curvature. Data streams feed it from the projector, orbit rings ' +
    'carry its status, the floor reflects it, and the whole projection re-colors with ' +
    'its emotional state. Poke it and it glitches.';

  constructor(gl, assets) {
    this.gl = gl;
    this._col = [0.20, 0.80, 1.00];

    const bg = program(gl, HOLO_BG_VS, HOLO_BG_FS, 'wisp2.bg');
    this.bgProg = bg.prog; this.bgU = bg.u;
    this.bgVao = fullscreenVAO(gl);

    const pt = program(gl, PT_VS, PT_FS, 'wisp2.pt');
    this.ptProg = pt.prog; this.ptU = pt.u;

    // ---- particle sets ----
    // 1. volume: weighted so the face front + features carry the detail
    // SMOOTH weight field — hard box/threshold edges read as static
    // rectangles of brightness on an additive cloud (user caught one).
    const sstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
    const weightFn = (x, y, z, mat) => {
      let w = 1;
      w *= 0.45 + 0.55 * sstep(-0.075, 0.045, z);          // back sparse → front dense, gradual
      w *= 1 + 1.1 * sstep(-0.02, 0.06, z);                // face-front emphasis, no cliff
      if (mat === 1) w *= 1.8;                             // eyes
      else if (mat === 2) w *= 2.4;                        // lips
      else if (mat === 7) w *= 3;                          // brows
      else if (mat === 4 || mat === 3) w *= 1.2;           // teeth/cavity (gated by jaw at draw)
      // nose + nasolabial: gaussian, not a box
      const ng = Math.exp(-((x / 0.030) ** 2 + ((y + 0.018) / 0.048) ** 2)) * sstep(0.045, 0.065, z);
      w *= 1 + 1.7 * ng;
      // eye sockets: gaussian halo around each eye
      const ex = Math.abs(x) - 0.0345;
      const eg = Math.exp(-(ex * ex + y * y) / 0.0009) * sstep(0.02, 0.045, z);
      w *= 1 + 0.7 * eg;
      return w;
    };
    const vol = sampleSurfaceWeighted(assets.mesh, 96000, weightFn, mulberry32(2025));
    // 2. contours: curvature + material-boundary feature lines
    const conRaw = extractFeatureEdges(assets.mesh, { angleDeg: 13, spacing: 0.0016, maxPoints: 15000, minZ: -0.01 });
    // drop mouth-INTERIOR contours (cavity-rim crease + teeth edges): on an
    // additive cloud they shine through closed lips as a static rectangle.
    // The outer lip outline sits forward of z≈0.0685 and survives the cut.
    const keep = [];
    for (let i = 0; i < conRaw.count; i++) {
      const x = conRaw.positions[i * 3], y = conRaw.positions[i * 3 + 1], z = conRaw.positions[i * 3 + 2];
      const inMouth = Math.abs(x) < 0.034 && Math.abs(y + 0.072) < 0.024 && z < 0.0685;
      if (!inMouth) keep.push(i);
    }
    const con = { count: keep.length,
      positions: new Float32Array(keep.length * 3), normals: new Float32Array(keep.length * 3),
      mats: new Float32Array(keep.length), seeds: new Float32Array(keep.length) };
    keep.forEach((src, dst) => {
      for (let k = 0; k < 3; k++) {
        con.positions[dst * 3 + k] = conRaw.positions[src * 3 + k];
        con.normals[dst * 3 + k] = conRaw.normals[src * 3 + k];
      }
      con.mats[dst] = conRaw.mats[src];
      con.seeds[dst] = conRaw.seeds[src];
    });
    // 3. orbit rings
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
      rm[i] = 0;
      rs[i] = ring === 0 ? rr() * 0.49 : 0.5 + rr() * 0.5; // seed also encodes spin dir
    }

    const cat = (a, b, c) => {
      const out = new Float32Array(a.length + b.length + c.length);
      out.set(a, 0); out.set(b, a.length); out.set(c, a.length + b.length);
      return out;
    };
    const positions = cat(vol.positions, con.positions, rp);
    const normals = cat(vol.normals, con.normals, rn);
    const mats = cat(vol.mats, con.mats, rm);
    const seeds = cat(vol.seeds, con.seeds, rs);
    const types = new Float32Array(positions.length / 3);
    types.fill(0, 0, vol.count);
    types.fill(1, vol.count, vol.count + con.count);
    types.fill(2, vol.count + con.count);
    this.count = positions.length / 3;
    this.contourCount = con.count;

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

  draw(cm) {
    const gl = this.gl;
    // emotion hue target, smoothed
    const target = EMO_COL[cm.s.emotion] || EMO_COL.neutral;
    const k = 1 - Math.exp(-2.5 * cm.dt);
    for (let i = 0; i < 3; i++) this._col[i] += (target[i] - this._col[i]) * k;

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.bgProg);
    gl.uniform2f(this.bgU.uRes, cm.width, cm.height);
    gl.uniform1f(this.bgU.uTime, cm.t);
    gl.uniform1f(this.bgU.uLevel, cm.s.level);
    gl.uniform1f(this.bgU.uGlow, cm.s.glow || 0);
    gl.uniform3fv(this.bgU.uEmoCol, this._col);
    if (this.bgU.uScene) gl.uniform1f(this.bgU.uScene, (cm.scene && cm.scene.bg) || 0);
    gl.bindVertexArray(this.bgVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

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
    gl.uniform1f(u.uPixelScale, cm.height / (2 * cm.tanHalf));
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
    // floor reflection first (dim), then the hologram
    gl.uniform1f(u.uMirror, 1);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.uniform1f(u.uMirror, 0);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}
