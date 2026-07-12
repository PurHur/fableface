// scenes.js — 10 complex SCENARIOS: paired backdrop worlds + particle-FX modes,
// selectable at runtime (uScene in one background shader; uFxMode/uFxTint on the
// particle face). Every world stays emotion-tinted via uEmoCol.
//
//  0 CHAMBER   holo-chamber (grid floor, data walls, dais)     · fx standard
//  1 DEEPSPACE starfield + nebula + dying sun                  · fx stardust
//  2 RAINCITY  night city bokeh, rain streaks, neon wet floor  · fx neon split
//  3 VAULT     server-rack corridor, LED matrices              · fx scan raster
//  4 REACTOR   energy well, pulsing containment rings          · fx ember storm
//  5 ABYSS     deep ocean, god-ray caustics, particulate       · fx bioluminesce
//  6 TEMPLE    ancient columns, dust shafts, warm stone        · fx golden dust
//  7 CODE      matrix glyph rain walls                         · fx code rows
//  8 SWEEP     dark volumetric scanner room                    · fx voxon sweep
//  9 AURORA    polar night, aurora curtains, star dome         · fx spectrum flow

import { GLSL_COMMON, glslHeader } from './headsdf.js';

export const SCENES = [
  { key: 'chamber', name: 'CHAMBER', bg: 0, fx: 0, tint: [1, 1, 1], grade: { sat: 1.06, con: 1.07, exp: 0.92, lift: [0, 0.012, 0.022] } },
  { key: 'deepspace', name: 'DEEP SPACE', bg: 1, fx: 1, tint: [0.85, 0.95, 1.15], grade: { sat: 1.12, con: 1.12, exp: 1.0, lift: [0, 0.004, 0.03] } },
  { key: 'raincity', name: 'RAIN CITY', bg: 2, fx: 2, tint: [1.05, 0.75, 1.15], grade: { sat: 1.22, con: 1.12, exp: 0.96, lift: [0.02, 0, 0.04] } },
  { key: 'vault', name: 'VAULT', bg: 3, fx: 3, tint: [0.8, 1.05, 1.05], grade: { sat: 0.9, con: 1.1, exp: 1.0, lift: [0, 0.015, 0.02] } },
  { key: 'reactor', name: 'REACTOR', bg: 4, fx: 4, tint: [1.25, 0.72, 0.45], grade: { sat: 1.16, con: 1.16, exp: 0.98, lift: [0.04, 0.006, 0] } },
  { key: 'abyss', name: 'ABYSS', bg: 5, fx: 5, tint: [0.55, 1.05, 1.0], grade: { sat: 1.06, con: 1.06, exp: 0.95, lift: [0, 0.022, 0.032] } },
  { key: 'temple', name: 'TEMPLE', bg: 6, fx: 6, tint: [1.2, 1.0, 0.62], grade: { sat: 1.12, con: 1.05, exp: 1.0, lift: [0.038, 0.02, 0] } },
  { key: 'code', name: 'CODE', bg: 7, fx: 7, tint: [0.45, 1.25, 0.55], grade: { sat: 1.16, con: 1.22, exp: 0.96, lift: [0, 0.03, 0.006] } },
  { key: 'sweep', name: 'SWEEP', bg: 8, fx: 8, tint: [0.9, 1.05, 1.1], grade: { sat: 0.86, con: 1.12, exp: 0.95, lift: [0.006, 0.012, 0.022] } },
  { key: 'aurora', name: 'AURORA', bg: 9, fx: 9, tint: [0.8, 1.1, 0.95], grade: { sat: 1.16, con: 1.07, exp: 1.0, lift: [0.008, 0.022, 0.028] } },
];

export const SCENE_BG_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vNdc;
void main(){ vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const SCENE_BG_FS = glslHeader() + GLSL_COMMON + /* glsl */ `
in vec2 vNdc;
uniform vec2 uRes;
uniform float uTime, uLevel, uGlow, uScene;
uniform vec3 uEmoCol;
out vec4 outColor;

void main(){
  vec2 ndc = vNdc*vec2(uRes.x/uRes.y, 1.0);
  vec3 tint = mix(vec3(0.10, 0.55, 0.75), uEmoCol, 0.55);
  vec3 col = vec3(0.0);
  int sc = int(uScene + 0.5);

  if (sc == 0) {
    // ================= CHAMBER (the original holo-room) =================
    col = mix(vec3(0.003, 0.007, 0.012), vec3(0.008, 0.022, 0.034),
              clamp(1.0 - length(ndc)*0.62, 0.0, 1.0));
    float hor = -0.16;
    if (vNdc.y < hor) {
      float dist = 0.09/(hor - vNdc.y);
      float wx = ndc.x*dist*10.0;
      float wz = dist*10.0 + uTime*0.30;
      float fog = exp(-dist*1.25);
      vec2 g = abs(fract(vec2(wx, wz)) - 0.5);
      float lw = 0.030*(1.0 + dist*1.1);
      float grid = max(smoothstep(lw, lw*0.3, g.x), smoothstep(lw, lw*0.3, g.y));
      col += tint*grid*0.13*fog;
      vec2 g5 = abs(fract(vec2(wx, wz)/5.0) - 0.5);
      float grid5 = max(smoothstep(0.013*(1.0 + dist), 0.004, g5.x),
                        smoothstep(0.013*(1.0 + dist), 0.004, g5.y));
      col += tint*grid5*0.11*fog;
      float colId = floor(wx + 0.5);
      float has = step(0.70, hash11(colId*13.37));
      float pz = fract(wz*0.11 + hash11(colId*7.7)*7.0 - uTime*0.50);
      float pulse = exp(-pow((pz - 0.5)*13.0, 2.0));
      col += tint*has*smoothstep(lw, 0.0, g.x)*pulse*0.85*fog*(0.7 + uLevel*1.3);
    }
    col += tint*0.15*exp(-pow((vNdc.y - hor)*9.0, 2.0));
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float depth = 1.0 + fi*0.9;
      vec2 wc = vec2(ndc.x*depth + uTime*0.008*(fi - 1.0), (vNdc.y - hor)*depth);
      float colX = floor(wc.x/0.030);
      float colHas = step(0.80, hash11(colX*3.1 + fi*17.0));
      vec2 id2 = vec2(colX, floor((wc.y + uTime*(0.05 + hash11(colX*9.0)*0.13))/0.011));
      float on = step(0.55, hash21(id2 + fi*31.0));
      float flick = 0.6 + 0.4*hash21(id2 + floor(uTime*6.0));
      col += tint*colHas*on*flick*0.030*exp(-fi*0.9)*smoothstep(hor, hor + 0.25, vNdc.y);
    }
    float dwell = length(vec2(ndc.x*1.6, (vNdc.y + 1.06)*3.2));
    col += tint*0.55*exp(-dwell*dwell*1.8)*(0.9 + uLevel*0.5);
    float cone = exp(-pow(ndc.x/(0.16 + (vNdc.y + 1.0)*0.34), 2.0))*exp(-(vNdc.y + 1.0)*1.15);
    col += tint*cone*0.40;
    vec2 pc = vec2(ndc.x, (vNdc.y + 0.86)*3.4);
    float prad = length(pc);
    float ang = atan(pc.y, pc.x);
    float ring1 = exp(-pow((prad - 0.46)*22.0, 2.0))*(0.10 + 0.22*step(0.82, fract(ang*9.549 + uTime*0.35)));
    float ring2 = exp(-pow((prad - 0.64)*26.0, 2.0))*(0.05 + 0.16*step(0.55, fract(ang*4.775 - uTime*0.22)));
    col += tint*(ring1 + ring2 + exp(-pow((prad - 0.30)*30.0, 2.0))*0.12)*(1.0 + uLevel*1.5 + uGlow*0.4);
  } else if (sc == 1) {
    // ================= DEEP SPACE =================
    col = vec3(0.002, 0.003, 0.008);
    // star layers
    for (int i = 0; i < 3; i++) {
      float dep = 1.0 + float(i)*1.4;
      vec2 sp = ndc*(46.0 + float(i)*38.0) + vec2(uTime*0.01*dep, float(i)*29.0);
      vec2 cell = floor(sp);
      vec2 fr = fract(sp) - 0.5;
      float star = step(0.992 - float(i)*0.004, hash21(cell));
      float tw2 = 0.5 + 0.5*sin(uTime*(1.0 + hash21(cell + 7.0)*3.0) + hash21(cell)*40.0);
      col += vec3(0.8, 0.9, 1.0)*star*exp(-dot(fr, fr)*22.0)*(0.25/dep)*tw2;
    }
    // nebula
    float neb = fbm(vec3(ndc*1.4, uTime*0.015));
    float neb2 = fbm(vec3(ndc*2.3 + 5.0, uTime*0.01));
    col += mix(vec3(0.05, 0.02, 0.12), tint*0.35, neb2)*pow(neb, 2.4)*0.85;
    // ringed planet, lower right
    vec2 pl = ndc - vec2(1.05, -0.45);
    float plD = length(pl);
    col = mix(col, vec3(0.05, 0.08, 0.13), smoothstep(0.19, 0.185, plD));
    col += vec3(0.3, 0.5, 0.7)*exp(-pow((plD - 0.185)*40.0, 2.0))*0.4; // limb glow
    float ringE = abs(pl.y*3.4 + pl.x*0.5);
    col += vec3(0.55, 0.6, 0.7)*exp(-pow((length(vec2(pl.x, pl.y*3.4)) - 0.30)*22.0, 2.0))*0.25*step(0.05, abs(pl.y*3.0 - pl.x*0.2) + step(plD, 0.185));
    // dying sun, lower left
    float sunD = length(ndc - vec2(-1.1, -0.55));
    col += vec3(1.0, 0.45, 0.2)*exp(-sunD*sunD*2.2)*0.35*(0.85 + 0.15*sin(uTime*0.7));
    col += vec3(1.0, 0.7, 0.4)*exp(-sunD*22.0)*0.9;
  } else if (sc == 2) {
    // ================= RAIN CITY =================
    col = mix(vec3(0.004, 0.004, 0.010), vec3(0.015, 0.010, 0.028), clamp(vNdc.y + 0.6, 0.0, 1.0));
    // bokeh window lights, 3 parallax towers
    for (int i = 0; i < 3; i++) {
      float dep = 1.0 + float(i)*0.8;
      vec2 wc = vec2(ndc.x*dep + float(i)*3.7, (vNdc.y + 0.1)*dep);
      vec2 cell = floor(wc*vec2(9.0, 16.0));
      vec2 fr = fract(wc*vec2(9.0, 16.0)) - 0.5;
      float lit = step(0.72, hash21(cell + float(i)*13.0));
      vec3 wcol = mix(vec3(1.0, 0.7, 0.35), vec3(0.4, 0.8, 1.0), hash21(cell + 3.0));
      float soft = exp(-dot(fr, fr)*(9.0 - float(i)*2.0));
      col += wcol*lit*soft*(0.05/dep)*(0.75 + 0.25*hash21(cell + floor(uTime*2.0)));
    }
    // neon signs
    float nx = exp(-pow((ndc.x + 0.85)*7.0, 2.0))*exp(-pow((vNdc.y - 0.12)*11.0, 2.0));
    col += vec3(1.0, 0.2, 0.65)*nx*(0.5 + 0.5*step(0.3, fract(uTime*0.8)));
    float nx2 = exp(-pow((ndc.x - 0.95)*8.0, 2.0))*exp(-pow((vNdc.y - 0.3)*9.0, 2.0));
    col += vec3(0.2, 0.9, 1.0)*nx2*0.5;
    // rain streaks
    for (int i = 0; i < 2; i++) {
      float dep = 1.0 + float(i);
      vec2 rp = vec2(ndc.x*30.0*dep + float(i)*17.0, vNdc.y*4.0*dep + uTime*(3.5 + float(i)*1.5));
      float drop = step(0.94, hash11(floor(rp.x)))*smoothstep(0.4, 0.0, abs(fract(rp.y) - 0.5));
      col += vec3(0.5, 0.65, 0.85)*drop*0.05/dep;
    }
    // lightning: rare double-flash washing the sky
    float lSeed = floor(uTime*0.29);
    if (hash11(lSeed) > 0.86) {
      float lp = fract(uTime*0.29);
      float flash = exp(-lp*22.0) + 0.6*exp(-pow((lp - 0.12)*30.0, 2.0));
      col += vec3(0.45, 0.5, 0.7)*flash*smoothstep(-0.3, 0.9, vNdc.y);
    }
    // wet floor: smeared reflections below horizon
    if (vNdc.y < -0.35) {
      float m = (vNdc.y + 0.35)*-3.0;
      col += tint*0.06*m*(0.6 + 0.4*sin(ndc.x*40.0 + uTime*2.0));
      col *= 1.0 + m*0.5;
    }
  } else if (sc == 3) {
    // ================= VAULT (server corridor) =================
    col = vec3(0.004, 0.007, 0.009);
    // perspective rack walls: LED matrices converging to center
    for (int side = 0; side < 2; side++) {
      float sgn = side == 0 ? -1.0 : 1.0;
      float ax = abs(ndc.x);
      if (sgn*ndc.x > 0.15) {
        float dist = 0.35/max(ax - 0.12, 0.02);
        float wy = vNdc.y*dist*4.0;
        float wz = dist*3.0 + uTime*0.12;
        vec2 cell = floor(vec2(wz*3.0, wy*2.4));
        float fog = exp(-dist*0.55);
        float led = step(0.35, hash21(cell));
        vec3 lcol = mix(tint, vec3(0.2, 1.0, 0.45), step(0.85, hash21(cell + 5.0)));
        lcol = mix(lcol, vec3(1.0, 0.35, 0.2), step(0.94, hash21(cell + 9.0)));
        float blink = 0.5 + 0.5*step(0.4, hash21(cell + floor(uTime*(2.0 + hash21(cell)*6.0))));
        col += lcol*led*blink*0.10*fog;
      }
    }
    // service drone light sweeping down the corridor
    float dz = fract(uTime*0.11);
    float droneY = -0.15 + sin(uTime*0.8)*0.05;
    float droneS = exp(-pow((ndc.x - mix(1.6, -1.6, dz))*4.0, 2.0))*exp(-pow((vNdc.y - droneY)*8.0, 2.0));
    col += vec3(1.0, 0.85, 0.5)*droneS*0.35;
    // cold corridor floor strip + ceiling lights
    col += tint*0.3*exp(-pow(vNdc.y + 0.75, 2.0)*14.0)*exp(-ndc.x*ndc.x*1.4);
    float ceil2 = exp(-pow(vNdc.y - 0.8, 2.0)*40.0)*step(0.6, fract(ndc.x*2.0 + 0.3));
    col += vec3(0.7, 0.85, 1.0)*ceil2*0.14;
  } else if (sc == 4) {
    // ================= REACTOR =================
    col = mix(vec3(0.02, 0.004, 0.002), vec3(0.05, 0.01, 0.004), clamp(1.0 - length(ndc), 0.0, 1.0));
    // energy well below
    float wellD = length(vec2(ndc.x, (vNdc.y + 1.15)*1.6));
    float churn = fbm(vec3(ndc.x*3.0, vNdc.y*2.0 - uTime*0.4, uTime*0.1));
    col += vec3(1.0, 0.42, 0.1)*exp(-wellD*wellD*1.3)*(0.6 + 0.5*churn)*(0.9 + uLevel*0.6);
    col += vec3(1.0, 0.8, 0.3)*exp(-wellD*6.0)*0.8;
    // containment rings pulsing upward
    for (int i = 0; i < 4; i++) {
      float ph = fract(uTime*0.14 + float(i)*0.25);
      float ry = mix(-0.9, 0.9, ph);
      float ring = exp(-pow((vNdc.y - ry)*14.0, 2.0))*exp(-pow(ndc.x*0.7, 2.0));
      col += vec3(1.0, 0.5, 0.2)*ring*0.10*(1.0 - ph);
    }
    // rotating sweep beam inside the well
    float bAng = atan(vNdc.y + 1.15, ndc.x);
    float beam = exp(-pow(sin(bAng - uTime*0.9)*4.0, 2.0))*exp(-wellD*wellD*1.1);
    col += vec3(1.0, 0.55, 0.2)*beam*0.30;
    // rising heat sparks
    vec2 hp = vec2(ndc.x*14.0, vNdc.y*8.0 - uTime*1.6);
    float ember = step(0.985, hash21(floor(hp)))*smoothstep(0.5, 0.0, length(fract(hp) - 0.5));
    col += vec3(1.0, 0.6, 0.25)*ember*0.5;
    // warning strobe (subtle, slow)
    col += vec3(0.6, 0.05, 0.02)*0.05*step(0.92, fract(uTime*0.25));
  } else if (sc == 5) {
    // ================= ABYSS =================
    float depthG = clamp(1.0 - (vNdc.y + 1.0)*0.5, 0.0, 1.0);
    col = mix(vec3(0.0, 0.02, 0.045), vec3(0.0, 0.005, 0.015), depthG);
    // god-ray caustic shafts from above
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float rx = ndc.x + sin(uTime*0.1 + fi*2.1)*0.3 + fi*0.5 - 0.5;
      float shaft = exp(-rx*rx*(5.0 + fi*3.0))*smoothstep(-0.6, 1.0, vNdc.y);
      float flick2 = 0.7 + 0.3*fbm(vec3(rx*4.0, uTime*0.3, fi));
      col += vec3(0.1, 0.45, 0.5)*shaft*0.10*flick2;
    }
    // caustic web near the top
    float web = fbm(vec3(ndc*4.0 + vec2(uTime*0.12, 0.0), uTime*0.2));
    col += vec3(0.15, 0.5, 0.55)*pow(web, 3.0)*smoothstep(0.1, 0.9, vNdc.y)*0.7;
    // the leviathan: a vast shadow crossing behind, rarely
    float lvSeed = floor(uTime*0.04);
    if (hash11(lvSeed) > 0.5) {
      float lvP = fract(uTime*0.04);
      vec2 lv = ndc - vec2(mix(-2.6, 2.6, lvP)*(hash11(lvSeed + 2.0) > 0.5 ? 1.0 : -1.0), 0.35 + sin(lvP*6.28)*0.1);
      float body = exp(-pow(lv.x*1.1, 2.0) - pow(lv.y*4.5, 2.0));
      col *= 1.0 - body*0.55;
      col += vec3(0.0, 0.15, 0.14)*exp(-pow(lv.x*1.4, 2.0) - pow((lv.y - 0.12)*7.0, 2.0))*0.3; // faint dorsal glow
    }
    // drifting particulate + rare fish silhouette shimmer
    for (int i = 0; i < 2; i++) {
      vec2 mp = ndc*(22.0 + float(i)*18.0) + vec2(uTime*(0.25 + float(i)*0.2), -uTime*(0.5 + float(i)*0.3));
      vec2 fr = fract(mp) - 0.5;
      col += vec3(0.3, 0.6, 0.6)*step(0.99, hash21(floor(mp)))*exp(-dot(fr, fr)*18.0)*0.10;
    }
  } else if (sc == 6) {
    // ================= TEMPLE =================
    col = mix(vec3(0.03, 0.02, 0.012), vec3(0.012, 0.008, 0.005), clamp(length(ndc)*0.7, 0.0, 1.0));
    // column silhouettes (dark vertical bands with warm rim)
    float colPat = abs(fract(ndc.x*1.3 + 0.5) - 0.5);
    float pillar = smoothstep(0.32, 0.30, colPat);
    float rimL = smoothstep(0.30, 0.295, colPat) - smoothstep(0.295, 0.27, colPat);
    col *= 1.0 - pillar*0.75;
    col += vec3(1.0, 0.7, 0.35)*rimL*0.10;
    // god-rays from upper right
    float ray = exp(-pow((ndc.x - 0.9 + (vNdc.y - 1.0)*0.7)*2.2, 2.0));
    float rayN = 0.75 + 0.25*fbm(vec3(ndc*3.0, uTime*0.1));
    col += vec3(1.0, 0.75, 0.4)*ray*smoothstep(-0.6, 0.8, vNdc.y)*0.16*rayN;
    // brazier glow at floor left + drifting dust
    col += vec3(1.0, 0.5, 0.15)*exp(-pow(length(ndc - vec2(-0.9, -0.7))*2.4, 2.0))*(0.25 + 0.06*sin(uTime*7.0) + 0.04*sin(uTime*13.0));
    col += vec3(1.0, 0.5, 0.15)*exp(-pow(length(ndc - vec2(0.95, -0.65))*2.6, 2.0))*(0.22 + 0.05*sin(uTime*8.3) + 0.04*sin(uTime*11.7));
    for (int i = 0; i < 2; i++) { // fireflies: drifting, BLINKING
      vec2 dp = ndc*(26.0 + float(i)*16.0) + vec2(uTime*(0.5 + float(i)*0.4), uTime*(0.22 + float(i)*0.1));
      vec2 cellF = floor(dp);
      vec2 fr = fract(dp) - 0.5;
      float blinkF = 0.3 + 0.7*pow(0.5 + 0.5*sin(uTime*(1.5 + hash21(cellF)*3.0) + hash21(cellF)*40.0), 3.0);
      col += vec3(1.0, 0.85, 0.5)*step(0.992, hash21(cellF))*exp(-dot(fr, fr)*16.0)*0.16*blinkF;
    }
  } else if (sc == 7) {
    // ================= CODE =================
    col = vec3(0.0, 0.012, 0.003);
    for (int i = 0; i < 3; i++) {
      float dep = 1.0 + float(i)*0.9;
      float colW = 0.022*dep;
      float cx = floor(ndc.x/colW);
      float speed = 0.4 + hash11(cx*7.1 + float(i)*13.0)*1.4;
      float head = fract(hash11(cx*3.3 + float(i)*7.0) - uTime*speed*0.22);
      float y = fract(vNdc.y*0.5 + 0.5);
      float dy = fract(y - head);
      float trail = exp(-dy*7.0);
      vec2 cell = vec2(cx, floor(vNdc.y/ (0.016*dep)));
      float glyph = step(0.4, hash21(cell + floor(uTime*(4.0 + hash11(cx)*8.0))));
      float bright = step(dy, 0.012)*2.2 + trail*0.55;
      col += vec3(0.25, 1.0, 0.4)*glyph*bright*(0.09/dep);
    }
    // cascade: one column flashes white and dumps
    float cSeed = floor(uTime*0.5);
    if (hash11(cSeed) > 0.7) {
      float cx2 = (hash11(cSeed + 1.0) - 0.5)*2.4;
      float cp = fract(uTime*0.5);
      col += vec3(0.8, 1.0, 0.85)*exp(-pow((ndc.x - cx2)*30.0, 2.0))*exp(-cp*6.0)*smoothstep(1.0 - cp*2.2, 1.0 - cp*2.2 - 0.3, vNdc.y)*0.8;
    }
    col *= 0.9 + 0.1*sin(gl_FragCoord.y*1.9);
  } else if (sc == 8) {
    // ================= SWEEP (volumetric scanner room) =================
    col = mix(vec3(0.004, 0.006, 0.010), vec3(0.001, 0.002, 0.004), clamp(length(ndc)*0.8, 0.0, 1.0));
    // the reciprocating scan plane, visible in the room itself
    float ph = abs(fract(uTime*0.35)*2.0 - 1.0);
    float sy = mix(-0.75, 0.75, ph);
    col += tint*exp(-pow((vNdc.y - sy)*18.0, 2.0))*0.22;
    col += tint*exp(-pow((vNdc.y - sy)*70.0, 2.0))*0.5;
    // measurement grid, faint
    vec2 g = abs(fract(ndc*6.0) - 0.5);
    col += tint*0.018*step(0.47, max(g.x, g.y));
    // drifting analysis reticle
    vec2 rc = ndc - vec2(sin(uTime*0.21)*0.5, cos(uTime*0.17)*0.3);
    float rD = length(rc);
    col += tint*exp(-pow((rD - 0.07)*90.0, 2.0))*0.25;
    col += tint*(step(abs(rc.x), 0.10)*step(abs(rc.y), 0.003) + step(abs(rc.y), 0.10)*step(abs(rc.x), 0.003))*0.22;
    // corner brackets
    float bx = step(1.35, abs(ndc.x))*step(abs(vNdc.y), 0.75)*step(0.68, abs(vNdc.y));
    col += tint*bx*0.15;
  } else {
    // ================= AURORA =================
    col = mix(vec3(0.004, 0.008, 0.02), vec3(0.001, 0.002, 0.006), clamp((vNdc.y + 1.0)*0.6, 0.0, 1.0));
    // star dome
    vec2 sp = ndc*55.0;
    vec2 fr = fract(sp) - 0.5;
    col += vec3(0.9, 0.95, 1.0)*step(0.994, hash21(floor(sp)))*exp(-dot(fr, fr)*20.0)*0.3;
    // aurora curtains: layered fbm ribbons
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float band = fbm(vec3(ndc.x*1.1 + fi*3.0, uTime*(0.05 + fi*0.02), fi*9.0));
      float cy = 0.25 + fi*0.18 + band*0.35;
      float curtain = exp(-pow((vNdc.y - cy)*3.4, 2.0));
      float rays = 0.6 + 0.4*sin(ndc.x*(18.0 + fi*7.0) + band*9.0 + uTime*0.4);
      vec3 acol = mix(vec3(0.1, 0.9, 0.45), vec3(0.5, 0.2, 0.9), fi*0.5);
      col += acol*curtain*rays*0.10*(1.0 + uGlow*0.5);
    }
    // moon + a rare shooting star
    float mD = length(ndc - vec2(-0.95, 0.62));
    col += vec3(0.85, 0.9, 1.0)*(exp(-pow((mD - 0.075)*60.0, 2.0))*0.3 + smoothstep(0.075, 0.070, mD)*0.55);
    col -= vec3(0.10)*smoothstep(0.062, 0.058, length(ndc - vec2(-0.93, 0.63))); // crater shading
    float ssSeed = floor(uTime*0.17);
    if (hash11(ssSeed) > 0.75) {
      float sp2 = fract(uTime*0.17);
      vec2 sPos = vec2(mix(1.8, 0.4, sp2), mix(0.85, 0.55, sp2));
      float star2 = exp(-length((ndc - sPos)*vec2(6.0, 40.0)))*exp(-sp2*4.0);
      col += vec3(0.9, 0.95, 1.0)*star2*0.9;
    }
    // snowfield glow at the bottom
    col += vec3(0.10, 0.14, 0.22)*smoothstep(-0.5, -1.0, vNdc.y)*0.5;
  }

  // ---- shared finish: emotion wash, scanlines, vignette, gamma ----
  col = mix(col, col*(0.4 + 0.6*uEmoCol/max(max(uEmoCol.r, uEmoCol.g), uEmoCol.b)), uGlow*0.30);
  col *= 0.92 + 0.08*sin(gl_FragCoord.y*1.7 + uTime*3.0);
  float vig = 1.0 - 0.42*pow(length(vNdc*vec2(0.75, 0.7)), 2.0);
  col *= vig;
  col = pow(max(col, 0.0), vec3(0.4545));
  outColor = vec4(col, 1.0);
}
`;
