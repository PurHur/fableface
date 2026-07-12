// face-ns5.js — SONNY: a dedicated head, built as an homage to the NS-5 from
// I, Robot (2004). Not the shared human head: its own SDF, sculpted for the
// movie look — milky translucent face plate, a see-through rear cranium with
// the mechanism showing beneath, dished ear sensors, segmented cable neck.
// Rendered by pure raymarching; animated by the same PresenceDriver.

import { program, fullscreenVAO } from './gl.js';
import { GLSL_COMMON, GLSL_SDF, glslHeader } from './headsdf.js';

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Local materials
const FS = glslHeader(`
#define N_PLATE 0.0
#define N_EYE 1.0
#define N_LIPS 2.0
#define N_CAVITY 3.0
#define N_SHELL 5.0
#define N_MECH 6.0
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

// plate (0) vs translucent shell (1) split for THIS head
float shellMaskN(vec3 p){
  float f = p.z - 0.40*abs(p.x)
          - 0.85*max(0.0, p.y - 0.062)
          - 1.20*max(0.0, -(p.y + 0.100));
  return 1.0 - smoothstep(0.006, 0.014, f);
}

// ---- the NS-5 head ----
vec2 sdNs5(vec3 p, float jaw, float spread, float blink, float browL, float browR){
  vec3 pj = jawWarpInv(p, jaw);
  vec3 q  = vec3(abs(p.x), p.y, p.z);
  vec3 qj = vec3(abs(pj.x), pj.y, pj.z);

  // narrow smooth ovoid skull
  float d = sdEll(p - vec3(0.0, 0.022, -0.020), vec3(0.066, 0.085, 0.088));
  d = smin(d, sdEll(pj - vec3(0.0, -0.032, 0.010), vec3(0.056, 0.054, 0.060)), 0.040);
  d = smin(d, sdSphere(pj - vec3(0.0, -0.078, 0.042), 0.019), 0.020);
  d = smin(d, sdSphere(qj - vec3(0.034, -0.048, 0.004), 0.020), 0.022);
  // shallow brow + forehead
  float brow = p.x < 0.0 ? browL : browR;
  d = smin(d, sdEll(q - vec3(0.026, 0.028 + brow*0.008, 0.056), vec3(0.028, 0.0075, 0.012)), 0.020);
  d = smin(d, sdEll(p - vec3(0.0, 0.048, 0.020), vec3(0.056, 0.046, 0.042)), 0.028);

  // minimal nose
  float nose = sdCapsule(p, vec3(0.0, 0.008, 0.060), vec3(0.0, -0.030, 0.074), 0.0042);
  nose = smin(nose, sdSphere(p - vec3(0.0, -0.038, 0.077), 0.0062), 0.007);
  d = smin(d, nose, 0.007);
  d = smax(d, -sdSphere(q - vec3(0.0040, -0.047, 0.0725), 0.0024), 0.003);

  // side plane trim + dished ear sensors
  d = smax(d, q.x - 0.0640, 0.020);
  d = smax(d, -sdSphere(q - vec3(0.0685, -0.006, -0.012), 0.010), 0.004);

  // eyes
  vec3 pe = q - vec3(0.031, 0.0, 0.048);
  d = smin(d, length(pe) - 0.0242, 0.010);
  float aperture = mix(0.0060, 0.0012, clamp(blink, 0.0, 1.0));
  float opening = sdEll(pe - vec3(0.0, -0.001 - blink*0.004, 0.015), vec3(0.0150, aperture, 0.013));
  d = smax(d, -opening, 0.004);

  float mat = N_PLATE;

  // thin lips + dark mouth
  vec3 pm = pj - vec3(0.0, -0.066, 0.062);
  pm.x /= (1.0 + 0.14*spread);
  float lipT = clamp(abs(pm.x)/0.019, 0.0, 1.0);
  pm.z += 0.0016*lipT*lipT;
  float upper = sdEll(pm - vec3(0.0, 0.0028 + jaw*0.0040, 0.001), vec3(0.0185, 0.0034, 0.0034));
  float lower = sdEll(pm - vec3(0.0, -0.0044 - jaw*0.0100, -0.001), vec3(0.0165, 0.0040, 0.0040));
  float lips = min(upper, lower);
  if (lips < d) mat = N_LIPS;
  d = smin(d, lips, 0.011);
  float cav = sdEll(pm - vec3(0.0, -0.001 - jaw*0.0030, -0.010),
                    vec3(0.0190, 0.0008 + jaw*0.0150, 0.014 + jaw*0.004));
  float dAfter = smax(d, -cav, 0.002);
  if (dAfter > d + 0.0004) mat = N_CAVITY;
  d = dAfter;

  // eyeballs
  float eye = length(pe) - 0.0230;
  if (eye < d) { d = eye; mat = N_EYE; }

  // mechanical neck: core column + throat cable + side cables
  float mech = sdCapsule(p, vec3(0.0, -0.070, -0.020), vec3(0.0, -0.26, -0.032), 0.026);
  mech = smin(mech, sdCapsule(p, vec3(0.0, -0.088, 0.010), vec3(0.0, -0.23, 0.000), 0.0085), 0.008);
  mech = smin(mech, sdCapsule(q, vec3(0.017, -0.085, -0.004), vec3(0.024, -0.24, -0.014), 0.0075), 0.008);
  if (mech < d) mat = N_MECH;
  d = smin(d, mech, 0.012);

  // shoulders
  float sh = sdEll(p - vec3(0.0, -0.285, -0.038), vec3(0.165, 0.090, 0.080));
  if (sh < d) mat = N_MECH;
  d = smin(d, sh, 0.030);

  // translucent rear shell
  float sm = shellMaskN(p);
  d -= 0.0008*sm;
  if (sm > 0.5 && mat < 0.5) mat = N_SHELL;

  return vec2(d, mat);
}

vec2 map(vec3 p){ return sdNs5(p, uJaw, uSpread, uBlink, uBrowL, uBrowR); }

vec3 calcNormal(vec3 p){
  const vec2 e = vec2(0.0005, -0.0005);
  return normalize(
    e.xyy*map(p + e.xyy).x + e.yyx*map(p + e.yyx).x +
    e.yxy*map(p + e.yxy).x + e.xxx*map(p + e.xxx).x);
}

float calcAO(vec3 p, vec3 n){
  float occ = 0.0, sca = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = 0.004 + 0.012*float(i);
    occ += (h - map(p + n*h).x)*sca;
    sca *= 0.72;
  }
  return clamp(1.0 - 2.6*occ, 0.0, 1.0);
}

float softShadow(vec3 ro, vec3 rd){
  float res = 1.0, t = 0.008;
  for (int i = 0; i < 12; i++) {
    float h = map(ro + rd*t).x;
    res = min(res, 11.0*h/t);
    t += clamp(h, 0.004, 0.05);
    if (res < 0.02 || t > 0.6) break;
  }
  return clamp(res, 0.0, 1.0);
}

// Sonny's pale-blue LED eyes (this head's own eye centers)
vec3 shadeEyeN(vec3 pos, vec3 gazeDir){
  vec3 eyeC = vec3(0.031*sign(pos.x), 0.0, 0.048);
  vec3 dir = normalize(pos - eyeC);
  vec3 gd = normalize(gazeDir + vec3(-sign(pos.x)*0.04, 0.0, 0.0));
  float ang = acos(clamp(dot(dir, gd), -1.0, 1.0));
  vec3 col = vec3(0.85, 0.87, 0.90);
  col *= 1.0 - 0.35*smoothstep(0.5, 1.1, ang);
  float irisA = 0.30, pupilA = 0.10;
  if (ang < irisA) {
    float t = ang/irisA;
    vec3 tangent = normalize(dir - gd*dot(dir, gd) + 1e-5);
    float spokes = fbm(vec3(atan(tangent.y, tangent.x)*4.0, t*10.0, 2.3));
    vec3 iris = vec3(0.55, 0.72, 0.88)*(0.5 + 0.7*spokes)*(1.1 - 0.6*t);
    iris *= 1.0 - 0.8*smoothstep(0.75, 1.0, t);
    iris += vec3(0.4, 0.75, 1.0)*1.1*exp(-pow((t - 0.45)*7.0, 2.0)); // LED ring
    col = iris;
  }
  if (ang < pupilA) col = mix(col, vec3(0.02, 0.03, 0.05), smoothstep(pupilA, pupilA*0.7, ang));
  return col;
}

vec3 background(vec2 ndc){
  // bright USR-showroom void
  float g = 1.0 - length(ndc*vec2(0.8, 0.95))*0.5;
  vec3 col = mix(vec3(0.085, 0.10, 0.12), vec3(0.30, 0.34, 0.40), clamp(g, 0.0, 1.0));
  col += vec3(0.25, 0.30, 0.38)*0.22*exp(-pow((ndc.y + 0.85)*2.2, 2.0)); // floor bounce
  float r = length(ndc - vec2(0.0, 0.05));
  col += vec3(0.35, 0.55, 0.9)*0.05*exp(-pow((r - 0.66)*10.0, 2.0));
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
    t += dm.x*0.85;
    if (t > 1.4) break;
  }

  if (mat >= 0.0) {
    vec3 n = calcNormal(pos);
    vec3 v = -rl;
    float ao = calcAO(pos, n);
    vec3 L1 = normalize(uInvHeadRot*vec3(0.45, 0.6, 0.66));
    vec3 L2 = normalize(uInvHeadRot*vec3(-0.7, 0.05, 0.4));
    vec3 L3 = normalize(uInvHeadRot*vec3(0.1, 0.3, -0.95));

    vec3 albedo; float rough = 0.3, spec = 0.5;
    float seamGlow = 0.0, milky = 0.0, innerGlow = 0.0;

    if (mat < 0.5) { // face plate — milky acrylic
      albedo = vec3(0.89, 0.90, 0.915);
      rough = 0.22; spec = 0.6;
      vec3 qa = vec3(abs(pos.x), pos.y, pos.z);
      float eo = length(qa - vec3(0.031, -0.001, 0.048));
      float lash = smoothstep(0.0028, 0.0008, abs(eo - 0.0225))*smoothstep(0.03, 0.05, pos.z);
      albedo *= 1.0 - 0.4*lash;
      // plate boundary seam
      float f = pos.z - 0.40*abs(pos.x) - 0.85*max(0.0, pos.y - 0.062) - 1.20*max(0.0, -(pos.y + 0.100));
      float seam = smoothstep(0.0035, 0.0012, abs(f - 0.010));
      albedo *= 1.0 - 0.5*seam;
      seamGlow = seam*0.7;
      milky = 1.0 - seam;
    } else if (mat < 1.5) { // eye
      albedo = shadeEyeN(pos, uGazeDir);
      rough = 0.08; spec = 1.0;
    } else if (mat < 2.5) { // lips — plate material, sculpted
      albedo = vec3(0.80, 0.80, 0.82);
      rough = 0.2; spec = 0.6;
      milky = 0.7;
    } else if (mat < 3.5) { // mouth interior
      albedo = vec3(0.03, 0.035, 0.045);
      rough = 0.6; spec = 0.15;
    } else if (mat < 5.5) { // translucent rear shell: mechanism shows through
      float fresT = pow(clamp(1.0 + dot(n, rl), 0.0, 1.0), 2.0);
      // parallax peek inside: fine mechanical strata + blue running lights
      vec3 pin = pos + rl*0.012;
      float strata = smoothstep(0.35, 0.9, vnoise(pin*vec3(90.0, 260.0, 90.0)));
      float circuits = smoothstep(0.75, 0.95, vnoise(pin*vec3(340.0, 40.0, 340.0)));
      vec3 inner = vec3(0.045, 0.055, 0.07) + vec3(0.10, 0.13, 0.17)*strata;
      inner += vec3(0.15, 0.5, 0.95)*circuits*(0.5 + 0.5*sin(uTime*2.0 + pin.y*40.0))*0.8;
      float opacity = mix(0.30, 0.85, fresT);
      albedo = mix(inner, vec3(0.55, 0.585, 0.63), opacity);
      innerGlow = circuits*(1.0 - opacity)*0.6;
      rough = 0.18; spec = 0.7;
    } else { // neck mechanism + shoulders — dark alloy, segment bands
      albedo = vec3(0.13, 0.14, 0.16);
      float band = smoothstep(0.35, 0.9, abs(sin(pos.y*260.0)));
      albedo *= 0.86 + 0.18*band;
      rough = 0.35; spec = 0.6;
      // blue service light in the throat
      float throatGlow = exp(-dot(pos.xz - vec2(0.0, 0.008), pos.xz - vec2(0.0, 0.008))*2200.0)
                        *smoothstep(-0.20, -0.12, pos.y)*smoothstep(-0.09, -0.13, pos.y);
      seamGlow += throatGlow*1.2;
    }

    float sh = mix(0.4, 1.0, softShadow(pos + n*0.004, L1));
    float d1 = pow(clamp(dot(n, L1)*0.6 + 0.4, 0.0, 1.0), 1.3)*sh;
    float d2 = clamp(dot(n, L2)*0.5 + 0.5, 0.0, 1.0);
    float d3 = clamp(dot(n, L3), 0.0, 1.0);
    vec3 h1 = normalize(L1 + v);
    float sp1 = pow(clamp(dot(n, h1), 0.0, 1.0), mix(240.0, 30.0, rough))*sh;
    vec3 h3 = normalize(L3 + v);
    float sp3 = pow(clamp(dot(n, h3), 0.0, 1.0), 70.0);
    float fres = pow(clamp(1.0 + dot(n, rl), 0.0, 1.0), 3.0);

    col = albedo*(vec3(1.05, 1.0, 0.96)*1.2*d1 + vec3(0.32, 0.38, 0.5)*0.7*d2 + vec3(0.16, 0.17, 0.20));
    col += vec3(1.0, 0.98, 0.92)*sp1*spec*1.3;
    col += vec3(0.55, 0.7, 1.0)*sp3*spec*0.5;
    col += vec3(0.55, 0.7, 0.95)*d3*fres*0.5;
    col *= mix(0.4, 1.0, ao);
    col += vec3(0.80, 0.88, 1.0)*milky*(fres*0.18 + 0.05)*mix(0.5, 1.0, ao);
    col += vec3(0.3, 0.65, 1.0)*innerGlow;
    col += vec3(0.3, 0.75, 1.0)*seamGlow*(0.10 + 0.6*uLevel);

    // reveal wipe
    float edge = mix(-0.55, 0.30, uReveal);
    float above = smoothstep(edge, edge + 0.015, pos.y);
    col = mix(col, bg, above);
    col += vec3(0.4, 0.8, 1.0)*2.0*exp(-pow((pos.y - edge)*120.0, 2.0))*step(uReveal, 0.999);
  }

  float vig = 1.0 - 0.30*pow(length(ndc*vec2(0.72, 0.62)), 2.2);
  col *= vig;
  col += (hash21(frag + fract(uTime)*61.7) - 0.5)*0.02;
  col = pow(max(col, 0.0), vec3(0.4545));
  outColor = vec4(col, 1.0);
}
`;

export class SonnyFace {
  static title = 'SONNY';
  static tech = 'NS-5 TRIBUTE · RAYMARCH';
  static blurb =
    'A second, purpose-built head: an homage to the NS-5 of I, Robot (2004). ' +
    'Milky acrylic face plate, a translucent rear cranium with the mechanism ' +
    'showing through, dished ear sensors and a segmented cable neck — all one ' +
    'analytic distance field, no triangles.';

  constructor(gl) {
    this.gl = gl;
    const { prog, u } = program(gl, VS, FS, 'sonny');
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
