// face-mesh.js — VESSEL: technique 3, classic polygon rasterization.
// The SDF was sampled once on the GPU, triangulated with Surface Nets (~30k
// verts) and is now rendered as an indexed mesh with GGX-style shading. A
// faint wireframe overlay shows the triangles for what they are.

import { program } from './gl.js';
import { GLSL_COMMON, GLSL_SDF, GLSL_EYE, glslHeader } from './headsdf.js';

const MESH_VS = glslHeader() + GLSL_COMMON + GLSL_SDF + /* glsl */ `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in float aMat;

uniform mat4 uProj, uView;
uniform mat3 uHeadRot;
uniform vec3 uHeadPos;
uniform float uJaw, uSpread, uBlink, uBrowL, uBrowR;
uniform float uLineOffset;

out vec3 vPosN;   // neutral head-local (for procedural detail + eyes)
out vec3 vWorld;
out vec3 vNrm;
flat out float vMat;

void main(){
  vec3 p = headWarpFwd(aPos, uJaw, uSpread, uBlink, uBrowL, uBrowR);
  vec3 n = aNrm;
  // rotate the normal with the jaw so lighting tracks the chin
  float ang = -jawMask(aPos)*(uJaw - NEUTRAL_JAW)*0.22;
  float c = cos(ang), s = sin(ang);
  n.yz = mat2(c, -s, s, c)*n.yz;

  p += aNrm*uLineOffset; // wireframe pass floats just off the surface
  vec3 world = uHeadRot*p + uHeadPos;
  vPosN = aPos;
  vWorld = world;
  vNrm = uHeadRot*n;
  vMat = aMat;
  gl_Position = uProj*uView*vec4(world, 1.0);
}
`;

const MESH_FS = glslHeader() + GLSL_COMMON + GLSL_SDF + GLSL_EYE + /* glsl */ `
in vec3 vPosN;
in vec3 vWorld;
in vec3 vNrm;
flat in float vMat;

uniform vec3 uCamPos;
uniform float uTime, uReveal, uLevel;
uniform vec3 uGazeDir;
uniform float uIsLines;
uniform float uBrowLf, uBrowRf;

out vec4 outColor;

float ggx(vec3 n, vec3 v, vec3 l, float rough){
  vec3 h = normalize(v + l);
  float a = rough*rough, a2 = a*a;
  float ndh = clamp(dot(n, h), 0.0, 1.0);
  float den = ndh*ndh*(a2 - 1.0) + 1.0;
  float D = a2/(3.14159*den*den);
  float ndl = clamp(dot(n, l), 0.0, 1.0);
  float ndv = clamp(dot(n, v), 0.0, 1.0) + 1e-4;
  float k = a*0.5;
  float G = (ndl/(ndl*(1.0 - k) + k))*(ndv/(ndv*(1.0 - k) + k));
  return D*G*ndl;
}

void main(){
  // reveal wipe (shared with the line pass)
  float edge = mix(-0.55, 0.30, uReveal);
  if (vPosN.y > edge + 0.012) discard;
  float edgeGlow = exp(-pow((vPosN.y - edge)*110.0, 2.0))*step(uReveal, 0.999);

  if (uIsLines > 0.5) {
    float tw = 0.5 + 0.5*sin(uTime*0.7 + vPosN.y*30.0);
    outColor = vec4(vec3(1.0, 0.62, 0.18)*(0.022 + 0.018*tw + edgeGlow*0.8), 1.0);
    return;
  }

  vec3 n = normalize(vNrm);
  vec3 v = normalize(uCamPos - vWorld);

  vec3 L1 = normalize(vec3(0.6, 0.7, 0.5));
  vec3 L2 = normalize(vec3(-0.75, -0.1, 0.4));
  vec3 L3 = normalize(vec3(0.0, 0.4, -1.0));

  vec3 albedo; float rough = 0.45; float metal = 0.8;
  vec3 emiss = vec3(0.0);

  if (vMat < 0.5 || vMat > 5.5) { // gunmetal shell + analytic hair/brow inlays
    albedo = vec3(0.23, 0.25, 0.285);
    // procedural panel seams: isolines of a slow fbm over the neutral surface
    float f = fbm(vPosN*16.0 + vec3(3.7));
    float seam = smoothstep(0.016, 0.004, abs(f - 0.5));
    albedo *= 1.0 - 0.5*seam;
    emiss += vec3(1.0, 0.5, 0.14)*seam*(0.10 + uLevel*0.5 + 0.06*sin(uTime*2.0 + vPosN.y*18.0));
    // brushed micro-variation
    albedo *= 0.92 + 0.16*vnoise(vPosN*90.0);
    // printed carbon hair cap + brow inlays, blended smoothly (no voxel jaggies)
    float hm = hairMask(vPosN);
    float hb = smoothstep(0.20, 0.65, hm);
    albedo = mix(albedo, vec3(0.05, 0.052, 0.06)*(0.85 + 0.35*vnoise(vPosN*260.0)), hb);
    emiss *= 1.0 - hb;
    float brow2 = vPosN.x < 0.0 ? uBrowLf : uBrowRf;
    vec3 qa = vec3(abs(vPosN.x), vPosN.y, vPosN.z);
    vec3 be = qa - vec3(0.0315, 0.0295 + brow2*0.008, 0.066);
    be.y += abs(qa.x - 0.0315)*0.16 - 0.002;
    float bb = smoothstep(0.0026, 0.0002, sdEll(be, vec3(0.0170, 0.0052, 0.0090)));
    albedo = mix(albedo, vec3(0.04, 0.038, 0.042), bb);
    metal = mix(0.8, 0.35, max(hb, bb));
  } else if (vMat < 1.5) { // eyes: dark sclera, hot amber iris (android optics)
    albedo = shadeEye(vPosN, uGazeDir, vec3(1.0, 0.55, 0.15), 1.0);
    float mx = max(albedo.r, max(albedo.g, albedo.b));
    float sat = (mx - min(albedo.r, min(albedo.g, albedo.b)))/max(mx, 1e-3);
    albedo *= mix(0.22, 1.1, smoothstep(0.15, 0.5, sat));
    emiss = albedo*0.6;
    rough = 0.12; metal = 0.0;
  } else if (vMat < 2.5) { // lips: dark elastomer
    albedo = vec3(0.16, 0.14, 0.15);
    rough = 0.35; metal = 0.2;
  } else if (vMat < 3.5) { // cavity
    albedo = vec3(0.03, 0.015, 0.015);
    emiss = vec3(1.0, 0.35, 0.1)*0.25*uLevel;
    rough = 0.7; metal = 0.0;
  } else if (vMat < 4.5) { // teeth
    albedo = vec3(0.55, 0.56, 0.55);
    rough = 0.25; metal = 0.4;
  } else { // suit
    albedo = vec3(0.05, 0.05, 0.055);
    rough = 0.6; metal = 0.3;
    float ring = smoothstep(0.006, 0.002, abs(vPosN.y + 0.225));
    emiss += vec3(1.0, 0.55, 0.15)*ring*0.5;
  }

  float d1 = clamp(dot(n, L1), 0.0, 1.0);
  float d2 = clamp(dot(n, L2), 0.0, 1.0);
  vec3 diffuse = albedo*(vec3(1.0, 0.93, 0.85)*1.15*d1 + vec3(0.25, 0.32, 0.45)*0.6*d2 + vec3(0.10, 0.11, 0.13));
  vec3 specCol = mix(vec3(0.04), albedo, metal);
  vec3 spec = specCol*(ggx(n, v, L1, rough)*vec3(1.0, 0.95, 0.85)*2.2 +
                       ggx(n, v, L3, rough*0.7)*vec3(0.6, 0.75, 1.0)*1.2);
  float fres = pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 3.5);
  vec3 rim = vec3(1.0, 0.55, 0.2)*fres*clamp(dot(n, L3)*0.5 + 0.5, 0.0, 1.0)*0.6;

  vec3 col = diffuse*(1.0 - metal*0.6) + spec + rim + emiss;
  col += vec3(1.0, 0.7, 0.3)*edgeGlow*2.0;

  col = pow(max(col, 0.0), vec3(0.4545));
  outColor = vec4(col, 1.0);
}
`;

const BG_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vNdc;
void main(){ vNdc = aPos; gl_Position = vec4(aPos, 0.999, 1.0); }
`;

const BG_FS = glslHeader() + GLSL_COMMON + /* glsl */ `
in vec2 vNdc;
uniform vec2 uRes;
uniform float uTime;
out vec4 outColor;
void main(){
  vec2 ndc = vNdc*vec2(uRes.x/uRes.y, 1.0);
  float g = clamp(1.0 - length(ndc - vec2(0.0, 0.15))*0.62, 0.0, 1.0);
  vec3 col = mix(vec3(0.010, 0.009, 0.011), vec3(0.055, 0.045, 0.040), g);
  // overhead shaft
  col += vec3(0.30, 0.22, 0.12)*exp(-pow(ndc.x*2.4, 2.0))*clamp(vNdc.y*0.5 + 0.5, 0.0, 1.0)*0.35;
  // faint blueprint grid
  vec2 gp = abs(fract(ndc*6.0) - 0.5);
  col += vec3(0.5, 0.35, 0.15)*0.018*smoothstep(0.48, 0.5, max(gp.x, gp.y));
  float vig = 1.0 - 0.38*pow(length(vNdc*vec2(0.75, 0.68)), 2.0);
  col *= vig;
  col += (hash21(gl_FragCoord.xy + fract(uTime)*17.0) - 0.5)*0.02;
  col = pow(max(col, 0.0), vec3(0.4545));
  outColor = vec4(col, 1.0);
}
`;

function buildEdges(indices) {
  const set = new Set();
  const edges = [];
  for (let i = 0; i < indices.length; i += 3) {
    const t = [indices[i], indices[i + 1], indices[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = t[e], b = t[(e + 1) % 3];
      const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      if (!set.has(key)) { set.add(key); edges.push(a, b); }
    }
  }
  return new Uint32Array(edges);
}

export class VesselFace {
  static title = 'VESSEL';
  static tech = 'SURFACE-NET MESH';
  static CAM = { dist: 0.62, targetY: -0.012 };
  static blurb =
    'The distance field was sampled once into a 160×208×120 grid on the GPU, ' +
    'triangulated with Surface Nets into ~138k triangles, and is now rendered the classic ' +
    'way: an indexed mesh, GGX speculars, emissive seams — and its wireframe, faintly visible.';

  constructor(gl, assets) {
    this.gl = gl;
    const bg = program(gl, BG_VS, BG_FS, 'vessel.bg');
    this.bgProg = bg.prog; this.bgU = bg.u;
    const bgVao = gl.createVertexArray();
    gl.bindVertexArray(bgVao);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.bgVao = bgVao;

    const m = program(gl, MESH_VS, MESH_FS, 'vessel.mesh');
    this.prog = m.prog; this.u = m.u;

    const { positions, normals, mats, indices } = assets.mesh;
    this.indexCount = indices.length;
    const upload = data => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return b;
    };
    const bufs = [[upload(positions), 3], [upload(normals), 3], [upload(mats), 1]];
    const makeVao = elemData => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      bufs.forEach(([b, size], loc) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      });
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, elemData, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return vao;
    };
    this.vao = makeVao(indices);
    const edges = buildEdges(indices);
    this.edgeCount = edges.length;
    this.edgeVao = makeVao(edges); // wireframe shares vertex buffers, own index buffer
  }

  _setAnim(cm) {
    const gl = this.gl, u = this.u;
    gl.uniformMatrix4fv(u.uProj, false, cm.proj);
    gl.uniformMatrix4fv(u.uView, false, cm.view);
    gl.uniformMatrix3fv(u.uHeadRot, false, cm.headRot);
    gl.uniform3fv(u.uHeadPos, cm.headPos);
    gl.uniform3fv(u.uCamPos, cm.camPos);
    gl.uniform1f(u.uTime, cm.t);
    gl.uniform1f(u.uReveal, cm.reveal);
    gl.uniform1f(u.uJaw, cm.s.jaw);
    gl.uniform1f(u.uSpread, cm.s.spread);
    gl.uniform1f(u.uBlink, cm.s.blink);
    gl.uniform1f(u.uBrowL, cm.s.browL);
    gl.uniform1f(u.uBrowR, cm.s.browR);
    gl.uniform1f(u.uBrowLf, cm.s.browL);
    gl.uniform1f(u.uBrowRf, cm.s.browR);
    gl.uniform1f(u.uLevel, cm.s.level);
    if (u.uPupil) gl.uniform1f(u.uPupil, cm.s.pupil || 1);
    gl.uniform3fv(u.uGazeDir, cm.gazeDir);
  }

  draw(cm) {
    const gl = this.gl;
    gl.useProgram(this.bgProg);
    gl.disable(gl.DEPTH_TEST);
    gl.uniform2f(this.bgU.uRes, cm.width, cm.height);
    gl.uniform1f(this.bgU.uTime, cm.t);
    gl.bindVertexArray(this.bgVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE); // surface-nets winding is not guaranteed; normals are
    gl.useProgram(this.prog);
    this._setAnim(cm);
    gl.uniform1f(this.u.uIsLines, 0);
    gl.uniform1f(this.u.uLineOffset, 0);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.uniform1f(this.u.uIsLines, 1);
    gl.uniform1f(this.u.uLineOffset, 0.0006);
    gl.bindVertexArray(this.edgeVao);
    gl.drawElements(gl.LINES, this.edgeCount, gl.UNSIGNED_INT, 0);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}
