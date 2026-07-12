// holo-bg.js — the HOLO-CHAMBER backdrop, shared by both hologram faces.
// A cinematic sci-fi room instead of a flat gradient: perspective grid floor
// with data pulses racing to the horizon, a rotating multi-ring dais under the
// projection, parallax walls of flickering data columns, sweeping light
// shafts, rare shooting data streaks, drifting parallax dust. Everything is
// tinted by the companion's emotion color (uEmoCol).

import { GLSL_COMMON, glslHeader } from './headsdf.js';

export const HOLO_BG_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vNdc;
void main(){ vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const HOLO_BG_FS = glslHeader() + GLSL_COMMON + /* glsl */ `
in vec2 vNdc;
uniform vec2 uRes;
uniform float uTime, uLevel, uGlow;
uniform vec3 uEmoCol;
out vec4 outColor;

void main(){
  vec2 ndc = vNdc*vec2(uRes.x/uRes.y, 1.0);
  vec3 tint = mix(vec3(0.10, 0.55, 0.75), uEmoCol, 0.55);

  // deep void
  vec3 col = mix(vec3(0.003, 0.007, 0.012), vec3(0.008, 0.022, 0.034),
                 clamp(1.0 - length(ndc)*0.62, 0.0, 1.0));

  float hor = -0.16; // horizon height

  // ---- FLOOR: perspective grid, fogged, with data pulses ----
  if (vNdc.y < hor) {
    float dist = 0.09/(hor - vNdc.y);
    float wx = ndc.x*dist*10.0;
    float wz = dist*10.0 + uTime*0.30;
    float fog = exp(-dist*1.25);
    vec2 g = abs(fract(vec2(wx, wz)) - 0.5);
    float lw = 0.030*(1.0 + dist*1.1);
    float grid = max(smoothstep(lw, lw*0.3, g.x), smoothstep(lw, lw*0.3, g.y));
    col += tint*grid*0.13*fog;
    // major lines every 5 units
    vec2 g5 = abs(fract(vec2(wx, wz)/5.0) - 0.5);
    float grid5 = max(smoothstep(0.013*(1.0 + dist), 0.004, g5.x),
                      smoothstep(0.013*(1.0 + dist), 0.004, g5.y));
    col += tint*grid5*0.11*fog;
    // data pulses racing along random columns toward the horizon
    float colId = floor(wx + 0.5);
    float has = step(0.70, hash11(colId*13.37));
    float pz = fract(wz*0.11 + hash11(colId*7.7)*7.0 - uTime*0.50);
    float pulse = exp(-pow((pz - 0.5)*13.0, 2.0));
    float onLine = smoothstep(lw, 0.0, g.x);
    col += tint*has*onLine*pulse*0.85*fog*(0.7 + uLevel*1.3);
  }
  // horizon glow line
  col += tint*0.15*exp(-pow((vNdc.y - hor)*9.0, 2.0));

  // ---- DATA WALLS: parallax planes of flickering code columns ----
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float depth = 1.0 + fi*0.9;
    vec2 wc = vec2(ndc.x*depth + uTime*0.008*(fi - 1.0), (vNdc.y - hor)*depth);
    vec2 cellSz = vec2(0.030, 0.011);
    float colX = floor(wc.x/cellSz.x);
    float colHas = step(0.80, hash11(colX*3.1 + fi*17.0));
    float scroll = uTime*(0.05 + hash11(colX*9.0)*0.13);
    vec2 id2 = vec2(colX, floor((wc.y + scroll)/cellSz.y));
    float on = step(0.55, hash21(id2 + fi*31.0));
    float flick = 0.6 + 0.4*hash21(id2 + floor(uTime*6.0));
    float fogW = exp(-fi*0.9)*smoothstep(hor, hor + 0.25, vNdc.y);
    col += tint*colHas*on*flick*0.030*fogW;
  }

  // ---- sweeping light shaft ----
  float sx = sin(uTime*0.07)*0.9;
  float shaft = exp(-pow((ndc.x - sx + (vNdc.y - 1.0)*0.35)*2.6, 2.0));
  col += tint*shaft*smoothstep(-0.2, 1.0, vNdc.y)*0.05;

  // ---- projector well, cone, and the rotating multi-ring dais ----
  float dwell = length(vec2(ndc.x*1.6, (vNdc.y + 1.06)*3.2));
  col += tint*0.55*exp(-dwell*dwell*1.8)*(0.9 + uLevel*0.5);
  float cone = exp(-pow(ndc.x/(0.16 + (vNdc.y + 1.0)*0.34), 2.0))*exp(-(vNdc.y + 1.0)*1.15);
  col += tint*cone*0.40;
  vec2 pc = vec2(ndc.x, (vNdc.y + 0.86)*3.4);
  float prad = length(pc);
  float ang = atan(pc.y, pc.x);
  float ring1 = exp(-pow((prad - 0.46)*22.0, 2.0))*(0.10 + 0.22*step(0.82, fract(ang*9.549 + uTime*0.35)));
  float ring2 = exp(-pow((prad - 0.64)*26.0, 2.0))*(0.05 + 0.16*step(0.55, fract(ang*4.775 - uTime*0.22)));
  float ring3 = exp(-pow((prad - 0.30)*30.0, 2.0))*0.12;
  col += tint*(ring1 + ring2 + ring3)*(1.0 + uLevel*1.5 + uGlow*0.4);

  // ---- rare shooting data streak ----
  float sSeed = floor(uTime*0.13);
  if (hash11(sSeed) > 0.45) {
    float sp = fract(uTime*0.13);
    float sy = mix(0.15, 0.75, hash11(sSeed + 3.0));
    float dx = ndc.x - mix(2.2, -2.2, sp);
    float streak = exp(-pow((vNdc.y - sy)*40.0, 2.0))*exp(-abs(dx)*(dx > 0.0 ? 3.0 : 30.0));
    col += vec3(0.7, 0.9, 1.0)*streak*0.45;
  }

  // ---- scanlines + refresh sweep ----
  col *= 0.90 + 0.10*sin(gl_FragCoord.y*1.7 + uTime*3.0);
  col += tint*0.06*exp(-pow((vNdc.y - (fract(uTime*0.06)*2.4 - 1.2))*5.0, 2.0));

  // ---- parallax dust, three depth layers ----
  for (int i = 0; i < 3; i++) {
    float dep = 1.0 + float(i);
    vec2 sc = ndc*(30.0 + float(i)*20.0) + vec2(uTime*(1.2 + float(i)*0.8), float(i)*7.0);
    vec2 cell = floor(sc);
    vec2 fr = fract(sc) - 0.5;
    float star = step(0.994, hash21(cell + float(i)*7.0));
    col += tint*star*exp(-dot(fr, fr)*16.0)*0.12/dep;
  }

  float vig = 1.0 - 0.42*pow(length(vNdc*vec2(0.75, 0.7)), 2.0);
  col *= vig;
  col = pow(max(col, 0.0), vec3(0.4545));
  outColor = vec4(col, 1.0);
}
`;
