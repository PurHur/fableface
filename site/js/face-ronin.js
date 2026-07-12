// face-ronin.js — RONIN: a hard-surface industrial mech head. Deliberately NOT
// an android: separate machined plates with real panel gaps, camera-lens eyes
// with shutter blinks, mechanical brow plates, a rigid hinged jaw and a voice
// bar that burns with the audio level. Edge wear is computed from surface
// curvature. Pure raymarch, own SDF.

import { program, fullscreenVAO } from './gl.js';
import { GLSL_COMMON, GLSL_SDF, glslHeader } from './headsdf.js';

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FS = glslHeader(`
#define R_ARMOR 0.0
#define R_LENS 1.0
#define R_DARK 2.0
#define R_MECH 3.0
#define R_ACCENT 4.0
#define R_VBAR 5.0
`) + GLSL_COMMON + GLSL_SDF + /* glsl */ `
uniform vec2 uRes;
uniform float uTime, uReveal;
uniform vec3 uCamPos, uCamRight, uCamUp, uCamFwd;
uniform vec2 uTanHalf;
uniform mat3 uInvHeadRot;
uniform vec3 uHeadPos;
uniform float uJaw, uSpread, uBlink, uBrowL, uBrowR, uLevel;
uniform vec3 uGazeDir;
out vec4 outColor;

float sdRoundBox(vec3 p, vec3 b, float r){
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
float sdCylZ(vec3 p, float r, float h){
  vec2 d = vec2(length(p.xy) - r, abs(p.z) - h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
float sdCylX(vec3 p, float r, float h){
  vec2 d = vec2(length(p.yz) - r, abs(p.x) - h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
float sdCylY(vec3 p, float r, float h){
  vec2 d = vec2(length(p.xz) - r, abs(p.y) - h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

// ---- the mech head ----
vec2 sdRonin(vec3 p, float jaw, float blink, float browL, float browR){
  vec3 q = vec3(abs(p.x), p.y, p.z);
  vec3 pjaw = jawRot(p, jaw*0.26); // rigid mechanical jaw about the shared hinge

  float mat = R_ARMOR;

  // cranium dome + back plate — tapered helmet, not a cube
  float d = sdRoundBox(p - vec3(0.0, 0.044, -0.012), vec3(0.040, 0.028, 0.048), 0.023);
  d = smax(d, q.x + p.y*0.22 - 0.0700, 0.012); // crown taper
  d = min(d, sdRoundBox(p - vec3(0.0, 0.006, -0.062), vec3(0.035, 0.046, 0.011), 0.012));

  // brow visor (tilted)
  vec3 pv = p - vec3(0.0, 0.020, 0.036);
  pv.yz = mat2(cos(-0.16), sin(-0.16), -sin(-0.16), cos(-0.16))*pv.yz;
  d = min(d, sdRoundBox(pv, vec3(0.042, 0.0082, 0.020), 0.006));

  // animated brow plates
  float browX = p.x < 0.0 ? browL : browR;
  vec3 pb = vec3(q.x, p.y, p.z) - vec3(0.0265, 0.0160 + browX*0.0055, 0.0545);
  float ca = cos(browX*0.45), sa = sin(browX*0.45);
  pb.yz = mat2(ca, sa, -sa, ca)*pb.yz;
  float bp = sdRoundBox(pb, vec3(0.0120, 0.0028, 0.0048), 0.0025);
  if (bp < d) mat = R_ACCENT;
  d = min(d, bp);

  // cheek plates (angled in)
  vec3 pc = q - vec3(0.0360, -0.038, 0.0210);
  pc.xz = mat2(cos(0.22), -sin(0.22), sin(0.22), cos(0.22))*pc.xz;
  d = min(d, sdRoundBox(pc, vec3(0.0125, 0.019, 0.017), 0.008));

  // central sensor ridge (the "nose") — slim, ends above the mouth
  d = min(d, sdRoundBox(p - vec3(0.0, -0.008, 0.0475), vec3(0.0045, 0.019, 0.009), 0.004));

  // eye socket recess plate (dark)
  float sock = sdRoundBox(p - vec3(0.0, -0.002, 0.028), vec3(0.0430, 0.0150, 0.011), 0.007);
  if (sock < d) mat = R_DARK;
  d = min(d, sock);

  // lens barrels + housings
  float lens = sdCylZ(vec3(q.x - 0.0300, p.y + 0.002, p.z - 0.0450), 0.0158, 0.0155);
  float hous = sdCylZ(vec3(q.x - 0.0300, p.y + 0.002, p.z - 0.0385), 0.0188, 0.0075);
  if (hous < d) mat = R_DARK;
  d = min(d, hous);
  if (lens < d) mat = R_LENS;
  d = min(d, lens);

  // jaw assembly: plate + arms (rigid), hinge caps (static)
  float jbox = sdRoundBox(pjaw - vec3(0.0, -0.068, 0.016), vec3(0.025, 0.012, 0.018), 0.009);
  vec3 qj = vec3(abs(pjaw.x), pjaw.y, pjaw.z);
  float arm = sdCapsule(qj, vec3(0.029, -0.064, 0.005), vec3(0.045, -0.030, -0.012), 0.0062);
  float jawAsm = min(jbox, arm);
  if (jawAsm < d) mat = R_ARMOR;
  d = min(d, jawAsm);
  float hinge = sdCylX(vec3(q.x - 0.0475, p.y + 0.030, p.z + 0.012), 0.0100, 0.0042);
  if (hinge < d) mat = R_MECH;
  d = min(d, hinge);

  // mouth interior (dark) + voice bar, revealed as the jaw drops
  float ib = sdRoundBox(p - vec3(0.0, -0.052, 0.016), vec3(0.020, 0.013, 0.012), 0.006);
  if (ib < d) mat = R_DARK;
  d = min(d, ib);
  float vb = sdRoundBox(p - vec3(0.0, -0.0475, 0.0330), vec3(0.0140, 0.0024, 0.0018), 0.0015);
  if (vb < d) mat = R_VBAR;
  d = min(d, vb);

  // ear pods with heat-sink look — proud of the tapered skull sides
  float pod = sdCylX(vec3(q.x - 0.0620, p.y + 0.004, p.z - 0.000), 0.0160, 0.0062);
  if (pod < d) mat = R_ACCENT;
  d = min(d, pod);

  // neck: core column, collar ring, twin pistons + rods, cable
  float neck = sdCylY(p - vec3(0.0, -0.165, -0.014), 0.0170, 0.070);
  float collar = sdCylY(p - vec3(0.0, -0.132, -0.012), 0.0350, 0.0060);
  float pist = sdCapsule(q, vec3(0.0200, -0.096, 0.004), vec3(0.0280, -0.190, -0.002), 0.0046);
  float rod  = sdCapsule(q, vec3(0.0245, -0.140, 0.001), vec3(0.0280, -0.190, -0.002), 0.0025);
  float cab  = sdCapsule(p, vec3(0.0, -0.092, -0.032), vec3(0.0, -0.20, -0.040), 0.0062);
  float mech = min(min(neck, pist), min(rod, cab));
  if (mech < d) mat = R_MECH;
  d = min(d, mech);
  if (collar < d) mat = R_ARMOR;
  d = min(d, collar);

  // shoulder yoke
  float sh = sdRoundBox(p - vec3(0.0, -0.258, -0.030), vec3(0.122, 0.042, 0.048), 0.025);
  if (sh < d) mat = R_ARMOR;
  d = min(d, sh);

  return vec2(d, mat);
}

vec2 map(vec3 p){ return sdRonin(p, uJaw, uBlink, uBrowL, uBrowR); }

vec3 calcNormal(vec3 p){
  const vec2 e = vec2(0.0005, -0.0005);
  return normalize(
    e.xyy*map(p + e.xyy).x + e.yyx*map(p + e.yyx).x +
    e.yxy*map(p + e.yxy).x + e.xxx*map(p + e.xxx).x);
}

float calcAO(vec3 p, vec3 n){
  float occ = 0.0, sca = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = 0.004 + 0.011*float(i);
    occ += (h - map(p + n*h).x)*sca;
    sca *= 0.72;
  }
  return clamp(1.0 - 2.8*occ, 0.0, 1.0);
}

float softShadow(vec3 ro, vec3 rd){
  float res = 1.0, t = 0.008;
  for (int i = 0; i < 12; i++) {
    float h = map(ro + rd*t).x;
    res = min(res, 10.0*h/t);
    t += clamp(h, 0.004, 0.05);
    if (res < 0.02 || t > 0.6) break;
  }
  return clamp(res, 0.0, 1.0);
}

// camera-lens eye: concentric elements + glowing iris ring, shutter on blink
vec3 shadeLens(vec3 pos, vec3 gazeDir, float blink, float level){
  vec3 c = vec3(0.0300*sign(pos.x), -0.002, 0.0450);
  vec3 dirv = normalize(pos - c);
  vec3 gd = normalize(gazeDir + vec3(-sign(pos.x)*0.03, 0.0, 0.0));
  float ang = acos(clamp(dot(dirv, gd), -1.0, 1.0));
  float rings = 0.5 + 0.5*sin(ang*95.0);
  vec3 col = vec3(0.015, 0.017, 0.022) + vec3(0.045, 0.05, 0.06)*rings*smoothstep(0.55, 0.15, ang);
  float ap = mix(0.30, 0.045, clamp(blink, 0.0, 1.0));
  float glow = 1.1 + 0.5*level;
  col += vec3(1.0, 0.52, 0.12)*glow*1.5*exp(-pow((ang - ap)*15.0, 2.0));
  col += vec3(1.0, 0.60, 0.18)*glow*0.30*smoothstep(ap, ap*0.25, ang);
  return col;
}

vec3 background(vec2 ndc){
  // industrial bay: dark, warm underglow, cool shaft
  vec3 col = mix(vec3(0.020, 0.021, 0.024), vec3(0.055, 0.058, 0.066),
                 clamp(1.0 - length(ndc*vec2(0.8, 1.0))*0.6, 0.0, 1.0));
  col += vec3(0.55, 0.30, 0.08)*0.12*exp(-pow((ndc.y + 0.92)*2.6, 2.0));
  col += vec3(0.20, 0.26, 0.34)*0.5*exp(-pow((ndc.x + 0.9 - ndc.y*0.35)*1.6, 2.0))*0.25;
  col += vec3(0.05, 0.055, 0.06)*fbm(vec3(ndc*3.0, uTime*0.015))*0.5;
  return col;
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 ndc = (2.0*frag - uRes)/uRes.y;
  vec3 rd = normalize(uCamRight*ndc.x*uTanHalf.y + uCamUp*ndc.y*uTanHalf.y + uCamFwd);
  vec3 ro = uInvHeadRot*(uCamPos - uHeadPos);
  vec3 rl = uInvHeadRot*rd;

  vec3 bg = background(ndc);
  vec3 col = bg;

  float t = 0.15, mat = -1.0;
  vec3 pos;
  for (int i = 0; i < 110; i++) {
    pos = ro + rl*t;
    vec2 dm = map(pos);
    if (dm.x < 0.0002*t) { mat = dm.y; break; }
    t += dm.x*0.9;
    if (t > 1.4) break;
  }

  if (mat >= 0.0) {
    vec3 n = calcNormal(pos);
    vec3 v = -rl;
    float ao = calcAO(pos, n);
    // edge wear: convex machined edges lose their paint
    float curv = map(pos + n*0.004).x - 0.004;
    float wear = smoothstep(-0.0006, -0.0022, curv);

    vec3 L1 = normalize(uInvHeadRot*vec3(0.55, 0.65, 0.5));   // warm key
    vec3 L2 = normalize(uInvHeadRot*vec3(-0.65, -0.25, 0.45));// amber bounce
    vec3 L3 = normalize(uInvHeadRot*vec3(0.0, 0.35, -0.95));  // cool rim

    vec3 albedo; float rough = 0.4, spec = 0.5; float metal = 0.3;
    vec3 emiss = vec3(0.0);

    float scratches = 0.88 + 0.22*vnoise(pos*vec3(700.0, 55.0, 700.0));

    if (mat < 0.5) { // painted armor: gray-olive, chipped at the edges
      albedo = vec3(0.230, 0.245, 0.220)*scratches;
      albedo = mix(albedo, vec3(0.55, 0.56, 0.58), wear);
      rough = mix(0.55, 0.30, wear); metal = mix(0.15, 0.9, wear);
    } else if (mat < 1.5) { // lens
      albedo = shadeLens(pos, uGazeDir, uBlink, uLevel);
      emiss = albedo*0.7;
      rough = 0.08; metal = 0.0; spec = 1.0;
    } else if (mat < 2.5) { // rubber gasket / interior
      albedo = vec3(0.040, 0.040, 0.043)*scratches;
      rough = 0.75; metal = 0.0; spec = 0.15;
    } else if (mat < 3.5) { // bare mech: pistons, hinges — dark oiled steel
      albedo = vec3(0.20, 0.21, 0.23)*scratches;
      rough = 0.28; metal = 0.95;
      float band = smoothstep(0.4, 0.9, abs(sin(pos.y*420.0)));
      albedo *= 0.88 + 0.14*band;
    } else if (mat < 4.5) { // safety-orange accent plates, worn
      albedo = vec3(0.62, 0.215, 0.045)*scratches;
      albedo = mix(albedo, vec3(0.55, 0.56, 0.58), wear);
      rough = mix(0.5, 0.3, wear); metal = mix(0.1, 0.9, wear);
      // heat-sink fins on the ear pods
      if (abs(pos.x) > 0.048) {
        float fin = smoothstep(0.3, 0.9, abs(sin(pos.z*550.0 + pos.y*80.0)));
        albedo *= 0.72 + 0.35*fin;
      }
    } else { // voice bar
      float seg = smoothstep(0.25, 0.8, abs(sin(pos.x*420.0)));
      float burn = 0.15 + 1.6*uLevel;
      albedo = vec3(0.08, 0.03, 0.01);
      emiss = vec3(1.0, 0.42, 0.08)*burn*(0.4 + 0.6*seg);
      rough = 0.3;
    }

    float sh = mix(0.30, 1.0, softShadow(pos + n*0.004, L1));
    float d1 = clamp(dot(n, L1), 0.0, 1.0)*sh;
    float d2 = clamp(dot(n, L2)*0.5 + 0.5, 0.0, 1.0);
    float d3 = clamp(dot(n, L3), 0.0, 1.0);
    vec3 h1 = normalize(L1 + v);
    float sp1 = pow(clamp(dot(n, h1), 0.0, 1.0), mix(200.0, 22.0, rough))*sh;
    vec3 h3 = normalize(L3 + v);
    float sp3 = pow(clamp(dot(n, h3), 0.0, 1.0), 60.0);
    float fres = pow(clamp(1.0 + dot(n, rl), 0.0, 1.0), 3.5);

    vec3 specCol = mix(vec3(0.05), albedo + 0.3, metal);
    col = albedo*(vec3(1.1, 1.02, 0.9)*1.15*d1 + vec3(0.45, 0.28, 0.14)*0.5*d2 + vec3(0.10, 0.11, 0.13));
    col += specCol*sp1*1.4;
    col += vec3(0.5, 0.65, 0.9)*sp3*0.45*(0.3 + 0.7*metal);
    col += vec3(0.45, 0.6, 0.85)*d3*fres*0.5;
    col *= mix(0.25, 1.0, ao); // deep grime in the crevices
    col += emiss;

    float edge = mix(-0.55, 0.30, uReveal);
    float above = smoothstep(edge, edge + 0.015, pos.y);
    col = mix(col, bg, above);
    col += vec3(1.0, 0.5, 0.15)*2.0*exp(-pow((pos.y - edge)*120.0, 2.0))*step(uReveal, 0.999);
  }

  float vig = 1.0 - 0.34*pow(length(ndc*vec2(0.72, 0.62)), 2.2);
  col *= vig;
  col += (hash21(frag + fract(uTime)*61.7) - 0.5)*0.025;
  col = pow(max(col, 0.0), vec3(0.4545));
  outColor = vec4(col, 1.0);
}
`;

export class RoninFace {
  static title = 'RONIN';
  static tech = 'HARD-SURFACE RAYMARCH';
  static blurb =
    'An industrial mech head — machine, not android. Separate armor plates with real ' +
    'panel gaps, camera-lens eyes that blink with an iris shutter, mechanical brow ' +
    'plates, a rigid hinged jaw over a voice bar that burns with the audio level. ' +
    'Paint wears off the machined edges — computed from surface curvature.';

  constructor(gl) {
    this.gl = gl;
    const { prog, u } = program(gl, VS, FS, 'ronin');
    this.prog = prog;
    this.u = u;
    this.vao = fullscreenVAO(gl);
  }

  draw(cm) {
    const gl = this.gl, u = this.u;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.prog);
    gl.uniform2f(u.uRes, cm.width, cm.height);
    gl.uniform1f(u.uTime, cm.t);
    gl.uniform1f(u.uReveal, cm.reveal);
    gl.uniform3fv(u.uCamPos, cm.camPos);
    gl.uniform3fv(u.uCamRight, cm.camRight);
    gl.uniform3fv(u.uCamUp, cm.camUp);
    gl.uniform3fv(u.uCamFwd, cm.camFwd);
    gl.uniform2f(u.uTanHalf, cm.tanHalf * cm.aspect, cm.tanHalf);
    gl.uniformMatrix3fv(u.uInvHeadRot, false, cm.invHeadRot);
    gl.uniform3fv(u.uHeadPos, cm.headPos);
    gl.uniform1f(u.uJaw, cm.s.jaw);
    gl.uniform1f(u.uSpread, cm.s.spread);
    gl.uniform1f(u.uBlink, Math.max(0, cm.s.blink)); // own SDF: no widen support
    gl.uniform1f(u.uBrowL, cm.s.browL);
    gl.uniform1f(u.uBrowR, cm.s.browR);
    gl.uniform1f(u.uLevel, cm.s.level);
    gl.uniform3fv(u.uGazeDir, cm.gazeDir);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}
