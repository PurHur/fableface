// gridmesh.js — evaluate the head SDF on the GPU over a 3D grid, read it back,
// triangulate with naive Surface Nets, and sample surface points for particles.
// This guarantees the mesh/particle head is EXACTLY the raymarched head.

import { program, fullscreenVAO } from './gl.js';
import { GRID, NEUTRAL, GLSL_COMMON, GLSL_SDF, glslHeader } from './headsdf.js';

const DIST_RANGE = 0.3; // distances encoded over [-0.15, +0.15]

const EVAL_VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const EVAL_FS = glslHeader() + GLSL_COMMON + GLSL_SDF + /* glsl */ `
uniform vec3 uGridMin, uGridMax;
uniform vec3 uGridN;      // nx, ny, nz
uniform vec2 uTiles;      // tilesX, tilesY
out vec4 outColor;
void main(){
  vec2 px = floor(gl_FragCoord.xy);
  float tx = floor(px.x / uGridN.x);
  float ty = floor(px.y / uGridN.y);
  float slice = ty*uTiles.x + tx;
  if (slice >= uGridN.z) { outColor = vec4(1.0, 1.0, 0.0, 1.0); return; }
  vec3 g = vec3(px.x - tx*uGridN.x, px.y - ty*uGridN.y, slice);
  vec3 p = uGridMin + g/(uGridN - 1.0)*(uGridMax - uGridMin);
  vec2 dm = sdHead(p, ${NEUTRAL.jaw.toFixed(3)}, ${NEUTRAL.spread.toFixed(3)}, ${NEUTRAL.blink.toFixed(3)}, 0.0, 0.0);
  float dn = clamp(dm.x/${DIST_RANGE.toFixed(2)} + 0.5, 0.0, 1.0);
  float v = floor(dn*65535.0 + 0.5);
  float hi = floor(v/256.0);
  float lo = v - hi*256.0;
  outColor = vec4(hi/255.0, lo/255.0, dm.y/8.0, 1.0);
}
`;

export function evalFieldGPU(gl) {
  const { nx, ny, nz, tilesX, tilesY } = GRID;
  const W = nx * tilesX, H = ny * tilesY;

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  const { prog, u } = program(gl, EVAL_VS, EVAL_FS, 'fieldEval');
  const vao = fullscreenVAO(gl);
  gl.useProgram(prog);
  gl.uniform3f(u.uGridMin, ...GRID.min);
  gl.uniform3f(u.uGridMax, ...GRID.max);
  gl.uniform3f(u.uGridN, nx, ny, nz);
  gl.uniform2f(u.uTiles, tilesX, tilesY);
  gl.viewport(0, 0, W, H);
  gl.disable(gl.DEPTH_TEST);
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  const pixels = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindVertexArray(null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  gl.deleteProgram(prog);

  // Unpack atlas -> flat grids
  const n = nx * ny * nz;
  const dist = new Float32Array(n);
  const mats = new Uint8Array(n);
  for (let z = 0; z < nz; z++) {
    const tx = z % tilesX, ty = (z / tilesX) | 0;
    for (let y = 0; y < ny; y++) {
      const rowPx = ((ty * ny + y) * W + tx * nx) * 4;
      const rowOut = nx * (y + ny * z);
      for (let x = 0; x < nx; x++) {
        const px = rowPx + x * 4;
        const v = pixels[px] * 256 + pixels[px + 1];
        dist[rowOut + x] = (v / 65535 - 0.5) * DIST_RANGE;
        mats[rowOut + x] = Math.round(pixels[px + 2] / 255 * 8);
      }
    }
  }
  return { dist, mats };
}

// Naive Surface Nets over the sampled field.
export function surfaceNets(dist, mats) {
  const { nx, ny, nz, min, max } = GRID;
  const sx = (max[0] - min[0]) / (nx - 1);
  const sy = (max[1] - min[1]) / (ny - 1);
  const sz = (max[2] - min[2]) / (nz - 1);
  const gi = (x, y, z) => x + nx * (y + ny * z);

  const cnx = nx - 1, cny = ny - 1, cnz = nz - 1;
  const cellVert = new Int32Array(cnx * cny * cnz).fill(-1);
  const ci = (x, y, z) => x + cnx * (y + cny * z);

  const positions = [];
  const vmats = [];

  // 12 cube edges as corner-index pairs (corner = bit x|y<<1|z<<2)
  const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const cd = new Float32Array(8);

  for (let z = 0; z < cnz; z++) {
    for (let y = 0; y < cny; y++) {
      for (let x = 0; x < cnx; x++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const d = dist[gi(x + (c & 1), y + ((c >> 1) & 1), z + ((c >> 2) & 1))];
          cd[c] = d;
          if (d < 0) inside |= 1 << c;
        }
        if (inside === 0 || inside === 255) continue;

        let px = 0, py = 0, pz = 0, cnt = 0;
        for (const [a, b] of EDGES) {
          const da = cd[a], db = cd[b];
          if ((da < 0) === (db < 0)) continue;
          const t = da / (da - db);
          px += (a & 1) + t * ((b & 1) - (a & 1));
          py += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
          pz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
          cnt++;
        }
        px /= cnt; py /= cnt; pz /= cnt;

        // material: the corner nearest the surface owns it
        let bestC = 0, bestD = Infinity;
        for (let c = 0; c < 8; c++) { const a = Math.abs(cd[c]); if (a < bestD) { bestD = a; bestC = c; } }
        const m = mats[gi(x + (bestC & 1), y + ((bestC >> 1) & 1), z + ((bestC >> 2) & 1))];

        cellVert[ci(x, y, z)] = positions.length / 3;
        positions.push(min[0] + (x + px) * sx, min[1] + (y + py) * sy, min[2] + (z + pz) * sz);
        vmats.push(m);
      }
    }
  }

  // Faces: one quad per surface-crossing grid edge, connecting the 4 cells around it.
  const indices = [];
  const quad = (v0, v1, v2, v3, flip) => {
    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return;
    if (flip) indices.push(v0, v2, v1, v0, v3, v2);
    else indices.push(v0, v1, v2, v0, v2, v3);
  };
  for (let z = 1; z < cnz; z++) {
    for (let y = 1; y < cny; y++) {
      for (let x = 1; x < cnx; x++) {
        const d0 = dist[gi(x, y, z)];
        // x-edge from (x,y,z) to (x+1,y,z)
        if (x < cnx) {
          const d1 = dist[gi(x + 1, y, z)];
          if ((d0 < 0) !== (d1 < 0)) {
            quad(cellVert[ci(x, y - 1, z - 1)], cellVert[ci(x, y, z - 1)],
                 cellVert[ci(x, y, z)], cellVert[ci(x, y - 1, z)], d0 < 0);
          }
        }
        // y-edge
        if (y < cny) {
          const d1 = dist[gi(x, y + 1, z)];
          if ((d0 < 0) !== (d1 < 0)) {
            quad(cellVert[ci(x - 1, y, z - 1)], cellVert[ci(x - 1, y, z)],
                 cellVert[ci(x, y, z)], cellVert[ci(x, y, z - 1)], d0 < 0);
          }
        }
        // z-edge
        if (z < cnz) {
          const d1 = dist[gi(x, y, z + 1)];
          if ((d0 < 0) !== (d1 < 0)) {
            quad(cellVert[ci(x - 1, y - 1, z)], cellVert[ci(x, y - 1, z)],
                 cellVert[ci(x, y, z)], cellVert[ci(x - 1, y, z)], d0 < 0);
          }
        }
      }
    }
  }

  // Normals from the field gradient (trilinear central differences).
  const pos = new Float32Array(positions);
  const nrm = new Float32Array(pos.length);
  const sample = (fx, fy, fz) => {
    const x = Math.min(Math.max(fx, 0), nx - 1.001), y = Math.min(Math.max(fy, 0), ny - 1.001), zc = Math.min(Math.max(fz, 0), nz - 1.001);
    const x0 = x | 0, y0 = y | 0, z0 = zc | 0;
    const tx = x - x0, ty = y - y0, tz = zc - z0;
    let acc = 0;
    for (let c = 0; c < 8; c++) {
      const w = ((c & 1) ? tx : 1 - tx) * (((c >> 1) & 1) ? ty : 1 - ty) * (((c >> 2) & 1) ? tz : 1 - tz);
      acc += w * dist[gi(x0 + (c & 1), y0 + ((c >> 1) & 1), z0 + ((c >> 2) & 1))];
    }
    return acc;
  };
  for (let i = 0; i < pos.length; i += 3) {
    const fx = (pos[i] - min[0]) / sx, fy = (pos[i + 1] - min[1]) / sy, fz = (pos[i + 2] - min[2]) / sz;
    let gx = sample(fx + 1, fy, fz) - sample(fx - 1, fy, fz);
    let gy = sample(fx, fy + 1, fz) - sample(fx, fy - 1, fz);
    let gz = sample(fx, fy, fz + 1) - sample(fx, fy, fz - 1);
    gx /= sx; gy /= sy; gz /= sz;
    const l = Math.hypot(gx, gy, gz) || 1;
    nrm[i] = gx / l; nrm[i + 1] = gy / l; nrm[i + 2] = gz / l;
  }

  return {
    positions: pos,
    normals: nrm,
    mats: new Float32Array(vmats),
    indices: new Uint32Array(indices),
  };
}

// Uniform-area random sampling of the mesh surface -> particle attributes.
export function sampleSurface(mesh, count, rand = mulberry32(1337)) {
  const { positions, normals, mats, indices } = mesh;
  const triCount = indices.length / 3;
  const cum = new Float32Array(triCount);
  let total = 0;
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    total += Math.hypot(cx, cy, cz) * 0.5;
    cum[t] = total;
  }
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const pm = new Float32Array(count);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = rand() * total;
    let lo = 0, hi = triCount - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    const t = lo;
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    let u = rand(), v = rand();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = positions[a + k] * w + positions[b + k] * u + positions[c + k] * v;
      nrm[i * 3 + k] = normals[a + k] * w + normals[b + k] * u + normals[c + k] * v;
    }
    pm[i] = mats[indices[t * 3]];
    seed[i] = rand();
  }
  return { positions: pos, normals: nrm, mats: pm, seeds: seed, count };
}

// Weighted-area sampling: like sampleSurface, but each triangle's probability is
// area × weightFn(centroid, mat). Lets a face spend its particle budget where the
// expression lives (eyes, lips, brows) instead of evenly across the skull.
export function sampleSurfaceWeighted(mesh, count, weightFn, rand = mulberry32(4711)) {
  const { positions, normals, mats, indices } = mesh;
  const triCount = indices.length / 3;
  const cum = new Float32Array(triCount);
  let total = 0;
  const cx3 = [0, 0, 0];
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const crx = uy * vz - uz * vy, cry = uz * vx - ux * vz, crz = ux * vy - uy * vx;
    const area = Math.hypot(crx, cry, crz) * 0.5;
    cx3[0] = (positions[a] + positions[b] + positions[c]) / 3;
    cx3[1] = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3;
    cx3[2] = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    const w = Math.max(0, weightFn ? weightFn(cx3[0], cx3[1], cx3[2], mats[indices[t * 3]]) : 1);
    total += area * w;
    cum[t] = total;
  }
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const pm = new Float32Array(count);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = rand() * total;
    let lo = 0, hi = triCount - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    const t = lo;
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    let u = rand(), v = rand();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = positions[a + k] * w + positions[b + k] * u + positions[c + k] * v;
      nrm[i * 3 + k] = normals[a + k] * w + normals[b + k] * u + normals[c + k] * v;
    }
    pm[i] = mats[indices[t * 3]];
    seed[i] = rand();
  }
  return { positions: pos, normals: nrm, mats: pm, seeds: seed, count };
}

// Feature-line extraction: edges where the (smooth, gradient-derived) vertex
// normals disagree by more than angleDeg, or where the material changes
// (lip↔skin, eye↔skin, brow↔skin). Voxel-mesh stairsteps DON'T trigger this —
// gradient normals are smooth across them; real curvature ridges do.
// Returns sampled points spaced along those edges.
export function extractFeatureEdges(mesh, opts = {}) {
  const { positions, normals, mats, indices } = mesh;
  const angleCos = Math.cos((opts.angleDeg ?? 13) * Math.PI / 180);
  const spacing = opts.spacing ?? 0.0016;
  const maxPoints = opts.maxPoints ?? 16000;
  const minZ = opts.minZ ?? -0.02; // face front only by default
  const seen = new Set();
  const pts = [], nrms = [], pmats = [], params = [];
  let edgeCount = 0;
  const V = positions.length / 3;
  const edge = (a, b) => {
    const key = a < b ? a * V + b : b * V + a;
    if (seen.has(key)) return;
    seen.add(key);
    const az = positions[a * 3 + 2], bz = positions[b * 3 + 2];
    if (az < minZ && bz < minZ) return;
    const matDiff = mats[a] !== mats[b];
    const dot = normals[a * 3] * normals[b * 3] + normals[a * 3 + 1] * normals[b * 3 + 1] + normals[a * 3 + 2] * normals[b * 3 + 2];
    if (!matDiff && dot > angleCos) return;
    // sample along the edge
    const ax = positions[a * 3], ay = positions[a * 3 + 1];
    const bx = positions[b * 3], by = positions[b * 3 + 1];
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const n = Math.max(1, Math.round(len / spacing));
    const phase = (edgeCount++ * 0.6180339) % 1; // per-edge flow offset
    for (let k = 0; k <= n && pts.length / 3 < maxPoints; k++) {
      const t = k / Math.max(1, n);
      params.push(phase + t);
      pts.push(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
      nrms.push(
        normals[a * 3] + (normals[b * 3] - normals[a * 3]) * t,
        normals[a * 3 + 1] + (normals[b * 3 + 1] - normals[a * 3 + 1]) * t,
        normals[a * 3 + 2] + (normals[b * 3 + 2] - normals[a * 3 + 2]) * t);
      pmats.push(matDiff ? Math.max(mats[a], mats[b]) : mats[a]);
    }
  };
  for (let t = 0; t < indices.length; t += 3) {
    edge(indices[t], indices[t + 1]);
    edge(indices[t + 1], indices[t + 2]);
    edge(indices[t + 2], indices[t]);
    if (pts.length / 3 >= maxPoints) break;
  }
  const count = pts.length / 3;
  const seedArr = new Float32Array(count);
  const rand = mulberry32(97);
  for (let i = 0; i < count; i++) seedArr[i] = rand();
  return {
    positions: new Float32Array(pts), normals: new Float32Array(nrms),
    mats: new Float32Array(pmats), seeds: seedArr, count,
    params: new Float32Array(params), // flow parameter along each edge (wisp6 living linework)
  };
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildHeadAssets(gl, particleCount = 90000) {
  const t0 = performance.now();
  const { dist, mats } = evalFieldGPU(gl);
  const t1 = performance.now();
  const mesh = surfaceNets(dist, mats);
  const t2 = performance.now();
  const points = sampleSurface(mesh, particleCount);
  const t3 = performance.now();
  console.log(
    `[fableface] head built: field ${(t1 - t0).toFixed(0)}ms, ` +
    `nets ${(t2 - t1).toFixed(0)}ms (${mesh.positions.length / 3} verts, ${mesh.indices.length / 3} tris), ` +
    `sampling ${(t3 - t2).toFixed(0)}ms (${points.count} pts)`
  );
  return { mesh, points, field: { dist, mats } };
}
