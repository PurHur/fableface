// scenes.js — EIGHT realistic chambers the AI companion inhabits and chooses to
// fit the moment. Each is a soft, volumetric room (never a hard grid), rendered
// in one fullscreen shader, driven by universal parameters the AI dials per
// situation. Design + research: docs/chambers-design-2026-07.md.
//
//   0 SOLARIUM    warm sunlit atrium         greeting / idle
//   1 HEARTH      fireside + rain on glass   comfort / user sad
//   2 VERDANT     forest glade, dappled sun  calm / restoration
//   3 STILLWATER  misty reflecting pool      meditation / rest / night
//   4 OBSERVATORY starfield + nebula         deep thinking / awe
//   5 TERRACE     dusk rooftop, city bokeh   celebration / good news
//   6 CLEARMIND   cool even studio           focused work / help
//   7 SIGNAL ROOM stark amber alert space    alert / urgent
//
// params: [light(night..day), warmth(cool..warm), fog, energy, ambient] (0..1)

import { GLSL_COMMON, glslHeader } from './headsdf.js';

export const SCENES = [
  { key: 'solarium',    name: 'SOLARIUM',    bg: 0, fx: 20, tint: [1.04, 1.0, 0.94], params: [0.85, 0.62, 0.35, 0.35, 0.5], grade: { sat: 1.05, con: 1.05, exp: 1.0, lift: [0.02, 0.014, 0.004] } },
  { key: 'hearth',      name: 'HEARTH',      bg: 1, fx: 21, tint: [1.1, 0.9, 0.72],  params: [0.28, 0.95, 0.5, 0.5, 0.6],  grade: { sat: 1.1, con: 1.1, exp: 0.95, lift: [0.03, 0.008, 0] } },
  { key: 'verdant',     name: 'VERDANT',     bg: 2, fx: 22, tint: [0.95, 1.06, 0.95], params: [0.75, 0.55, 0.4, 0.4, 0.5],  grade: { sat: 1.12, con: 1.06, exp: 1.0, lift: [0.006, 0.018, 0.008] } },
  { key: 'stillwater',  name: 'STILLWATER',  bg: 3, fx: 23, tint: [0.94, 1.02, 1.04], params: [0.6, 0.45, 0.6, 0.2, 0.3],   grade: { sat: 1.0, con: 1.04, exp: 0.98, lift: [0.004, 0.016, 0.022] } },
  { key: 'observatory', name: 'OBSERVATORY', bg: 4, fx: 24, tint: [0.9, 0.94, 1.12],  params: [0.12, 0.4, 0.3, 0.25, 0.7],  grade: { sat: 1.14, con: 1.12, exp: 1.0, lift: [0.006, 0.004, 0.03] } },
  { key: 'terrace',     name: 'TERRACE',     bg: 5, fx: 25, tint: [1.08, 0.92, 0.9],  params: [0.5, 0.75, 0.45, 0.6, 0.6],  grade: { sat: 1.18, con: 1.08, exp: 0.98, lift: [0.03, 0.006, 0.018] } },
  { key: 'clearmind',   name: 'CLEARMIND',   bg: 6, fx: 26, tint: [0.96, 1.0, 1.05],  params: [0.8, 0.4, 0.2, 0.15, 0.15],  grade: { sat: 0.94, con: 1.05, exp: 1.0, lift: [0.004, 0.01, 0.016] } },
  { key: 'signal',      name: 'SIGNAL ROOM', bg: 7, fx: 27, tint: [1.06, 0.96, 0.9],  params: [0.25, 0.5, 0.3, 0.3, 0.1],   grade: { sat: 1.06, con: 1.16, exp: 0.95, lift: [0.02, 0.008, 0.006] } },
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
// universal scene params (WISP VIII drives these; uCustom<0.5 => baked defaults)
uniform float uCustom, uSLight, uSWarmth, uSFog, uSEnergy, uSAmb;
out vec4 outColor;

// correlated colour temperature: cool (0) -> warm (1), as a light tint
vec3 cct(float w){ return mix(vec3(0.80,0.89,1.06), vec3(1.12,0.72,0.40), clamp(w,0.0,1.0)); }
// a soft round glow pool
float pool(vec2 p, vec2 c, float k){ return exp(-dot((p-c),(p-c))*k); }
// grid-cell twinkling motes/particles in [uv] space
float motes(vec2 p, float dens, float t, float seed){
  vec2 g=p*dens; vec2 id=floor(g); vec2 f=fract(g)-0.5;
  float on=step(0.986, hash21(id+seed));
  float d=length(f-(hash33(vec3(id,seed)).xy-0.5)*0.6);
  float tw=0.4+0.6*pow(0.5+0.5*sin(t*(1.0+hash21(id)*2.0)+hash21(id)*30.0),2.0);
  return on*exp(-d*d*22.0)*tw;
}

void main(){
  vec2 ndc = vNdc*vec2(uRes.x/uRes.y, 1.0);
  float t = uTime;
  vec3 col = vec3(0.0);
  int sc = int(uScene + 0.5);

  if (sc == 0) {
    // ===== SOLARIUM — warm sunlit atrium (greeting) =====
    float L = uCustom>0.5?uSLight:0.85, W = uCustom>0.5?uSWarmth:0.62, F = uCustom>0.5?uSFog:0.35, A = uCustom>0.5?uSAmb:0.5;
    vec3 warm = cct(W);
    col = mix(vec3(0.04,0.045,0.05), vec3(0.27,0.24,0.19)*warm, smoothstep(0.95,-0.7,vNdc.y))*(0.4+0.55*L);
    // slanted window daylight shaft + soft flicker
    float across = ndc.x - 0.34 - (vNdc.y-0.6)*0.55;
    float sh = smoothstep(0.55,0.0,abs(across))*smoothstep(-0.9,0.7,vNdc.y)*(0.7+0.3*fbm(vec3(ndc*2.0,t*0.1)));
    col += warm*sh*0.42*L;
    col += warm*motes(ndc, 18.0+A*8.0, t*0.4, 3.0)*sh*A*1.4;   // dust in the beam
    col += warm*0.34*pool(vec2(ndc.x, (vNdc.y+0.72)*2.0), vec2(0.1,0.0), 2.0)*(0.7+0.4*L); // floor light pool
    col *= 1.0 - 0.45*smoothstep(0.30,0.55,length(vec2(ndc.x+0.95,(vNdc.y+0.5)*0.8)))*0.0; // (foliage placeholder)
    col = mix(col, vec3(0.42,0.38,0.32)*warm, F*0.28*smoothstep(-0.3,0.9,vNdc.y));
  } else if (sc == 1) {
    // ===== HEARTH — fireside + rain on glass (comfort) =====
    float L = uCustom>0.5?uSLight:0.28, W = uCustom>0.5?uSWarmth:0.95, F = uCustom>0.5?uSFog:0.5, A = uCustom>0.5?uSAmb:0.6;
    vec3 fire = mix(vec3(1.0,0.55,0.22), vec3(1.0,0.42,0.16), 0.5);
    col = vec3(0.03,0.018,0.012)*(0.6+L);                       // warm near-black
    float flick = 0.8 + 0.2*fbm(vec3(t*3.0, t*1.7, 0.0)) + 0.06*sin(t*1.1);
    col += fire*pool(vec2(ndc.x, (vNdc.y+0.85)*1.3), vec2(0.0,0.0), 2.4)*(1.6+1.2*L)*flick; // fire glow
    col += vec3(1.0,0.7,0.3)*pool(vec2(ndc.x,(vNdc.y+0.9)*1.1), vec2(0.0,0.0), 6.0)*0.7*flick;
    // rain streaks on an implied window (upper area, cool)
    vec2 rp = vec2(ndc.x*26.0, vNdc.y*5.0 + t*1.4);
    float rain = step(0.93, hash11(floor(rp.x)))*smoothstep(0.45,0.0,abs(fract(rp.y)-0.5));
    col += vec3(0.4,0.5,0.62)*rain*0.05*smoothstep(-0.2,0.9,vNdc.y);
    // refuge: deep enclosing vignette
    col *= 1.0 - 0.55*smoothstep(0.5,1.15,length(ndc*vec2(0.85,0.95)));
    col = mix(col, vec3(0.20,0.09,0.04), F*0.25);
  } else if (sc == 2) {
    // ===== VERDANT — forest glade, dappled canopy light (calm) =====
    float L = uCustom>0.5?uSLight:0.75, W = uCustom>0.5?uSWarmth:0.55, F = uCustom>0.5?uSFog:0.4, A = uCustom>0.5?uSAmb:0.5;
    vec3 shaftC = cct(W)*vec3(1.0,1.0,0.9);
    col = mix(vec3(0.02,0.05,0.03), vec3(0.06,0.16,0.09), smoothstep(0.9,-0.6,vNdc.y))*(0.5+0.7*L);
    // sky peek (prospect) up top
    col += vec3(0.5,0.68,0.7)*smoothstep(0.35,0.95,vNdc.y)*0.25*L;
    // dappled canopy shafts from upper-back, broken by a moving leaf mask
    vec2 sway = vec2(sin(t*0.5)*0.03, 0.0);
    float leaves = fbm(vec3(ndc*3.0 + sway, t*0.05));
    float shaft = smoothstep(0.4,0.9,leaves)*smoothstep(-0.7,0.9,vNdc.y);
    float shaftDir = smoothstep(0.6,0.0,abs(ndc.x - 0.2 - (vNdc.y-0.5)*0.6));
    col += shaftC*shaft*shaftDir*0.5*L;
    // refuge: dark leafy foreground
    col *= 1.0 - 0.5*smoothstep(0.4,1.0,length(ndc*vec2(0.8,1.0)));
    col += vec3(0.9,1.0,0.7)*motes(ndc, 14.0+A*8.0, t*0.3, 7.0)*A*0.9; // pollen
    col = mix(col, vec3(0.20,0.28,0.16), F*0.3*smoothstep(-0.2,0.9,vNdc.y)); // green-gold haze
  } else if (sc == 3) {
    // ===== STILLWATER — misty reflecting pool (meditation / rest) =====
    float L = uCustom>0.5?uSLight:0.6, W = uCustom>0.5?uSWarmth:0.45, F = uCustom>0.5?uSFog:0.6, A = uCustom>0.5?uSAmb:0.3;
    float horizon = -0.2;
    vec3 sky = mix(vec3(0.55,0.66,0.68), vec3(0.30,0.42,0.48), smoothstep(0.9,horizon,vNdc.y))*cct(W)*(0.4+0.7*L);
    if (vNdc.y > horizon) {
      col = sky;
    } else {
      // still water: blurred reflection of the sky + concentric breath ripples
      float m = (horizon - vNdc.y);
      vec3 refl = mix(vec3(0.30,0.42,0.48), vec3(0.10,0.18,0.22), smoothstep(0.0,0.6,m))*cct(W)*(0.4+0.6*L);
      float rr = length(vec2(ndc.x, m*1.6));
      float ripple = 0.5+0.5*sin(rr*10.0 - t*(0.6+uLevel*1.5));
      refl += vec3(0.6,0.75,0.8)*pow(ripple,3.0)*exp(-rr*1.4)*0.12*(0.6+uGlow);
      col = refl;
    }
    // drifting mist bands
    float mist = fbm(vec3(ndc*vec2(1.2,3.0) + vec2(t*0.03,0.0), 0.0));
    col = mix(col, vec3(0.72,0.80,0.80), F*0.4*smoothstep(0.3,0.8,mist)*smoothstep(-0.6,0.4,vNdc.y));
    col += vec3(0.8,0.88,0.9)*motes(ndc, 10.0, t*0.15, 5.0)*A*0.4; // sparse mist motes
  } else if (sc == 4) {
    // ===== OBSERVATORY — starfield + nebula (thinking / awe) =====
    float L = uCustom>0.5?uSLight:0.12, F = uCustom>0.5?uSFog:0.3, A = uCustom>0.5?uSAmb:0.7, E = uCustom>0.5?uSEnergy:0.25;
    col = vec3(0.01,0.012,0.025)*(0.5+L);
    // domain-warped nebula (parallax) — soft, emissive
    vec2 q = vec2(fbm(vec3(ndc*1.3, t*0.02)), fbm(vec3(ndc*1.3+5.2, t*0.015)));
    float neb = fbm(vec3(ndc*1.6 + 3.0*q, t*0.01));
    col += mix(vec3(0.10,0.06,0.20), mix(vec3(0.12,0.35,0.42), uEmoCol*0.5, uGlow*0.4), smoothstep(0.3,0.9,neb))*pow(neb,2.2)*(0.7+F);
    // three star layers, parallax + twinkle
    col += vec3(0.9,0.95,1.0)*motes(ndc, 40.0, t*E*2.0, 1.0)*1.6*A;
    col += vec3(1.0,0.92,0.82)*motes(ndc*1.7+7.0, 60.0, t*E*2.0, 9.0)*0.9*A;
    col += vec3(0.85,0.9,1.0)*motes(ndc*0.7-3.0, 24.0, t*E*2.0, 4.0)*A;
    col *= 1.0 - 0.35*smoothstep(0.7,1.3,length(ndc)); // gentle deep-field vignette
  } else if (sc == 5) {
    // ===== TERRACE — dusk rooftop over a city (celebration) =====
    float L = uCustom>0.5?uSLight:0.5, W = uCustom>0.5?uSWarmth:0.75, F = uCustom>0.5?uSFog:0.45, A = uCustom>0.5?uSAmb:0.6;
    // magic-hour vertical gradient: violet zenith -> coral horizon
    col = mix(vec3(0.66,0.34,0.24), vec3(0.22,0.13,0.30), smoothstep(-0.3,0.95,vNdc.y))*(0.4+0.5*L);
    col += vec3(1.0,0.7,0.4)*exp(-max(vNdc.y+0.2,0.0)*3.5)*0.32*L; // warm horizon bloom
    // city light bokeh below the rail
    if (vNdc.y < -0.15) {
      vec2 cp = vec2(ndc.x*8.0, (vNdc.y+0.15)*10.0);
      vec2 id=floor(cp); float lit=step(0.6,hash21(id));
      vec3 wc = mix(vec3(1.0,0.75,0.4), vec3(0.5,0.8,1.0), hash21(id+3.0));
      col += wc*lit*exp(-dot(fract(cp)-0.5,fract(cp)-0.5)*9.0)*0.14*(0.7+0.3*hash21(id+floor(t*2.0)));
    }
    col += cct(W)*motes(ndc, 12.0, t*0.5, 6.0)*A*0.5;          // warm drifting sparks
    col = mix(col, vec3(0.7,0.45,0.4), F*0.3*smoothstep(-0.4,0.6,vNdc.y)); // warm haze
  } else if (sc == 6) {
    // ===== CLEARMIND — cool even studio (focus) =====
    float L = uCustom>0.5?uSLight:0.8, W = uCustom>0.5?uSWarmth:0.4, F = uCustom>0.5?uSFog:0.2;
    vec3 tone = cct(W);
    col = mix(vec3(0.10,0.115,0.13), vec3(0.030,0.038,0.05), smoothstep(0.0,1.2,length(ndc)))*tone*(1.2+0.8*L);
    col += tone*0.10*pool(vec2(ndc.x,(vNdc.y+0.6)*1.4), vec2(0.0,0.0), 1.6)*L; // soft floor
    col = mix(col, vec3(0.14,0.16,0.19)*tone, F*0.5); // faint depth haze (never sterile)
  } else {
    // ===== SIGNAL ROOM — stark amber alert (urgent) =====
    float L = uCustom>0.5?uSLight:0.25, E = uCustom>0.5?uSEnergy:0.3;
    vec3 accent = mix(vec3(1.0,0.69,0.13), vec3(1.0,0.30,0.30), clamp(uGlow*1.4,0.0,1.0)); // amber -> red on alarm
    col = vec3(0.02,0.023,0.028)*(0.5+L);
    // one framing light bar around the subject + slow scan sweep
    float ring = exp(-pow((length(ndc*vec2(0.9,1.05))-0.58)*13.0,2.0));
    col += accent*ring*0.4;
    float scan = exp(-pow((vNdc.y - (fract(t*0.1*(0.5+E))*2.0-1.0))*30.0,2.0));
    col += accent*scan*0.10;
    col *= 1.0 - 0.7*smoothstep(0.6,1.25,length(ndc*vec2(0.9,1.0))); // tight vignette
  }

  // ---- shared finish ----
  // PRESENCE BACKING: gently darken behind the floating head so the additive
  // hologram always has contrast — otherwise it washes out over bright rooms.
  float backing = exp(-(vNdc.x*vNdc.x*1.6 + (vNdc.y + 0.02)*(vNdc.y + 0.02)*1.15)*2.1);
  col *= 1.0 - 0.32*backing;
  // subtle emotion wash, vignette, dither, gamma
  col = mix(col, col*(0.55 + 0.6*uEmoCol/max(max(uEmoCol.r,uEmoCol.g),uEmoCol.b)), uGlow*0.22);
  float vig = 1.0 - 0.34*pow(length(vNdc*vec2(0.78,0.72)), 2.2);
  col *= vig;
  col += (hash21(gl_FragCoord.xy + fract(t)) - 0.5)/220.0; // dither: kills banding on soft gradients
  col = pow(max(col, 0.0), vec3(0.4545));
  outColor = vec4(col, 1.0);
}
`;
