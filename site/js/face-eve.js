// face-eve.js — EVE: the human-like robot. Uses the refined human head field
// (so every human cue is intact: lips, lids, brows, jaw) but skinned as a
// smooth ivory shell segmented by a STRUCTURED network of panel lines — the
// articulated face plates of an I, Robot-style android. Raymarched.

import { program, fullscreenVAO } from './gl.js';
import { GLSL_COMMON, GLSL_SDF, GLSL_EYE, glslHeader } from './headsdf.js';

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FS = glslHeader() + GLSL_COMMON + GLSL_SDF + GLSL_EYE + /* glsl */ `
uniform vec2 uRes;
uniform float uTime, uReveal;
uniform vec3 uCamPos, uCamRight, uCamUp, uCamFwd;
uniform vec2 uTanHalf;
uniform mat3 uInvHeadRot;
uniform vec3 uHeadPos;
uniform float uJaw, uSpread, uBlink, uBrowL, uBrowR, uLevel;
uniform vec3 uGazeDir;
out vec4 outColor;

vec2 map(vec3 p){
  return sdHead(p, uJaw, uSpread, uBlink, uBrowL, uBrowR);
}

vec3 calcNormal(vec3 p){
  const vec2 e = vec2(0.0006, -0.0006);
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

float band(float dist, float w){
  return smoothstep(w, w*0.30, abs(dist));
}

// THE design: the structured plate-line network across the face.
// Every line is defined in coordinates that cross its surface transversally,
// so they stay hairline-crisp. Returns 0..1 line mask.
float plateLines(vec3 pos){
  vec3 qa = vec3(abs(pos.x), pos.y, pos.z);
  float L = 0.0;
  // center part: forehead, and chin below the lip
  L = max(L, band(pos.x, 0.0016)*smoothstep(0.024, 0.034, pos.y)*smoothstep(0.045, 0.06, pos.z));
  L = max(L, band(pos.x, 0.0016)*smoothstep(-0.086, -0.092, pos.y)*smoothstep(-0.114, -0.108, pos.y)*smoothstep(0.03, 0.045, pos.z));
  // forehead arc, following the brow sweep
  float fa = length(vec2(pos.x, (pos.y - 0.008)*1.15)) - 0.060;
  L = max(L, band(fa, 0.0016)*smoothstep(0.030, 0.038, pos.y)*smoothstep(0.040, 0.052, pos.z));
  // muzzle plate: rounded boundary around the mouth
  float mz = length(vec2(pos.x/1.30, pos.y + 0.074)) - 0.0265;
  L = max(L, band(mz, 0.0018)*smoothstep(0.028, 0.042, pos.z));
  // under-eye plate arcs, hugging the lower lids
  float ue = length(vec2((qa.x - 0.0345)*1.0, (pos.y + 0.004)*1.5)) - 0.0235;
  L = max(L, band(ue, 0.0016)*smoothstep(-0.006, -0.012, pos.y)*smoothstep(0.030, 0.042, pos.z));
  // mandible seam: diagonal along the jaw sides
  float jw = (pos.y + 0.062) - 0.55*pos.z;
  L = max(L, band(jw, 0.0018)*smoothstep(0.026, 0.036, qa.x)*smoothstep(-0.026, -0.036, pos.y));
  // temple arcs
  float ta = length(vec2(pos.y - 0.024, pos.z - 0.020)) - 0.034;
  L = max(L, band(ta, 0.0018)*smoothstep(0.050, 0.058, qa.x));
  return L;
}

vec3 background(vec2 ndc){
  // dark slate studio with a teal breath at the base
  vec3 col = mix(vec3(0.016, 0.020, 0.024), vec3(0.065, 0.075, 0.085),
                 clamp(1.0 - length(ndc*vec2(0.85, 1.0))*0.55, 0.0, 1.0));
  col += vec3(0.06, 0.22, 0.20)*0.35*exp(-pow((ndc.y + 0.95)*2.4, 2.0));
  float r = length(ndc - vec2(0.0, 0.06));
  col += vec3(0.25, 0.6, 0.55)*0.045*exp(-pow((r - 0.64)*11.0, 2.0));
  vec2 cell = floor(ndc*85.0);
  col += vec3(0.5, 0.9, 0.85)*step(0.998, hash21(cell))*pow(hash21(cell + 5.0), 2.0)*0.3;
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
    vec3 L1 = normalize(uInvHeadRot*vec3(0.5, 0.6, 0.6));
    vec3 L2 = normalize(uInvHeadRot*vec3(-0.7, 0.05, 0.4));
    vec3 L3 = normalize(uInvHeadRot*vec3(0.1, 0.3, -0.95));

    vec3 albedo; float rough = 0.3, spec = 0.5;
    float lineGlow = 0.0, milky = 0.0;

    if (mat < 0.5 || mat > 5.5) { // ivory shell + graphite crown + plate lines
      vec3 qa = vec3(abs(pos.x), pos.y, pos.z);
      albedo = vec3(0.82, 0.80, 0.775);
      rough = 0.24; spec = 0.6;
      float hm = hairMask(pos);
      float hb = smoothstep(0.44, 0.54, hm);
      albedo = mix(albedo, vec3(0.095, 0.10, 0.115), hb);
      rough = mix(rough, 0.28, hb); spec = mix(spec, 0.8, hb);
      // engraved brow lines that ride the brow-raise
      float brow2 = pos.x < 0.0 ? uBrowL : uBrowR;
      vec3 be = qa - vec3(0.0315, 0.0295 + brow2*0.008, 0.066);
      be.y += abs(qa.x - 0.0315)*0.16 - 0.002;
      float bb = smoothstep(0.0016, 0.0002, sdEll(be, vec3(0.0165, 0.0016, 0.0090)));
      // lid rims
      float eo = length(qa - vec3(EYE_X, -0.001, 0.050));
      float lash = smoothstep(0.0030, 0.0008, abs(eo - 0.0235))*smoothstep(0.035, 0.055, pos.z);
      albedo *= 1.0 - 0.42*lash;
      // temple port: engraved ring + teal status dot
      float pr = length(vec2(pos.y + 0.002, pos.z + 0.018));
      float port = band(pr - 0.0075, 0.0016)*smoothstep(0.056, 0.062, qa.x);
      float dot2 = smoothstep(0.0035, 0.0015, pr)*smoothstep(0.056, 0.062, qa.x);
      // the structured line network
      float lines = max(plateLines(pos), max(bb, port))*(1.0 - hb);
      albedo *= 1.0 - 0.55*lines;
      spec *= 1.0 - 0.5*lines;
      rough = mix(rough, 0.4, lines);
      lineGlow = lines*0.5 + dot2*(1.0 - hb)*2.0;
      milky = (1.0 - hb)*(1.0 - lines);
    } else if (mat < 1.5) { // eyes — teal-lit human eyes
      albedo = shadeEye(pos, uGazeDir, vec3(0.30, 0.70, 0.66), 0.9);
      rough = 0.08; spec = 1.0;
    } else if (mat < 2.5) { // lips — one shade off the shell
      albedo = vec3(0.75, 0.715, 0.705);
      rough = 0.22; spec = 0.55;
      milky = 0.6;
    } else if (mat < 3.5) { // mouth interior
      albedo = vec3(0.05, 0.05, 0.055);
      rough = 0.5; spec = 0.2;
    } else if (mat < 4.5) { // teeth
      albedo = vec3(0.70, 0.70, 0.68);
      rough = 0.15; spec = 0.8;
    } else { // suit
      albedo = vec3(0.040, 0.045, 0.050);
      albedo *= 0.85 + 0.3*vnoise(pos*220.0);
      rough = 0.8; spec = 0.12;
    }

    float sh = mix(0.35, 1.0, softShadow(pos + n*0.004, L1));
    float d1 = pow(clamp(dot(n, L1)*0.6 + 0.4, 0.0, 1.0), 1.3)*sh;
    float d2 = clamp(dot(n, L2)*0.5 + 0.5, 0.0, 1.0);
    float d3 = clamp(dot(n, L3), 0.0, 1.0);
    vec3 h1 = normalize(L1 + v);
    float sp1 = pow(clamp(dot(n, h1), 0.0, 1.0), mix(240.0, 26.0, rough))*sh;
    vec3 h3 = normalize(L3 + v);
    float sp3 = pow(clamp(dot(n, h3), 0.0, 1.0), 70.0);
    float fres = pow(clamp(1.0 + dot(n, rl), 0.0, 1.0), 3.0);

    col = albedo*(vec3(1.06, 1.0, 0.95)*1.15*d1 + vec3(0.30, 0.38, 0.46)*0.6*d2 + vec3(0.14, 0.15, 0.17));
    col += vec3(1.0, 0.97, 0.9)*sp1*spec*1.25;
    col += vec3(0.5, 0.8, 0.85)*sp3*spec*0.5;
    col += vec3(0.45, 0.75, 0.75)*d3*fres*0.5;
    col *= mix(0.35, 1.0, ao);
    col += vec3(0.85, 0.92, 0.95)*milky*(fres*0.15 + 0.045)*mix(0.5, 1.0, ao);
    col += vec3(0.25, 0.85, 0.75)*lineGlow*(0.10 + 0.55*uLevel);

    float edge = mix(-0.55, 0.30, uReveal);
    float above = smoothstep(edge, edge + 0.015, pos.y);
    col = mix(col, bg, above);
    col += vec3(0.4, 1.0, 0.9)*2.0*exp(-pow((pos.y - edge)*120.0, 2.0))*step(uReveal, 0.999);
  }

  float vig = 1.0 - 0.32*pow(length(ndc*vec2(0.72, 0.62)), 2.2);
  col *= vig;
  col += (hash21(frag + fract(uTime)*61.7) - 0.5)*0.022;
  col = pow(max(col, 0.0), vec3(0.4545));
  outColor = vec4(col, 1.0);
}
`;

export class EveFace {
  static title = 'EVE';
  static tech = 'PANELED SHELL · RAYMARCH';
  static CAM = { dist: 0.60, targetY: -0.012 };
  static blurb =
    'The human-like one: the full human head field — lips, lids, brows, jaw all ' +
    'articulate — skinned as a smooth ivory shell segmented by a structured network ' +
    'of plate lines: muzzle plate, under-eye plates, temple arcs, a mandible seam. ' +
    'The lines breathe teal when she speaks.';

  constructor(gl) {
    this.gl = gl;
    const { prog, u } = program(gl, VS, FS, 'eve');
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
    gl.uniform1f(u.uBlink, cm.s.blink);
    gl.uniform1f(u.uBrowL, cm.s.browL);
    gl.uniform1f(u.uBrowR, cm.s.browR);
    gl.uniform1f(u.uLevel, cm.s.level);
    if (u.uPupil) gl.uniform1f(u.uPupil, cm.s.pupil || 1);
    gl.uniform3fv(u.uGazeDir, cm.gazeDir);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}
