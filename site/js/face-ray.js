// face-ray.js — ORACLE: technique 1, pure SDF raymarching.
// The head is never triangulated: every frame the fragment shader sphere-traces
// the analytic distance field, so the animation (jaw, lids, lips) is the SDF
// itself deforming. Porcelain-and-gold android look.

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

vec3 background(vec2 ndc, vec3 rd){
  // deep graphite-blue studio void
  float g = 1.0 - length(ndc*vec2(0.85, 1.0))*0.55;
  vec3 col = mix(vec3(0.012, 0.016, 0.026), vec3(0.045, 0.06, 0.085), clamp(g, 0.0, 1.0));
  // faint nebula wash
  col += vec3(0.05, 0.045, 0.03)*fbm(vec3(ndc*2.2, uTime*0.02))*0.35;
  // halo ring behind the head
  float r = length(ndc - vec2(0.0, 0.08));
  col += vec3(0.75, 0.62, 0.35)*0.055*exp(-pow((r - 0.68)*14.0, 2.0));
  col += vec3(0.75, 0.62, 0.35)*0.020*exp(-pow((r - 0.68)*3.0, 2.0));
  // sparse stars
  vec2 cell = floor(ndc*90.0);
  float star = step(0.9975, hash21(cell))*pow(hash21(cell + 7.0), 2.0);
  col += vec3(star)*0.5;
  return col;
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 ndc = (2.0*frag - uRes)/uRes.y; // y-normalized
  vec3 rd = normalize(uCamRight*ndc.x*uTanHalf.y + uCamUp*ndc.y*uTanHalf.y + uCamFwd);

  // world -> head-local
  vec3 ro = uInvHeadRot*(uCamPos - uHeadPos);
  vec3 rl = uInvHeadRot*rd;

  vec3 bg = background(ndc, rd);
  vec3 col = bg;

  float t = 0.15, mat = -1.0;
  vec3 pos;
  for (int i = 0; i < 110; i++) {
    pos = ro + rl*t;
    vec2 dm = map(pos);
    if (dm.x < 0.0002*t) { mat = dm.y; break; }
    t += dm.x*0.85; // damped: jaw warp makes the field slightly non-metric
    if (t > 1.4) break;
  }

  if (mat >= 0.0) {
    vec3 n = calcNormal(pos);
    vec3 v = -rl;
    float ao = calcAO(pos, n);

    // lights in head-local space (rotated with the world by uInvHeadRot)
    vec3 L1 = normalize(uInvHeadRot*vec3(0.55, 0.55, 0.65)); // warm key
    vec3 L2 = normalize(uInvHeadRot*vec3(-0.7, 0.1, 0.35));  // cool fill
    vec3 L3 = normalize(uInvHeadRot*vec3(0.15, 0.35, -0.9)); // rim

    vec3 albedo; float rough = 0.35, spec = 0.5;
    float seamGlow = 0.0, milky = 0.0;

    if (mat < 0.5 || mat > 5.5) { // NS-5: milky face plate on a silver shell
      vec3 qa = vec3(abs(pos.x), pos.y, pos.z);
      // white translucent face plate (the "iMac plastic")
      albedo = vec3(0.88, 0.895, 0.91);
      rough = 0.24; spec = 0.6;
      // gray mechanical skull shell behind/around it
      float hm = hairMask(pos);
      float hb = smoothstep(0.44, 0.54, hm);
      vec3 shellCol = vec3(0.30, 0.32, 0.355)*(0.92 + 0.16*vnoise(pos*180.0));
      albedo = mix(albedo, shellCol, hb);
      rough = mix(rough, 0.38, hb); spec = mix(spec, 0.7, hb);
      // lid rim: subtle dark inset so the eyes stay graphic
      float eo = length(qa - vec3(EYE_X, -0.001, 0.050));
      float lash = smoothstep(0.0030, 0.0008, abs(eo - 0.0235))*smoothstep(0.035, 0.055, pos.z);
      albedo *= 1.0 - 0.42*lash;
      // ear region: dark sensor pod inset in the shell
      float ep = smoothstep(0.004, -0.001, sdEll(qa - vec3(0.0735, -0.008, -0.014), vec3(0.009, 0.016, 0.013)));
      albedo = mix(albedo, vec3(0.055, 0.062, 0.075), ep);
      rough = mix(rough, 0.15, ep); spec = mix(spec, 0.85, ep);
      // THE seam: the face-plate boundary
      float f = plateField(pos);
      float seam = smoothstep(0.0040, 0.0012, abs(f - 0.013))*(1.0 - ep);
      albedo *= 1.0 - 0.55*seam;
      spec *= 1.0 - 0.6*seam;
      seamGlow = seam*0.6;
      milky = (1.0 - hb)*(1.0 - seam); // the plate is translucent acrylic
    } else if (mat < 1.5) { // EYE — pale Sonny-blue
      albedo = shadeEye(pos, uGazeDir, vec3(0.42, 0.62, 0.82), 0.7);
      rough = 0.08; spec = 1.0;
    } else if (mat < 2.5) { // LIPS — same plate material, shape does the work
      albedo = vec3(0.78, 0.775, 0.79);
      rough = 0.22; spec = 0.6;
    } else if (mat < 3.5) { // CAVITY
      albedo = vec3(0.06, 0.05, 0.055);
      rough = 0.5; spec = 0.2;
    } else if (mat < 4.5) { // TEETH
      albedo = vec3(0.72, 0.71, 0.68);
      rough = 0.15; spec = 0.8;
    } else { // SUIT — dark techwear
      albedo = vec3(0.042, 0.046, 0.055);
      albedo *= 0.85 + 0.3*vnoise(pos*220.0);
      rough = 0.8; spec = 0.12;
    }

    float sh = mix(0.35, 1.0, softShadow(pos + n*0.004, L1)); // lifted, cinematic fill
    // wrap diffuse for a soft subsurface feel
    float d1 = pow(clamp(dot(n, L1)*0.6 + 0.4, 0.0, 1.0), 1.4)*sh;
    float d2 = clamp(dot(n, L2)*0.5 + 0.5, 0.0, 1.0);
    float d3 = clamp(dot(n, L3), 0.0, 1.0);
    vec3 h1 = normalize(L1 + v);
    float sp1 = pow(clamp(dot(n, h1), 0.0, 1.0), mix(220.0, 24.0, rough))*sh;
    vec3 h3 = normalize(L3 + v);
    float sp3 = pow(clamp(dot(n, h3), 0.0, 1.0), 60.0);
    float fres = pow(clamp(1.0 + dot(n, rl), 0.0, 1.0), 3.0);

    col = albedo*(vec3(1.08, 1.0, 0.94)*1.15*d1 + vec3(0.28, 0.36, 0.5)*0.6*d2 + vec3(0.13, 0.14, 0.16));
    col += vec3(1.0, 0.97, 0.9)*sp1*spec*1.25;
    col += vec3(0.5, 0.7, 1.0)*sp3*spec*0.5;
    col += vec3(0.5, 0.68, 0.95)*d3*fres*0.55;      // cool rim — reads synthetic
    col *= mix(0.35, 1.0, ao);
    // milky subsurface: light bleeds through the acrylic at grazing angles
    col += vec3(0.80, 0.88, 1.0)*milky*(fres*0.16 + 0.05)*mix(0.5, 1.0, ao);
    // seams energize with speech
    col += vec3(0.25, 0.8, 1.0)*seamGlow*(0.08 + 0.55*uLevel);

    // materialize wipe (reveal): bottom-up print with a glowing edge
    float edge = mix(-0.55, 0.30, uReveal);
    float above = smoothstep(edge, edge + 0.015, pos.y);
    col = mix(col, bg, above);
    col += vec3(1.0, 0.8, 0.4)*2.2*exp(-pow((pos.y - edge)*120.0, 2.0))*step(uReveal, 0.999);
  }

  // grade: vignette + grain
  float vig = 1.0 - 0.32*pow(length(ndc*vec2(0.72, 0.62)), 2.2);
  col *= vig;
  col += (hash21(frag + fract(uTime)*61.7) - 0.5)*0.025;
  col = pow(max(col, 0.0), vec3(0.4545));
  outColor = vec4(col, 1.0);
}
`;

export class OracleFace {
  static title = 'ORACLE';
  static tech = 'SDF RAYMARCH';
  static CAM = { dist: 0.60, targetY: -0.012 };
  static blurb =
    'No triangles at all. Every pixel sphere-traces an analytic signed distance field; ' +
    'jaw, lids and lips animate by deforming the field itself. Ambient occlusion and ' +
    'soft shadows fall out of the same distance function.';

  constructor(gl) {
    this.gl = gl;
    const { prog, u } = program(gl, VS, FS, 'oracle');
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
