// face-wisp5.js — WISP V: GLASS MIND.
// Interiority. The distance field gives us what no other pipeline gets for
// free: ANATOMY. Three depth layers extracted from the same head field —
//   SKIN     sparse glassy fresnel cloud (iso 0)         … you look THROUGH it
//   CIRCUIT  inner lattice shell (iso −5.5mm)            … machinery under skin
//   CORE     volumetric luminous brain (field < −13mm,   … the mind itself,
//            cranium region, sampled from the grid)        where storms LIVE
// plus CONDUITS: light packets flowing core→mouth while speaking and
// ears→core while listening — thought made traffic. Over it all: a raymarched
// glass shell (quarter-res, adaptive) for GITS "solid hologram" specularity,
// and depth-of-field focused at the eyes. Everything from IV carries over:
// emotion recolor + shockwave, energy/gesture coupling, storms, moiré, freeze,
// chromatic voice split, tech-iris (v4.1 size), rings, trails, holo-chamber.

import { program, fullscreenVAO } from './gl.js';
import { GRID, GLSL_COMMON, GLSL_SDF, GLSL_EYE, glslHeader } from './headsdf.js';
import { sampleSurfaceWeighted, extractFeatureEdges, surfaceNets, mulberry32 } from './gridmesh.js';
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

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const DECAY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uPrev;
uniform float uDecay;
out vec4 outColor;
void main(){
  vec2 uv = (vUv - 0.5)*0.9982 + 0.5 + vec2(0.0, -0.00055);
  vec3 c = texture(uPrev, uv).rgb*uDecay;
  c = max(c - 0.0015, 0.0);
  outColor = vec4(c, 1.0);
}
`;

const COMP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uGain;
out vec4 outColor;
void main(){ outColor = vec4(texture(uTex, vUv).rgb*uGain, 1.0); }
`;

// ---- the raymarched glass shell (quarter-res, additive whisper of solidity) ----
const SHELL_FS = glslHeader() + GLSL_COMMON + GLSL_SDF + /* glsl */ `
in vec2 vUv;
uniform vec2 uRes;
uniform vec3 uCamPos, uCamRight, uCamUp, uCamFwd, uHeadPos, uEmoCol;
uniform mat3 uInvHeadRot;
uniform float uTanHalf, uTime, uJaw, uSpread, uBlink, uBrowL, uBrowR, uGlow, uReveal;
out vec4 outColor;

vec2 mapHead(vec3 p){ return sdHead(p, uJaw, uSpread, uBlink, uBrowL, uBrowR); }

void main(){
  vec2 ndc = (vUv*2.0 - 1.0)*vec2(uRes.x/uRes.y, 1.0)*uTanHalf;
  vec3 rd = normalize(uCamFwd + uCamRight*ndc.x + uCamUp*ndc.y);
  vec3 ro = uCamPos - uHeadPos;
  ro = uInvHeadRot*ro;
  rd = uInvHeadRot*rd;
  float t = max(0.0, length(ro) - 0.30);
  float hit = -1.0;
  for (int i = 0; i < 44; i++) {
    vec3 p = ro + rd*t;
    float d = mapHead(p).x;
    if (d < 0.0012) { hit = t; break; }
    t += d*0.85;
    if (t > 1.4) break;
  }
  if (hit < 0.0) { outColor = vec4(0.0); return; }
  vec3 p = ro + rd*hit;
  vec2 e = vec2(0.0015, 0.0);
  vec3 n = normalize(vec3(
    mapHead(p + e.xyy).x - mapHead(p - e.xyy).x,
    mapHead(p + e.yxy).x - mapHead(p - e.yxy).x,
    mapHead(p + e.yyx).x - mapHead(p - e.yyx).x));
  float fres = pow(1.0 - abs(dot(n, -rd)), 3.0);
  // key-light specular streak + cool sheen — the "solid hologram" read
  vec3 L = normalize(vec3(0.5, 0.75, 0.6));
  float spec = pow(max(dot(reflect(rd, n), L), 0.0), 42.0);
  vec3 tint = mix(vec3(0.35, 0.8, 0.95), uEmoCol, clamp(uGlow*1.3, 0.0, 0.75));
  vec3 col = tint*(fres*0.16) + vec3(0.9, 0.97, 1.0)*spec*0.35
           + tint*0.028*smoothstep(0.4, 1.0, n.y); // faint top sheen
  col *= smoothstep(0.15, 0.75, uReveal);
  outColor = vec4(col, 1.0);
}
`;

// ---------------- particle shader ----------------
// aType: 0 skin, 1 contour, 2 ring, 3 iris, 4 circuit shell, 5 brain core, 6 conduit
const PT_VS = glslHeader() + GLSL_COMMON + GLSL_SDF + GLSL_EYE + /* glsl */ `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in float aMat;
layout(location=3) in float aSeed;
layout(location=4) in float aType;

uniform mat4 uProj, uView;
uniform mat3 uHeadRot;
uniform vec3 uHeadPos, uCamPos, uCamRight, uCamFwd;
uniform float uTime, uReveal, uPixelScale, uMirror, uGhost;
uniform vec3 uGhostOff;
uniform float uJaw, uSpread, uBlink, uBrowL, uBrowR, uLevel, uGlow, uReactW, uBreath;
uniform float uDoubt, uFreeze, uSleep, uStormRate, uPulseDir, uIntensity;
uniform float uEnergy, uGestureW, uEmoPulse, uFocusD;
uniform float uFxMode;
uniform vec3 uFxTint;
uniform vec3 uGazeDir, uEmoCol;

out vec3 vColor;
out float vFade;
flat out float vType;

void main(){
  vType = aType;
  bool isRing = aType > 1.5 && aType < 2.5;
  bool isContour = aType > 0.5 && aType < 1.5;
  bool isIris = aType > 2.5 && aType < 3.5;
  bool isCircuit = aType > 3.5 && aType < 4.5;
  bool isCore = aType > 4.5 && aType < 5.5;
  bool isConduit = aType > 5.5;
  bool inner = isCircuit || isCore || isConduit;
  float motion = 1.0 - 0.92*uFreeze;
  int fx = int(uFxMode + 0.5);
  float fxCalm = fx == 1 ? 0.7 : 1.0;

  vec3 p = aPos;
  float spark = 0.0, feed = 0.0;
  float ta = 1.0, lifeA = 1.0, vFade0 = 1.0;
  vec3 base = mix(vec3(0.20, 0.80, 1.00), uEmoCol, clamp(uGlow*1.7 + uEmoPulse*0.4, 0.0, 0.92));
  vec3 holo = base;

  if (isIris) {
    float r = aPos.x, ang = aPos.y, side = aPos.z;
    vec3 eyeC = vec3(EYE_X*side, 0.0, 0.050);
    vec3 gd = normalize(uGazeDir + vec3(-side*0.04, 0.0, 0.0));
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), gd));
    vec3 up = cross(gd, right);
    float pupilR = 0.0018*(uPupil > 0.01 ? uPupil : 1.0);
    float orbiter = step(0.968, aSeed);
    float rr = r, aa = ang;
    if (orbiter > 0.5) { rr = 0.00540; aa = aSeed*371.0 + uTime*(1.1 + aSeed)*motion; }
    rr = max(rr, pupilR + 0.0004 + rr*0.06*uLevel);
    float blinkC = clamp(uBlink, 0.0, 1.0);
    float yy = sin(aa)*rr*(1.0 - 0.35*blinkC);
    p = eyeC + gd*0.02415 + right*(cos(aa)*rr) + up*yy;
    float cut = mix(0.0062, -0.0045, blinkC) - 0.0012*clamp(-uBlink, 0.0, 0.4);
    vFade0 *= 1.0 - smoothstep(cut - 0.0009, cut + 0.0009, yy);
    vFade0 *= 1.0 - smoothstep(0.72, 0.94, blinkC);
    float spin = uTime*0.35*motion + side*1.7;
    float spokes = 0.55 + 0.45*sin(aa*14.0 + spin + sin(aa*5.0 - spin*0.7));
    float limbal = exp(-pow((rr - 0.00480)*3000.0, 2.0));
    float hole = smoothstep(pupilR, pupilR + 0.0006, rr);
    vec3 irisTint = mix(vec3(0.45, 0.95, 1.05), uEmoCol*1.15, clamp(uGlow*0.8, 0.0, 0.7));
    base = irisTint*(0.30 + 0.42*spokes*(1.0 - 0.5*rr/0.0051) + 1.1*limbal)*hole;
    base += irisTint*orbiter*1.3;
    ta = clamp((uReveal - 0.3)/0.6, 0.0, 1.0);
  } else if (isRing) {
    // ---- SCENE ADORNMENTS: the ring particle budget is re-shaped per scenario ----
    float ang0 = atan(aPos.z, aPos.x);
    float rad0 = length(aPos.xz);
    if (fx == 2) { // RAIN CITY: falling rain streaks around the head
      float fall = fract(uTime*(0.55 + fract(aSeed*7.0)*0.8) + aSeed*13.0);
      p = vec3((fract(aSeed*31.0) - 0.5)*0.6, 0.26 - fall*0.55, (fract(aSeed*57.0) - 0.5)*0.42);
      base = vec3(0.45, 0.6, 0.9)*0.9;
      vFade0 *= 0.5;
    } else if (fx == 5) { // ABYSS: bubbles rising, wobbling
      float rise = fract(uTime*(0.09 + fract(aSeed*5.0)*0.12)*motion + aSeed*17.0);
      p = vec3((fract(aSeed*31.0) - 0.5)*0.5 + sin(uTime*2.0 + aSeed*40.0)*0.012,
               -0.28 + rise*0.6, (fract(aSeed*57.0) - 0.5)*0.36);
      base = vec3(0.5, 0.9, 0.95);
      vFade0 *= 0.30 + 0.35*rise;
    } else if (fx == 6) { // TEMPLE: golden halo above the crown
      float aa2 = ang0 + uTime*0.15*motion;
      p = vec3(cos(aa2)*0.088, 0.147 + sin(aa2*3.0 + uTime)*0.002, sin(aa2)*0.088);
      base = vec3(1.25, 0.95, 0.5)*(0.7 + 0.5*sin(aa2*9.0 + uTime*2.0));
    } else if (fx == 4) { // REACTOR: two gimbal containment arcs
      float which = step(0.5, fract(aSeed*3.0));
      float aa2 = ang0 + uTime*(which > 0.5 ? 0.5 : -0.4)*motion;
      float R = 0.20 + which*0.035;
      vec3 ring = vec3(cos(aa2)*R, sin(aa2)*R, 0.0);
      float spin = uTime*(which > 0.5 ? 0.21 : -0.17)*motion;
      float cy2 = cos(spin), sy2 = sin(spin);
      p = vec3(ring.x, ring.y*cy2 - ring.z*sy2, ring.y*sy2 + ring.z*cy2);
      if (which > 0.5) p = p.zyx;
      p.y -= 0.01;
      base = vec3(1.15, 0.55, 0.25)*(0.4 + 0.6*step(0.6, fract(aa2*4.0 - uTime*motion)));
    } else if (fx == 1) { // DEEP SPACE: scattered debris belt, inclined orbit
      float aa2 = ang0 + uTime*(0.05 + fract(aSeed*3.7)*0.08)*motion;
      float R = rad0*(0.85 + fract(aSeed*11.0)*0.6);
      p = vec3(cos(aa2)*R, aPos.y*2.5 + cos(aa2)*R*0.22, sin(aa2)*R);
      base = vec3(0.8, 0.85, 1.0)*(0.25 + 0.75*hash11(floor(aSeed*999.0) + floor(uTime*2.0 + aSeed*8.0)));
      vFade0 *= 0.6;
    } else if (fx == 9) { // AURORA: sinuous ribbon behind the head
      float x = (fract(aSeed*13.0) - 0.5)*0.95;
      float wob = sin(x*6.0 + uTime*0.5*motion)*0.5 + sin(x*11.0 - uTime*0.3*motion)*0.3;
      p = vec3(x, 0.06 + wob*0.07 + (fract(aSeed*29.0) - 0.5)*0.11, -0.30);
      base = mix(vec3(0.1, 0.9, 0.45), vec3(0.5, 0.2, 0.9), fract(aSeed*5.0))*(0.5 + 0.5*sin(x*20.0 + uTime*1.3));
      vFade0 *= 0.55;
    } else if (fx == 3 || fx == 7) { // VAULT/CODE: square data-frames, two levels
      vec2 d2 = vec2(cos(ang0), sin(ang0));
      vec2 sq = d2/max(abs(d2.x), abs(d2.y));
      float lvl2 = fract(aSeed*3.0) < 0.5 ? 0.105 : -0.105;
      p = vec3(sq.x*0.168, lvl2, sq.y*0.168);
      base = holo*(0.35 + 0.65*step(0.5, fract(ang0*1.273 + uTime*(lvl2 > 0.0 ? 0.9 : -0.7)*motion)));
    } else if (fx == 8) { // SWEEP: fixed measurement brackets, four corners
      float corner = floor(fract(aSeed*4.0)*4.0);
      vec2 cs2 = vec2(corner == 0.0 || corner == 3.0 ? -1.0 : 1.0, corner < 2.0 ? 1.0 : -1.0);
      float along = fract(aSeed*23.0)*0.05;
      vec2 off = fract(aSeed*9.0) < 0.5 ? vec2(along, 0.0) : vec2(0.0, along);
      p = vec3(cs2.x*(0.175 - off.x), cs2.y*(0.165 - off.y) - 0.01, 0.0);
      base = holo*0.85;
    } else { // CHAMBER: the original instrument rings (emotion arc + voice waveform)
      float innerR = step(aSeed, 0.4999);
      float dir = innerR > 0.5 ? 1.0 : -1.0;
      float w = uTime*(0.20 + aSeed*0.1)*dir*motion*clamp(0.45 + 0.6*uEnergy, 0.5, 1.5);
      float c = cos(w), s = sin(w);
      p.xz = mat2(c, -s, s, c)*p.xz;
      float ang = atan(p.z, p.x);
      float angFrac = (ang + 3.14159)/6.28318;
      if (innerR > 0.5) {
        float lit = 1.0 - smoothstep(uIntensity - 0.02, uIntensity + 0.02, angFrac);
        base = uEmoCol*(0.18 + 1.5*lit)*(0.6 + 0.6*uGlow);
      } else {
        float wave = sin(ang*22.0 - uTime*9.0*motion)*uLevel + 0.35*sin(ang*7.0 + uTime*2.0*motion)*uGlow;
        p.xz *= 1.0 + wave*0.055;
        p.y += wave*0.012;
        float dash = 0.25 + 0.75*step(0.5, fract(angFrac*14.0 + uTime*0.7*motion + aSeed));
        base = holo*dash*(0.5 + uLevel*1.6 + uGlow*0.6);
      }
    }
    ta = clamp((uReveal - 0.5)/0.5, 0.0, 1.0);
  } else if (isConduit) {
    // ---- LIGHT TRAFFIC: core→mouth speaking · ears→core listening ----
    float speakOn = clamp(uPulseDir, 0.0, 1.0)*clamp(uLevel*2.2, 0.0, 1.0);
    float listenOn = clamp(-uPulseDir, 0.0, 1.0);
    float on = max(speakOn, listenOn);
    float ph = fract(uTime*(0.55 + fract(aSeed*3.3)*0.5)*motion + aSeed*23.0);
    vec3 core = vec3((fract(aSeed*17.0) - 0.5)*0.05, 0.045 + fract(aSeed*29.0)*0.03, -0.005);
    vec3 mouth = vec3((fract(aSeed*41.0) - 0.5)*0.03, -0.070, 0.062);
    float side = aSeed < 0.5 ? -1.0 : 1.0;
    vec3 ear = vec3(side*0.062, -0.005, 0.005);
    vec3 A = listenOn > speakOn ? ear : core;
    vec3 B = listenOn > speakOn ? core : mouth;
    p = mix(A, B, ph);
    p += (hash33(vec3(aSeed*97.0, floor(ph*40.0), aSeed*13.0)) - 0.5)*0.006; // jittery packet path
    float packet = pow(0.5 + 0.5*sin(ph*6.28318*3.0 - uTime*9.0), 3.0);
    base = mix(vec3(0.85, 0.97, 1.0), uEmoCol*1.4, uGlow*0.6)*(0.4 + 1.6*packet);
    vFade0 *= on;
    lifeA = smoothstep(0.0, 0.12, ph)*(1.0 - smoothstep(0.85, 1.0, ph));
    ta = clamp((uReveal - 0.4)/0.6, 0.0, 1.0);
  } else {
    // skin / contour / circuit / core — posed by the shared warp
    p = headWarpFwd(aPos, uJaw, uSpread, uBlink, uBrowL, uBrowR);

    float eneM = clamp(0.55 + 0.55*uEnergy, 0.6, 1.6);
    float amp = (0.0010 + uLevel*0.0042 + uReactW*0.0035)*eneM*fxCalm*(isContour ? 0.38 : inner ? 0.7 : 1.0)*motion;
    vec3 nz = vec3(
      vnoise(aPos*40.0 + vec3(0.0, uTime*0.9, 0.0)),
      vnoise(aPos*40.0 + vec3(7.1, uTime*0.8, 3.0)),
      vnoise(aPos*40.0 + vec3(2.3, 5.9, uTime*0.7))) - 0.5;
    p += aNrm*(nz.x*amp*2.0) + nz*amp;
    if (fx == 4) p.x += sin(p.y*30.0 + uTime*3.4)*0.0012*motion;                 // reactor heat shimmer
    if (fx == 5) { p.x += sin(uTime*0.4 + aPos.y*4.0)*0.003*motion; p.y += sin(uTime*0.3)*0.002*motion; } // abyss buoyancy

    if (!inner) {
      float flow = step(0.55, fract(aSeed*13.7))*(1.0 - step(0.94, aSeed))*(isContour ? 0.0 : 1.0);
      if (flow > 0.5) {
        float u = fract(uTime*(0.10 + fract(aSeed*7.3)*0.12)*motion*clamp(0.5 + 0.6*uEnergy, 0.55, 1.5) + aSeed*11.0);
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
        p += vec3(sin(aSeed*231.0 + uTime*0.6)*0.06, ph*0.34 - 0.05, cos(aSeed*117.0 + uTime*0.5)*0.05)*0.85*motion;
      }
      if (feed > 0.5) {
        float ph = fract(uTime*(0.10 + aSeed*0.08)*motion + aSeed*29.0);
        vec3 src = vec3(sin(aSeed*400.0)*0.10, -0.42, 0.02 + cos(aSeed*300.0)*0.06);
        vec3 arc = mix(src, aPos, ph);
        arc.x += sin(ph*6.28318 + aSeed*40.0)*0.03*(1.0 - ph);
        p = mix(arc, p, smoothstep(0.75, 1.0, ph));
      }
    }

    if (uSleep > 0.003) {
      vec3 g1 = hash33(floor(aPos*22.0)) - 0.5;
      vec3 g2 = hash33(floor(aPos*22.0 + 31.0)) - 0.5;
      float m = clamp(uSleep*1.4 - fract(aSeed*5.1)*0.4, 0.0, 1.0);
      m = m*m*(3.0 - 2.0*m);
      vec3 drift = aPos + cross(g1, g2)*0.5 + aNrm*0.12 + vec3(0.0, -0.05, 0.0);
      p = mix(p, drift, m*0.85);
      lifeA *= 1.0 - 0.75*m;
    }
  }

  if (uGhost > 0.5 && !isIris) {
    p += uGhostOff;
    base *= vec3(1.5, 0.45, 0.45);
    vFade0 *= 0.30;
  }

  float gAmt = uReactW*0.9;
  float gseed = hash11(floor(uTime*1.7));
  if (gseed > 0.78) gAmt = max(gAmt, (gseed - 0.78)*0.7);
  if (gAmt > 0.01 && !isRing) {
    float band = step(abs(fract(p.y*9.0 + hash11(floor(uTime*11.0))*7.0) - 0.5), 0.10*gAmt);
    p.x += band*(hash11(floor(uTime*13.0) + floor(p.y*40.0)) - 0.5)*0.06*gAmt;
  }

  // scenario FX: raster/code rows quantize the projection
  if ((fx == 3 || fx == 7) && !isRing && !isIris && !isConduit) {
    float row = floor(p.y*130.0 + 0.5);
    p.y = row/130.0;
    if (fx == 3) vFade0 *= 1.0 - 0.6*step(hash21(vec2(row, floor(uTime*8.0))), 0.05);
    if (fx == 7) vFade0 *= 0.55 + 0.45*step(0.35, hash21(vec2(floor(aPos.x*50.0), row) + floor(uTime*6.0)));
  }

  float slice = 1.0;
  if (!isIris && !inner) {
    float slPhase = p.y*560.0 - uTime*2.8*motion;
    slice = 0.72 + 0.36*pow(0.5 + 0.5*sin(slPhase), 1.6);
    float bandId = floor(slPhase/6.28318);
    p.x += (hash11(bandId*0.613 + floor(uTime*7.0)*13.7) - 0.5)*0.0009*motion;
  }

  float sweepY = mix(-0.16, 0.15, clamp(uReveal*1.15, 0.0, 1.0));
  float matBand = exp(-pow((p.y - sweepY)*70.0, 2.0));
  float matOn = isRing ? 1.0 : smoothstep(sweepY + 0.004, sweepY - 0.004, p.y);
  if (uReveal < 0.999 && !isRing) {
    vFade0 *= max(matOn, 0.10);
    if (matOn < 0.5) base = vec3(0.5, 0.55, 0.6)*0.4;
    p.x += matBand*(hash11(aSeed*777.0 + floor(uTime*30.0)) - 0.5)*0.004;
  }

  float depthF = 0.50 + 0.50*smoothstep(-0.085, 0.045, p.z);
  vec3 world = isRing ? (p + uHeadPos*0.4 + vec3(0.0, -0.012, 0.0)) : (uHeadRot*p + uHeadPos);

  float chan = floor(fract(aSeed*91.7)*3.0);
  float sep = (0.0028*uLevel + 0.004*uReactW + 0.002*uDoubt + 0.0018*uGestureW + (fx == 2 ? 0.0024 : 0.0))*((isIris || inner) ? 0.0 : 1.0);
  world += (uCamRight*(chan - 1.0) + uCamFwd*(chan - 1.0)*1.6)*sep;

  if (uMirror > 0.5) world.y = -0.36 - world.y;
  vec4 viewPos = uView*vec4(world, 1.0);
  gl_Position = uProj*viewPos;

  // ---- color by layer ----
  float isEyeM = 0.0;
  if (!isIris && !isRing && !isConduit) {
    if (isCore) {
      // the mind: warm-white luminous mass, breathing, emotion-washed
      base = mix(vec3(0.75, 0.9, 1.0), uEmoCol*1.35, clamp(uGlow*1.2, 0.0, 0.85));
      base *= 0.5 + 0.22*uBreath + 0.35*clamp(uStormRate, 0.0, 1.2);
    } else if (isCircuit) {
      // machinery: dim teal lattice with circuit-trace lines + data pulses
      vec3 q = aPos*90.0;
      float trace = max(
        step(0.92, fract(q.x + floor(q.y)*0.5)),
        step(0.92, fract(q.y + floor(q.z)*0.5)));
      float pulseLn = step(0.985, hash21(vec2(floor(q.x), floor(q.y)) + floor(uTime*3.0)));
      base = holo*vec3(0.35, 0.55, 0.6)*(0.35 + 0.9*trace + 2.0*pulseLn);
    } else {
      if (aMat > 0.5 && aMat < 1.5) { isEyeM = 1.0; base = holo*0.22; }
      else if (aMat > 1.5 && aMat < 2.5) base = mix(vec3(0.42, 0.62, 1.0), uEmoCol*1.15, uGlow*0.5);
      else if (aMat > 2.5 && aMat < 3.5) base = holo*0.20;
      else if (aMat > 3.5 && aMat < 4.5) base = vec3(0.85, 0.95, 1.0)*0.5;
      else if (aMat > 5.5 && aMat < 6.5) base = holo*vec3(0.28, 0.38, 0.42);
      else if (aMat > 6.5) base = holo*vec3(0.30, 0.34, 0.40);
      base = mix(base*vec3(0.55, 0.75, 1.05), base, depthF);
    }
  }
  float csAmp = fx == 2 ? 1.8 : 1.0;
  float cs = sin(p.y*150.0 + uTime*0.9);
  base *= vec3(1.0 - (0.12 + gAmt*0.5)*csAmp*cs, 1.0, 1.0 + (0.10 + gAmt*0.5)*csAmp*cs);
  base *= uFxTint;
  if (fx == 9) base = mix(base, base.brg, 0.5 + 0.5*sin(aPos.y*36.0 + uTime*0.8)); // spectrum flow

  if (!isIris) {
    vec3 mask = chan < 0.5 ? vec3(3.0, 0.0, 0.0) : chan < 1.5 ? vec3(0.0, 3.0, 0.0) : vec3(0.0, 0.0, 3.0);
    base *= mix(vec3(1.0), mask, inner ? 0.25 : 0.60);
  }

  vec3 nw = uHeadRot*aNrm;
  float facing = dot(normalize(nw), normalize(uCamPos - world));
  float fres = pow(1.0 - abs(facing), 2.2);
  float rim = isCore ? 1.0 : 0.38 + 1.55*fres;
  // SKIN is glassier than IV: interior must read through it
  float backFade = (isRing || isIris || isConduit) ? 1.0 : mix(0.30, 1.0, smoothstep(-0.15, 0.10, facing));
  backFade = mix(backFade, 1.0, max(spark, feed));
  if (isContour) backFade = smoothstep(0.02, 0.22, facing);
  if (isCore || isCircuit) backFade = mix(0.55, 1.0, smoothstep(-0.1, 0.15, facing));

  // storms LIVE IN THE CORE now; skin gets only a faint echo
  float storm = 0.0, neuronSpike = 0.0;
  if (!isIris && !isRing) {
    float period = mix(4.2, 1.15, clamp(uStormRate, 0.0, 1.0));
    float cyc = floor(uTime/period);
    vec3 epi = (hash33(vec3(cyc*0.7, cyc*1.3, cyc*0.4)) - 0.5)*vec3(0.07, 0.05, 0.06) + vec3(0.0, 0.05, -0.005);
    float f = fract(uTime/period)*9.0 - length(aPos - epi)*52.0;
    float wavefront = exp(-pow(f - 0.4, 2.0)*2.2)*step(0.0, f + 1.0);
    float stormAmp = (isCore ? 1.4 : isCircuit ? 0.6 : 0.18)*(fx == 4 ? 1.6 : 1.0);
    storm = wavefront*0.55*stormAmp*clamp(uStormRate*1.6, 0.0, 1.0)*motion;
    float neuron = step(fract(aSeed*57.3), isCore ? 0.10 : 0.015);
    neuronSpike = neuron*exp(-max(f, 0.0)*2.0)*step(0.0, f)*stormAmp*clamp(uStormRate*2.0, 0.0, 1.3)*motion;
  }

  float moire = 1.0;
  if (!isIris) {
    float m1 = sin(aPos.y*260.0 + aPos.x*90.0 + uTime*1.6);
    float m2 = sin(aPos.y*243.0 - aPos.x*104.0 - uTime*1.25);
    moire = 1.0 + uDoubt*0.5*(m1*m2 - 0.2);
  }

  float pulse = 0.0;
  if (abs(uPulseDir) > 0.1 && !isRing && !inner) {
    float d = length(aPos - vec3(0.0, -0.060, 0.055));
    float w = fract(d*3.2 - uPulseDir*uTime*1.35);
    pulse = exp(-pow(w*11.0, 2.0)) + 0.3*exp(-pow(fract(w*2.0)*9.0, 2.0));
    pulse *= (uPulseDir > 0.0 ? (0.35 + 0.85*uLevel) : 0.5)*motion;
  }

  float ripple = (isIris || inner) ? 0.0 : sin(length(aPos - vec3(0.0, -0.072, 0.070))*160.0 - uTime*11.0)*exp(-length(aPos - vec3(0.0, -0.072, 0.070))*9.0)*uLevel;
  float emoBand = 0.0;
  if (uEmoPulse > 0.01 && !isRing) {
    float dC = length(aPos - vec3(0.0, -0.01, 0.02));
    float front = (1.0 - uEmoPulse)*0.24;
    emoBand = exp(-pow((dC - front)*42.0, 2.0))*uEmoPulse;
    base = mix(base, uEmoCol*1.7, emoBand*0.85);
  }
  float sweep = exp(-pow((p.y - (fract(uTime*0.13)*0.9 - 0.5))*22.0, 2.0));
  float tw = 0.75 + (0.30 + 0.45*clamp(uEnergy, 0.3, 1.7))*hash11(aSeed*997.0 + floor(uTime*(5.0 + 3.0*uEnergy) + aSeed*20.0));
  if (fx == 1) tw *= 0.8 + 0.6*hash11(aSeed*77.0 + floor(uTime*11.0)); // stardust scintillation
  float breathAmp = 0.92 + 0.08*uBreath;

  float lidar = 1.0;
  if (!isIris && !isRing && !isContour && !inner) {
    float graze = 1.0 - abs(facing);
    lidar = 1.0 - 0.55*step(hash21(vec2(aSeed*513.0, floor(uTime*16.0))), 0.03 + 0.14*graze*graze*graze);
  }

  float amp2 = rim*tw*slice*moire*(1.0 + sweep*0.9 + ripple*1.8 + storm + pulse*1.6)
             * (0.80 + uLevel*0.42 + uGlow*0.28 + uGestureW*0.22 + emoBand*2.0)*breathAmp*depthF;
  if (isContour) amp2 = tw*moire*(1.8 + sweep*0.8 + ripple*2.2 + storm*1.4 + pulse*1.8 + emoBand*2.2)*(0.9 + uLevel*0.4 + uGlow*0.28 + uGestureW*0.25)*depthF;
  if (isIris) amp2 = 1.6 + uLevel*0.3 + uGlow*0.2;
  if (isRing) amp2 = 1.0;
  if (isCore) amp2 = tw*moire*(0.9 + storm*1.6)*(0.8 + uGlow*0.3 + uGestureW*0.3 + emoBand*2.0);
  if (isCircuit) amp2 = tw*(0.85 + storm)*moire*(0.8 + uGlow*0.25 + emoBand*1.6);
  if (isConduit) amp2 = 1.3;
  amp2 += matBand*2.4*(uReveal < 0.999 ? 1.0 : 0.0);

  // scenario FX brightness shaping
  if (fx == 5 && !isIris && !isRing) amp2 *= 0.8 + 0.5*max(0.0, sin(aPos.x*80.0 + uTime*1.2)*sin(aPos.y*66.0 - uTime*0.9)); // caustic waves
  if (fx == 8 && !isRing && !isIris && !isConduit) { // voxon sweep: the plane paints, trails hold
    float ph2 = abs(fract(uTime*0.35)*2.0 - 1.0);
    float sband = exp(-pow((p.y - mix(-0.13, 0.15, ph2))*80.0, 2.0));
    amp2 = amp2*0.22 + amp2*sband*3.4;
  }
  if (fx == 6) amp2 *= 0.85; // golden dust: softer

  // SKIN transparency: dial the outer layer down so the mind shows through
  if (!inner && !isIris && !isRing && !isContour) amp2 *= 0.62;

  vec3 col = base*amp2 + vec3(1.0, 1.0, 1.05)*neuronSpike*2.2;
  float lum = dot(col, vec3(0.3, 0.5, 0.2));
  col = mix(col, vec3(lum), 0.30*uFreeze);
  col *= 1.0 - 0.25*uFreeze*step(0.5, fract(uTime*2.2));
  vColor = col;

  float mouthGate = smoothstep(0.10, 0.40, uJaw);
  if (!isIris && !isRing && !inner && aMat > 2.5 && aMat < 4.5) vFade0 *= mouthGate;
  float mirrorFade = uMirror > 0.5 ? 0.15 : 1.0;
  vFade = vFade0*lifeA*ta*(spark > 0.5 ? 0.45 : 1.0)*(feed > 0.5 ? 0.6 : 1.0)*backFade*mirrorFade*lidar;

  // DEPTH OF FIELD: focus plane at the eyes; blur = bigger + dimmer
  float blur = clamp(abs(-viewPos.z - uFocusD)*9.0, 0.0, 1.6);
  vFade /= (1.0 + blur*1.4);

  float sz = isRing ? 0.0009 : isIris ? 0.00085 : isContour ? 0.0011
           : isConduit ? 0.0013 : isCore ? 0.0017 : isCircuit ? 0.0010
           : (spark > 0.5 ? 0.0012 : 0.0016)*(0.8 + 0.6*aSeed);
  sz *= (1.0 + neuronSpike*1.6)*(1.0 + blur*1.1)*(fx == 6 ? 1.3 : 1.0);
  gl_PointSize = clamp(sz*uPixelScale/max(-viewPos.z, 0.05), 1.0, 9.0);
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
  float a = (vType > 0.5 && vType < 2.5) ? exp(-r2*4.6) : exp(-r2*3.2);
  outColor = vec4(vColor*a*vFade*0.14, 1.0);
}
`;

export class Wisp5Face {
  static title = 'WISP V';
  static tech = 'GLASS MIND · ANATOMY';
  static CAM = { dist: 0.62, targetY: -0.012 };
  static blurb =
    'Interiority. Three anatomical layers extracted from the same distance field: a ' +
    'glassy skin you look through, a circuit lattice beneath it, and a luminous brain ' +
    'core where the thought-storms actually live. Speech flows as light from the core ' +
    'to the mouth; listening streams from the ears inward. A raymarched glass shell ' +
    'gives it real specular solidity, and the camera focuses at the eyes. You are ' +
    'watching a mind, housed in glass.';

  constructor(gl, assets) {
    this.gl = gl;
    this._col = [0.20, 0.80, 1.00];
    this._sleep = 0;
    this._lastEmo = 'neutral';
    this._emoPulse = 0;
    this._dtAvg = 0.016; // adaptive shell (skips on software GL)

    const bg = program(gl, HOLO_BG_VS, HOLO_BG_FS, 'wisp5.bg');
    this.bgProg = bg.prog; this.bgU = bg.u;
    this.quadVao = fullscreenVAO(gl);
    const pt = program(gl, PT_VS, PT_FS, 'wisp5.pt');
    this.ptProg = pt.prog; this.ptU = pt.u;
    const decay = program(gl, QUAD_VS, DECAY_FS, 'wisp5.decay');
    this.decayProg = decay.prog; this.decayU = decay.u;
    const comp = program(gl, QUAD_VS, COMP_FS, 'wisp5.comp');
    this.compProg = comp.prog; this.compU = comp.u;
    const shell = program(gl, QUAD_VS, SHELL_FS, 'wisp5.shell');
    this.shellProg = shell.prog; this.shellU = shell.u;

    this._fbo = [null, null]; this._tex = [null, null];
    this._fw = 0; this._fh = 0; this._flip = 0;
    this._sFbo = null; this._sTex = null; this._sw = 0; this._sh = 0;

    // ---------- LAYER EXTRACTION from the shared distance field ----------
    const { dist, mats } = assets.field;
    const shift = (iso) => {
      const d2 = new Float32Array(dist.length);
      for (let i = 0; i < dist.length; i++) d2[i] = dist[i] + iso;
      return d2;
    };
    // skin: reuse the shared outer mesh, sparser than IV
    const sstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
    const weightFn = (x, y, z, mat) => {
      let w = 1;
      w *= 0.45 + 0.55 * sstep(-0.075, 0.045, z);
      w *= 1 + 1.1 * sstep(-0.02, 0.06, z);
      if (mat === 1) w *= 0.7;
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
    const skin = sampleSurfaceWeighted(assets.mesh, 60000, weightFn, mulberry32(5055));

    // circuit lattice: inner shell at −5.5mm
    const circuitMesh = surfaceNets(shift(0.0055), mats);
    const circuit = sampleSurfaceWeighted(circuitMesh, 20000, (x, y, z) => 0.5 + 0.5 * sstep(-0.06, 0.03, z), mulberry32(5155));

    // brain core: VOLUMETRIC — grid cells deeper than −13mm, cranium only
    const { nx, ny, nz, min, max } = GRID;
    const cx = (max[0] - min[0]) / (nx - 1), cy = (max[1] - min[1]) / (ny - 1), cz = (max[2] - min[2]) / (nz - 1);
    const corePts = [], coreNrm = [];
    const cr = mulberry32(5255);
    const gi = (x, y, z) => x + nx * (y + ny * z);
    for (let z = 1; z < nz - 1; z += 2) for (let y = 1; y < ny - 1; y += 2) for (let x = 1; x < nx - 1; x += 2) {
      if (dist[gi(x, y, z)] > -0.013) continue;
      const wy = min[1] + y * cy;
      if (wy < 0.005) continue; // cranium only — the mind sits high
      if (cr() > 0.35) continue;
      corePts.push(min[0] + x * cx + (cr() - 0.5) * cx * 2, wy + (cr() - 0.5) * cy * 2, min[2] + z * cz + (cr() - 0.5) * cz * 2);
      // normal from field gradient (for consistency; core barely uses it)
      const gx = dist[gi(x + 1, y, z)] - dist[gi(x - 1, y, z)];
      const gy = dist[gi(x, y + 1, z)] - dist[gi(x, y - 1, z)];
      const gz = dist[gi(x, y, z + 1)] - dist[gi(x, y, z - 1)];
      const l = Math.hypot(gx, gy, gz) || 1;
      coreNrm.push(gx / l, gy / l, gz / l);
    }
    const coreN = corePts.length / 3;

    // contours (v4 recipe with mouth cull)
    const conRaw = extractFeatureEdges(assets.mesh, { angleDeg: 13, spacing: 0.0016, maxPoints: 15000, minZ: -0.01 });
    const keep = [];
    for (let i = 0; i < conRaw.count; i++) {
      const x = conRaw.positions[i * 3], y = conRaw.positions[i * 3 + 1], z = conRaw.positions[i * 3 + 2];
      if (!(Math.abs(x) < 0.034 && Math.abs(y + 0.072) < 0.024 && z < 0.0685)) keep.push(i);
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

    // rings + iris (v4.1)
    const ringN = 3600;
    const rp = new Float32Array(ringN * 3), rn = new Float32Array(ringN * 3), rm = new Float32Array(ringN), rs = new Float32Array(ringN);
    const rr = mulberry32(7);
    for (let i = 0; i < ringN; i++) {
      const inner = i < ringN * 0.5;
      const a = rr() * Math.PI * 2;
      const rad = inner ? 0.185 : 0.215;
      const lvl = inner ? 0.005 : -0.085;
      const tilt = inner ? 0.10 : -0.06;
      rp[i * 3] = Math.cos(a) * rad;
      rp[i * 3 + 1] = lvl + Math.sin(a) * rad * tilt + (rr() - 0.5) * 0.0015;
      rp[i * 3 + 2] = Math.sin(a) * rad;
      rn[i * 3 + 1] = 1;
      rs[i] = inner ? rr() * 0.49 : 0.5 + rr() * 0.5;
    }
    const irisPerEye = 1300, irisN = irisPerEye * 2;
    const ip = new Float32Array(irisN * 3), inr = new Float32Array(irisN * 3), im = new Float32Array(irisN), isd = new Float32Array(irisN);
    const ir = mulberry32(41);
    for (let e = 0; e < 2; e++) {
      const side = e === 0 ? -1 : 1;
      for (let i = 0; i < irisPerEye; i++) {
        const ix = e * irisPerEye + i;
        ip[ix * 3] = Math.sqrt(ir()) * 0.0050;
        ip[ix * 3 + 1] = ir() * Math.PI * 2;
        ip[ix * 3 + 2] = side;
        inr[ix * 3 + 2] = 1;
        im[ix] = 1;
        isd[ix] = ir();
      }
    }
    // conduits: light packets (positions computed in-shader from seeds)
    const condN = 2600;
    const cp = new Float32Array(condN * 3), cn = new Float32Array(condN * 3), cmm = new Float32Array(condN), csd = new Float32Array(condN);
    const cnd = mulberry32(97);
    for (let i = 0; i < condN; i++) { cn[i * 3 + 2] = 1; csd[i] = cnd(); }

    const cat = (arrs) => {
      const total = arrs.reduce((n, a) => n + a.length, 0);
      const out = new Float32Array(total);
      let o = 0;
      for (const a of arrs) { out.set(a, o); o += a.length; }
      return out;
    };
    const positions = cat([skin.positions, con.positions, rp, ip, circuit.positions, new Float32Array(corePts), cp]);
    const normals = cat([skin.normals, con.normals, rn, inr, circuit.normals, new Float32Array(coreNrm), cn]);
    const matsA = cat([skin.mats, con.mats, rm, im, circuit.mats, new Float32Array(coreN), cmm]);
    const seeds = cat([skin.seeds, con.seeds, rs, isd, circuit.seeds, (() => { const s2 = new Float32Array(coreN); const r2 = mulberry32(313); for (let i = 0; i < coreN; i++) s2[i] = r2(); return s2; })(), csd]);
    const types = new Float32Array(positions.length / 3);
    let off = 0;
    for (const [arr, ty] of [[skin, 0], [con, 1], [{ count: ringN }, 2], [{ count: irisN }, 3], [circuit, 4], [{ count: coreN }, 5], [{ count: condN }, 6]]) {
      types.fill(ty, off, off + arr.count);
      off += arr.count;
    }
    this.count = positions.length / 3;
    this.coreCount = coreN;

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
    attach(2, matsA, 1);
    attach(3, seeds, 1);
    attach(4, types, 1);
    gl.bindVertexArray(null);
  }

  _ensureTrails(w, h) {
    const gl = this.gl;
    const fw = Math.max(2, w >> 1), fh = Math.max(2, h >> 1);
    if (fw !== this._fw || fh !== this._fh) {
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
    }
    const sw = Math.max(2, w >> 2), sh = Math.max(2, h >> 2);
    if (sw !== this._sw || sh !== this._sh) {
      this._sw = sw; this._sh = sh;
      if (this._sTex) { gl.deleteTexture(this._sTex); gl.deleteFramebuffer(this._sFbo); }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sw, sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this._sTex = tex; this._sFbo = fbo;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  draw(cm) {
    const gl = this.gl;
    const s = cm.s;
    const target = EMO_COL[s.emotion] || EMO_COL.neutral;
    const k = 1 - Math.exp(-2.5 * cm.dt);
    for (let i = 0; i < 3; i++) this._col[i] += (target[i] - this._col[i]) * k;
    if (s.emotion !== this._lastEmo) { this._lastEmo = s.emotion; this._emoPulse = 1; }
    this._emoPulse = Math.max(0, this._emoPulse - cm.dt * 1.4);
    this._dtAvg += (cm.dt - this._dtAvg) * 0.05;
    const shellOn = this._dtAvg < 0.07; // adaptive: skip raymarch below ~14fps

    const sleepT = s.state === 'sleeping' ? 1 : 0;
    this._sleep += (sleepT - this._sleep) * (1 - Math.exp(-1.6 * cm.dt));
    const stormRate = s.state === 'thinking' ? 1.0 : s.state === 'listening' ? 0.32 : s.state === 'alert' ? 0.85 : 0.16 + (s.glow || 0) * 0.2;
    const pulseDir = s.level > 0.06 && s.state !== 'listening' ? 1 : s.state === 'listening' ? -1 : 0;
    const focusD = cm.camPos[2] - 0.05; // eye plane

    this._ensureTrails(cm.width, cm.height);
    const cur = this._flip, prev = 1 - this._flip;
    this._flip = prev;

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

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.ptProg);
    const u = this.ptU;
    gl.uniformMatrix4fv(u.uProj, false, cm.proj);
    gl.uniformMatrix4fv(u.uView, false, cm.view);
    gl.uniformMatrix3fv(u.uHeadRot, false, cm.headRot);
    gl.uniform3fv(u.uHeadPos, cm.headPos);
    gl.uniform3fv(u.uCamPos, cm.camPos);
    gl.uniform3fv(u.uCamRight, cm.camRight);
    gl.uniform3fv(u.uCamFwd, cm.camFwd);
    gl.uniform1f(u.uTime, cm.t);
    gl.uniform1f(u.uReveal, cm.reveal);
    gl.uniform1f(u.uPixelScale, this._fh / (2 * cm.tanHalf));
    gl.uniform1f(u.uJaw, s.jaw);
    gl.uniform1f(u.uSpread, s.spread);
    gl.uniform1f(u.uBlink, s.blink);
    gl.uniform1f(u.uBrowL, s.browL);
    gl.uniform1f(u.uBrowR, s.browR);
    gl.uniform1f(u.uLevel, s.level);
    gl.uniform1f(u.uGlow, s.glow || 0);
    gl.uniform1f(u.uReactW, s.reactW || 0);
    gl.uniform1f(u.uBreath, s.breath || 0.5);
    gl.uniform1f(u.uDoubt, s.doubt || 0);
    gl.uniform1f(u.uFreeze, s.freeze || 0);
    gl.uniform1f(u.uSleep, this._sleep);
    gl.uniform1f(u.uStormRate, stormRate);
    gl.uniform1f(u.uPulseDir, pulseDir);
    gl.uniform1f(u.uIntensity, s.intensity ?? 1);
    gl.uniform1f(u.uEnergy, s.energy ?? 1);
    gl.uniform1f(u.uGestureW, s.gestureW || 0);
    gl.uniform1f(u.uEmoPulse, this._emoPulse);
    gl.uniform1f(u.uFocusD, focusD);
    gl.uniform1f(u.uFxMode, (cm.scene && cm.scene.fx) || 0);
    const ft = (cm.scene && cm.scene.tint) || [1, 1, 1];
    gl.uniform3f(u.uFxTint, ft[0], ft[1], ft[2]);
    if (u.uPupil) gl.uniform1f(u.uPupil, s.pupil || 1);
    gl.uniform3fv(u.uGazeDir, cm.gazeDir);
    gl.uniform3fv(u.uEmoCol, this._col);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(u.uGhost, 0);
    gl.uniform3f(u.uGhostOff, 0, 0, 0);
    gl.uniform1f(u.uMirror, 1);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.uniform1f(u.uMirror, 0);
    gl.drawArrays(gl.POINTS, 0, this.count);
    const rw = s.reactW || 0;
    if (rw > 0.5 || s.state === 'alert') {
      const g = Math.max(rw, 0.6);
      gl.uniform1f(u.uGhost, 1);
      const j = Math.sin(cm.t * 23.7);
      gl.uniform3f(u.uGhostOff, 0.018 * g * j, 0.006 * g, -0.01 * g * j);
      gl.drawArrays(gl.POINTS, 0, this.count);
      gl.uniform3f(u.uGhostOff, -0.016 * g * j, -0.004 * g, 0.012 * g * j);
      gl.drawArrays(gl.POINTS, 0, this.count);
      gl.uniform1f(u.uGhost, 0);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);

    // ---- glass shell pass (quarter-res raymarch, adaptive) ----
    if (shellOn) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._sFbo);
      gl.viewport(0, 0, this._sw, this._sh);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.shellProg);
      const su = this.shellU;
      gl.uniform2f(su.uRes, this._sw, this._sh);
      gl.uniform3fv(su.uCamPos, cm.camPos);
      gl.uniform3fv(su.uCamRight, cm.camRight);
      gl.uniform3fv(su.uCamUp, cm.camUp);
      gl.uniform3fv(su.uCamFwd, cm.camFwd);
      gl.uniform3fv(su.uHeadPos, cm.headPos);
      gl.uniformMatrix3fv(su.uInvHeadRot, false, cm.invHeadRot);
      gl.uniform1f(su.uTanHalf, cm.tanHalf);
      gl.uniform1f(su.uTime, cm.t);
      gl.uniform1f(su.uJaw, s.jaw);
      gl.uniform1f(su.uSpread, s.spread);
      gl.uniform1f(su.uBlink, Math.max(0, s.blink));
      gl.uniform1f(su.uBrowL, s.browL);
      gl.uniform1f(su.uBrowR, s.browR);
      gl.uniform1f(su.uGlow, s.glow || 0);
      gl.uniform1f(su.uReveal, cm.reveal);
      gl.uniform3fv(su.uEmoCol, this._col);
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ---- backdrop + composites ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cm.width, cm.height);
    gl.useProgram(this.bgProg);
    gl.uniform2f(this.bgU.uRes, cm.width, cm.height);
    gl.uniform1f(this.bgU.uTime, cm.t);
    gl.uniform1f(this.bgU.uLevel, s.level);
    gl.uniform1f(this.bgU.uGlow, s.glow || 0);
    gl.uniform3fv(this.bgU.uEmoCol, this._col);
    if (this.bgU.uScene) gl.uniform1f(this.bgU.uScene, (cm.scene && cm.scene.bg) || 0);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.compProg);
    gl.activeTexture(gl.TEXTURE0);
    if (shellOn) {
      gl.bindTexture(gl.TEXTURE_2D, this._sTex);
      gl.uniform1i(this.compU.uTex, 0);
      gl.uniform1f(this.compU.uGain, 1.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindTexture(gl.TEXTURE_2D, this._tex[cur]);
    gl.uniform1i(this.compU.uTex, 0);
    gl.uniform1f(this.compU.uGain, 0.82);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}
