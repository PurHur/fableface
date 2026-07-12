// face-dots.js — WISP: technique 2, GPU particle hologram.
// ~90k points sampled from the head surface (same SDF, sampled via the mesh),
// animated by the forward warp in the vertex shader, drawn additively as soft
// sprites. Classic sci-fi volumetric-projector ghost.

import { program, fullscreenVAO } from './gl.js';
import { GLSL_COMMON, GLSL_SDF, GLSL_EYE, glslHeader } from './headsdf.js';
import { SCENE_BG_VS as HOLO_BG_VS, SCENE_BG_FS as HOLO_BG_FS } from './scenes.js';

const PT_VS = glslHeader() + GLSL_COMMON + GLSL_SDF + GLSL_EYE + /* glsl */ `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in float aMat;
layout(location=3) in float aSeed;

uniform mat4 uProj, uView;
uniform mat3 uHeadRot;
uniform vec3 uHeadPos, uCamPos;
uniform float uTime, uReveal, uPixelScale;
uniform float uJaw, uSpread, uBlink, uBrowL, uBrowR, uLevel;
uniform vec3 uGazeDir;

out vec3 vColor;
out float vFade;

void main(){
  // pose the neutral sample with the shared forward warp
  vec3 p = headWarpFwd(aPos, uJaw, uSpread, uBlink, uBrowL, uBrowR);

  // hologram turbulence: breathes at idle, boils when speaking
  float amp = 0.0012 + uLevel*0.0045;
  vec3 nz = vec3(
    vnoise(aPos*40.0 + vec3(0.0, uTime*0.9, 0.0)),
    vnoise(aPos*40.0 + vec3(7.1, uTime*0.8, 3.0)),
    vnoise(aPos*40.0 + vec3(2.3, 5.9, uTime*0.7))) - 0.5;
  p += aNrm*(nz.x*amp*2.0) + nz*amp;

  // a few percent break free and drift upward as sparks
  float spark = step(0.975, aSeed);
  if (spark > 0.5) {
    float ph = fract(uTime*0.05 + aSeed*17.0);
    vec3 drift = vec3(
      sin(aSeed*231.0 + uTime*0.6)*0.06,
      ph*0.34 - 0.05,
      cos(aSeed*117.0 + uTime*0.5)*0.05);
    p = mix(p, p + drift, 0.85);
  }

  // assembly reveal: fly in from a swirling shell
  vec3 rnd = hash33(vec3(aSeed*911.7, aSeed*133.1, aSeed*77.7))*2.0 - 1.0;
  vec3 shell = normalize(rnd + 1e-4)*(0.40 + aSeed*0.15);
  shell.xz = mat2(cos(uTime + aSeed*9.0), -sin(uTime + aSeed*9.0),
                  sin(uTime + aSeed*9.0),  cos(uTime + aSeed*9.0))*shell.xz;
  float ta = clamp((uReveal - aSeed*0.45)/0.55, 0.0, 1.0);
  ta = ta*ta*(3.0 - 2.0*ta);
  p = mix(shell + vec3(0.0, -0.05, 0.0), p, ta);

  // occasional horizontal glitch slice
  float gseed = hash11(floor(uTime*1.7));
  if (gseed > 0.72) {
    float band = step(abs(p.y - (gseed*2.0 - 1.0)*0.12), 0.012);
    p.x += band*(gseed - 0.85)*0.05;
  }

  // hologram scanlines: the projection is built from horizontal slices.
  // brightness banding + per-slice interlace shimmer.
  float slPhase = p.y*330.0 - uTime*2.2;
  float slice = 0.40 + 0.88*pow(0.5 + 0.5*sin(slPhase), 1.7);
  float bandId = floor(slPhase/6.28318);
  p.x += (hash11(bandId*0.613 + floor(uTime*7.0)*13.7) - 0.5)*0.0010;

  vec3 world = uHeadRot*p + uHeadPos;
  vec4 viewPos = uView*vec4(world, 1.0);
  gl_Position = uProj*viewPos;

  // ---- color ----
  float isEye = step(0.5, aMat)*(1.0 - step(1.5, aMat));
  vec3 base = vec3(0.20, 0.80, 1.00);
  if (aMat > 0.5 && aMat < 1.5) {
    // the eyes carry the gaze; tint the sclera cyan so it doesn't blaze white
    base = shadeEye(aPos, uGazeDir, vec3(0.5, 1.0, 1.0), 1.8)*vec3(0.5, 0.88, 1.05)*1.75;
  } else if (aMat > 1.5 && aMat < 2.5) {
    base = vec3(0.42, 0.62, 1.0);           // lips: shifted hue so the mouth reads
  } else if (aMat > 4.5 && aMat < 5.5) {
    base = vec3(0.10, 0.35, 0.50);          // suit: dim
  } else if (aMat > 5.5 && aMat < 6.5) {
    base = vec3(0.055, 0.30, 0.42)*0.85;    // hair: dark mass, silhouette-defining
  } else if (aMat > 6.5) {
    base = vec3(0.05, 0.24, 0.36)*0.8;      // brows: dark accents
  }
  // chromatic banding: alternating slices drift cyan <-> blue
  float cs = sin(p.y*150.0 + uTime*0.9);
  base *= vec3(1.0 - 0.16*cs, 1.0, 1.0 + 0.13*cs);
  // rim-weighted brightness so the silhouette glows
  vec3 nw = uHeadRot*aNrm;
  float facing = dot(normalize(nw), normalize(uCamPos - world));
  float rim = mix(1.25, 0.55, abs(facing));
  // front-only projection: back-facing particles fade out so the face reads
  // (soft ramp keeps the silhouette rim; free-drifting sparks are exempt)
  float backFade = mix(smoothstep(-0.20, 0.10, facing), 1.0, spark);
  // scan band sweeping up
  float sweep = exp(-pow((p.y - (fract(uTime*0.13)*0.9 - 0.5))*22.0, 2.0));
  // twinkle
  float tw = 0.75 + 0.5*hash11(aSeed*997.0 + floor(uTime*7.0 + aSeed*20.0));

  float amp2 = rim*tw*slice*(1.0 + sweep*1.2)*(0.85 + uLevel*0.5);
  vColor = base*amp2;
  vFade = ta*(spark > 0.5 ? 0.45 : 1.0)*backFade;

  float sz = (spark > 0.5 ? 0.0012 : 0.0016)*(0.8 + 0.6*aSeed);
  sz *= 1.0 + isEye*0.55; // bigger sprites at the eyes so the gaze reads
  gl_PointSize = clamp(sz*uPixelScale/max(-viewPos.z, 0.05), 1.0, 8.0);
}
`;

const PT_FS = `#version 300 es
precision highp float;
in vec3 vColor;
in float vFade;
out vec4 outColor;
void main(){
  vec2 d = gl_PointCoord*2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float a = exp(-r2*3.2);
  outColor = vec4(vColor*a*vFade*0.62, 1.0);
}
`;

export class WispFace {
  static title = 'WISP';
  static tech = 'PARTICLE HOLOGRAM';
  static CAM = { dist: 0.62, targetY: -0.012 };
  static blurb =
    '90,000 GPU point sprites sampled from the same head surface, blended additively ' +
    'like a volumetric projector. The vertex shader re-poses every particle each frame; ' +
    'speech energy boils the cloud, and a few percent escape as sparks.';

  constructor(gl, assets) {
    this.gl = gl;
    this.count = assets.points.count;

    const bg = program(gl, HOLO_BG_VS, HOLO_BG_FS, 'wisp.bg');
    this.bgProg = bg.prog; this.bgU = bg.u;
    this.bgVao = fullscreenVAO(gl);

    const pt = program(gl, PT_VS, PT_FS, 'wisp.pt');
    this.ptProg = pt.prog; this.ptU = pt.u;

    const { positions, normals, mats, seeds } = assets.points;
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
    gl.bindVertexArray(null);
  }

  draw(cm) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.bgProg);
    gl.uniform2f(this.bgU.uRes, cm.width, cm.height);
    gl.uniform1f(this.bgU.uTime, cm.t);
    gl.uniform1f(this.bgU.uLevel, cm.s.level);
    gl.uniform1f(this.bgU.uGlow, 0);
    gl.uniform3f(this.bgU.uEmoCol, 0.20, 0.80, 1.00); // classic WISP stays cyan
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
    if (u.uPupil) gl.uniform1f(u.uPupil, cm.s.pupil || 1);
    gl.uniform3fv(u.uGazeDir, cm.gazeDir);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}
