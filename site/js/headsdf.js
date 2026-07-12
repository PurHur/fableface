// headsdf.js — the ONE head definition, as GLSL chunks shared by all three techniques.
//
// Canon (head-local space, meters-ish): eye line at y=0, +z out of the face.
//   crown ~ +0.152, chin ~ -0.147, nose tip z ~ +0.105, eyes at (±0.033, 0, 0.054).
//
// sdHead(p, jaw, spread, blink, browL, browR) -> vec2(signedDistance, materialId)
//   materials: 0 skin, 1 eyeball, 2 lips, 3 mouth cavity, 4 teeth, 5 suit/collar
//
// headWarpFwd(p, ...) — forward vertex warp for the mesh/particle techniques
// (they animate a static neutral mesh; the raymarcher animates the SDF itself).

export const MAT = { SKIN: 0, EYE: 1, LIPS: 2, CAVITY: 3, TEETH: 4, SUIT: 5, HAIR: 6, BROW: 7 };

// Neutral pose baked into the grid/mesh: mouth slightly open so the mesh has
// separate lips + an oral cavity in its topology (a closed mouth can then be
// posed by warping the lips together).
export const NEUTRAL = { jaw: 0.12, spread: 0.0, blink: 0.06, brow: 0.0 };

export const EYE_L = [-0.0345, 0.0, 0.050];
export const EYE_R = [0.0345, 0.0, 0.050];
export const EYE_RADIUS = 0.0245;

// Grid bounds for the GPU field evaluation (mesh + particle build).
// Floating head only — tight bounds buy ~1.3mm voxels.
export const GRID = {
  min: [-0.100, -0.130, -0.130],
  max: [0.100, 0.125, 0.130],
  nx: 160, ny: 208, nz: 120,
  tilesX: 11, tilesY: 11, // 121 >= nz slices in the atlas
};

export const GLSL_COMMON = /* glsl */ `
  float hash11(float n){ return fract(sin(n)*43758.5453123); }
  float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453123); }
  vec3 hash33(vec3 p){
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p)*43758.5453123);
  }
  float vnoise(vec3 p){
    vec3 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    float n000 = hash33(i+vec3(0,0,0)).x, n100 = hash33(i+vec3(1,0,0)).x;
    float n010 = hash33(i+vec3(0,1,0)).x, n110 = hash33(i+vec3(1,1,0)).x;
    float n001 = hash33(i+vec3(0,0,1)).x, n101 = hash33(i+vec3(1,0,1)).x;
    float n011 = hash33(i+vec3(0,1,1)).x, n111 = hash33(i+vec3(1,1,1)).x;
    return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
               mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
  }
  float fbm(vec3 p){
    return 0.5333*vnoise(p) + 0.2667*vnoise(p*2.02) + 0.1333*vnoise(p*4.05) + 0.0667*vnoise(p*8.13);
  }
`;

export const GLSL_SDF = /* glsl */ `
  float smin(float a, float b, float k){
    float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0);
    return mix(b, a, h) - k*h*(1.0 - h);
  }
  float smax(float a, float b, float k){ return -smin(-a, -b, k); }
  float sdSphere(vec3 p, float r){ return length(p) - r; }
  float sdEll(vec3 p, vec3 r){
    float k0 = length(p/r);
    float k1 = length(p/(r*r));
    return k0*(k0 - 1.0)/k1;
  }
  float sdCapsule(vec3 p, vec3 a, vec3 b, float r){
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0);
    return length(pa - ba*h) - r;
  }

  // Jaw region mask: 1 on the chin/lower-lip region, 0 above the mouth line
  // and 0 again below the neck so the throat doesn't shear.
  float jawMask(vec3 p){
    float m = smoothstep(-0.042, -0.076, p.y);
    m *= smoothstep(-0.085, -0.015, p.z);
    m *= smoothstep(-0.20, -0.14, p.y);
    return m;
  }

  // NS-5-style split: 1 where the gray mechanical SKULL SHELL is, 0 on the
  // white face plate. The plate covers the face front and wraps the chin; the
  // shell owns the crown, sides, back and neck. (Function keeps its old name —
  // every renderer already consumes it.)
  float plateField(vec3 p){
    return p.z - 0.42*abs(p.x)
         - 0.90*max(0.0, p.y - 0.075)     // crown -> shell
         - 1.20*max(0.0, -(p.y + 0.118)); // below the chin -> shell
  }
  float hairMask(vec3 p){
    return 1.0 - smoothstep(0.008, 0.018, plateField(p));
  }

  vec3 jawRot(vec3 p, float ang){
    vec3 piv = vec3(0.0, -0.035, -0.040);
    vec3 q = p - piv;
    float c = cos(ang), s = sin(ang);
    q.yz = mat2(c, -s, s, c)*q.yz;
    return q + piv;
  }

  // Inverse-ish warp for the raymarcher: open the jaw by rotating the sample
  // point up into the neutral pose. Spatially-varying angle => approximate
  // SDF; the marcher compensates with a damped step factor.
  vec3 jawWarpInv(vec3 p, float jaw){
    return jawRot(p, jawMask(p)*jaw*0.22);
  }

  // Forward warp for mesh vertices / particles (mesh is baked at NEUTRAL_JAW).
  vec3 headWarpFwd(vec3 p, float jaw, float spread, float blink, float browL, float browR){
    // jaw relative to the baked neutral opening
    float dAng = (jaw - NEUTRAL_JAW)*0.22;
    p = jawRot(p, -jawMask(p)*dAng);

    // lip closure: squeeze the baked-open lip gap shut as the jaw closes
    float close = clamp((NEUTRAL_JAW - jaw)/NEUTRAL_JAW, 0.0, 1.0);
    float lgy = p.y + 0.072;
    float lw = exp(-(p.x*p.x*700.0 + lgy*lgy*8000.0))*smoothstep(0.02, 0.06, p.z);
    float w = min(close*lw*1.35, close);
    p.y = mix(p.y, -0.072 + lgy*0.24, w); // lips meet, but never interpenetrate

    // mouth corners: spread widens + lifts, negative purses
    vec2 mc = vec2(abs(p.x) - 0.024, p.y + 0.072);
    float cw = exp(-dot(mc, mc)*2600.0)*smoothstep(-0.02, 0.03, p.z);
    p.x += sign(p.x)*spread*0.006*cw;
    p.y += spread*0.005*cw;

    // brow raise/furrow
    float brow = p.x < 0.0 ? browL : browR;
    vec2 bc = vec2(abs(p.x) - 0.028, p.y - 0.030);
    float bw = exp(-dot(bc, bc)*2200.0)*smoothstep(0.0, 0.045, p.z);
    p.y += brow*0.008*bw;

    // blink: drag upper-lid-region vertices down over the eyeballs
    float dB = blink - NEUTRAL_BLINK;
    vec3 pe = vec3(abs(p.x), p.y, p.z) - vec3(EYE_X, 0.0, 0.050);
    float ew = exp(-dot(pe, pe)*3800.0)*smoothstep(-0.005, 0.012, p.z - 0.041);
    if (p.y > -0.004) {
      p.y -= dB*(p.y + 0.010)*ew*1.35;
      p.z += dB*0.0035*ew;
    }
    return p;
  }

  // ---- THE HEAD ----
  // Returns vec2(distance, material).
  vec2 sdHead(vec3 p, float jaw, float spread, float blink, float browL, float browR){
    vec3 pj = jawWarpInv(p, jaw);          // jaw-articulated sample point
    vec3 q  = vec3(abs(p.x), p.y, p.z);    // mirrored (static features)
    vec3 qj = vec3(abs(pj.x), pj.y, pj.z); // mirrored (jaw-following features)

    // -- skull + face mass: compact head (crown +0.106, menton ~-0.107),
    //    slim sides, eyes on the midline --
    float d = sdEll(p - vec3(0.0, 0.026, -0.022), vec3(0.067, 0.080, 0.094));
    d = smin(d, sdEll(pj - vec3(0.0, -0.036, 0.008), vec3(0.054, 0.064, 0.066)), 0.038);
    // jaw corners + chin
    d = smin(d, sdSphere(qj - vec3(0.037, -0.054, 0.002), 0.022), 0.022);
    d = smin(d, sdSphere(pj - vec3(0.0, -0.086, 0.050), 0.021), 0.020);
    // cheekbones — tight blend: definition, not puff
    d = smin(d, sdSphere(q - vec3(0.042, -0.012, 0.038), 0.018), 0.026);
    // brow ridge
    float brow = p.x < 0.0 ? browL : browR;
    d = smin(d, sdEll(q - vec3(0.028, 0.030 + brow*0.008, 0.058), vec3(0.032, 0.0090, 0.014)), 0.024);
    // forehead fill (slopes back above the brow)
    d = smin(d, sdEll(p - vec3(0.0, 0.048, 0.024), vec3(0.062, 0.046, 0.046)), 0.030);

    // -- nose: small and streamlined, NS-5 style --
    float nose = sdCapsule(p, vec3(0.0, 0.012, 0.064), vec3(0.0, -0.028, 0.082), 0.0048);
    nose = smin(nose, sdSphere(p - vec3(0.0, -0.038, 0.086), 0.0078), 0.008);
    nose = smin(nose, sdSphere(q - vec3(0.0095, -0.044, 0.077), 0.0055), 0.008);
    d = smin(d, nose, 0.008);
    // nostrils: shallow hints
    d = smax(d, -sdSphere(q - vec3(0.0048, -0.049, 0.0795), 0.0030), 0.004);

    // side-plane trim, TAPERED: full parietal width up top, narrowing below
    // eye level, then narrowing hard toward the chin — a mandible is a V,
    // not a column.
    d = smax(d, q.x - (0.0655 - 0.0090*smoothstep(0.015, -0.050, p.y)
                              - 0.0140*smoothstep(-0.045, -0.095, p.y)), 0.018);
    // and below the jawline the BACK pulls forward: no mass behind the jaw
    // at chin height (that used to be neck)
    d = smax(d, -p.z - (0.075 - 1.15*max(0.0, -(p.y + 0.048))), 0.020);

    // -- eyes: lid shell over the eyeball, almond opening carved out --
    // negative blink = eyes WIDEN (surprise/fear/alarm emotions)
    vec3 pe = q - vec3(EYE_X, 0.0, 0.050);
    d = smin(d, length(pe) - 0.0250, 0.012);
    float aperture = mix(0.0064, 0.0012, clamp(blink, 0.0, 1.0))
                   + 0.0026*clamp(-blink, 0.0, 0.4);
    float lidDrop = max(blink, 0.0)*0.0045 - 0.0012*clamp(-blink, 0.0, 0.4);
    float opening = sdEll(pe - vec3(0.0, -0.0015 - lidDrop, 0.016), vec3(0.0160, aperture, 0.014));
    d = smax(d, -opening, 0.005);

    // (no neck, no shoulders — the head floats)
    float mat = MAT_SKIN;

    // -- lips (follow the jaw warp so the lower lip rides the chin) --
    vec3 pm = pj - vec3(0.0, -0.072, 0.0695);
    pm.x /= (1.0 + 0.16*spread);
    pm.y -= spread*0.004*smoothstep(0.012, 0.028, abs(pm.x));
    // taper: lips get thinner and pull back toward the corners; slight upcurl
    float lipT = clamp(abs(pm.x)/0.024, 0.0, 1.0);
    pm.z += 0.0026*lipT*lipT;
    pm.y -= 0.0009*lipT*lipT;
    // the lip bodies themselves separate with the jaw (the cavity carve alone
    // only hollows BEHIND them and would leave the mouth looking sealed)
    float upper = sdEll(pm - vec3(0.0, 0.0036 + jaw*0.0045, 0.001), vec3(0.0225, 0.0042, 0.0050));
    float lower = sdEll(pm - vec3(0.0, -0.0054 - jaw*0.0115, -0.001), vec3(0.0200, 0.0050, 0.0058));
    float lips = min(upper, lower);
    if (lips < d) mat = MAT_LIPS;
    d = smin(d, lips, 0.010);

    // -- oral cavity + teeth (kept BEHIND the lip fronts: opens the seam, never
    //    slices through the lip bodies) --
    float cav = sdEll(pm - vec3(0.0, -0.001 - jaw*0.0035, -0.012),
                      vec3(0.0230, 0.0010 + jaw*0.0170, 0.018 + jaw*0.004));
    float dAfter = smax(d, -cav, 0.0025);
    if (dAfter > d + 0.0005) mat = MAT_CAVITY;
    d = dAfter;
    float teeth = sdEll(pm - vec3(0.0, 0.0058, -0.007), vec3(0.0150, 0.0038, 0.0090));
    teeth = max(teeth, cav + 0.0005); // teeth only exist inside the cavity
    if (teeth < d) { d = teeth; mat = MAT_TEETH; }

    // -- eyeballs --
    float eye = length(pe) - EYE_R;
    if (eye < d) { d = eye; mat = MAT_EYE; }

    // -- skull shell: slightly proud of the inset face plate, own material --
    float hm = hairMask(p);
    d -= 0.0012*hm;
    if (hm > 0.35 && mat < 0.5) mat = MAT_HAIR;

    // -- eyebrows: arched surface band riding the brow ridge --
    vec3 be = q - vec3(0.0315, 0.0295 + brow*0.008, 0.066);
    be.y += abs(q.x - 0.0315)*0.16 - 0.002;
    if (mat < 0.5 && sdEll(be, vec3(0.0170, 0.0052, 0.0090)) < 0.0015) mat = MAT_BROW;

    return vec2(d, mat);
  }
`;

// Shared iris/sclera shading — same eye in every technique, tinted per face.
export const GLSL_EYE = /* glsl */ `
  // pos/nrm in head-local space. gazeDir is the head-local look direction.
  // ringAmp scales the sci-fi emissive iris ring (0.3 subtle human .. 1.8 holo).
  // uPupil: emotional pupil dilation (driver s.pupil). Faces that never set the
  // uniform read 0 -> falls back to 1.0, so old programs keep working.
  uniform float uPupil;
  vec3 shadeEye(vec3 pos, vec3 gazeDir, vec3 irisTint, float ringAmp){
    vec3 eyeC = vec3(EYE_X*sign(pos.x), 0.0, 0.050);
    vec3 dir = normalize(pos - eyeC);
    // slight convergence: parallel gaze reads walleyed at portrait distance
    vec3 gd = normalize(gazeDir + vec3(-sign(pos.x)*0.04, 0.0, 0.0));
    float ang = acos(clamp(dot(dir, gd), -1.0, 1.0));

    // anthropometric: 12mm iris on a 24.5mm eyeball
    float irisA = 0.26;
    float pupilA = 0.095*(uPupil > 0.01 ? uPupil : 1.0);
    vec3 col = vec3(0.90, 0.88, 0.86); // sclera, slightly warm
    // subtle sclera shading toward the rim + faint inner-corner warmth
    col *= 1.0 - 0.38*smoothstep(0.5, 1.15, ang);
    col.r += 0.03*smoothstep(0.45, 0.9, ang);

    if (ang < irisA) {
      float t = ang/irisA;
      // radial fiber pattern
      vec3 tangent = normalize(dir - gd*dot(dir, gd) + 1e-5);
      float spokes = fbm(vec3(atan(tangent.y, tangent.x)*3.0, t*9.0, 1.7));
      vec3 iris = irisTint*(0.55 + 0.9*spokes)*(1.15 - 0.75*t);
      // limbal ring + emissive inner ring
      iris *= 1.0 - 0.85*smoothstep(0.78, 1.0, t);
      iris += irisTint*ringAmp*exp(-pow((t - 0.52)*9.0, 2.0));
      col = iris;
    }
    if (ang < pupilA) {
      float t = smoothstep(pupilA, pupilA*0.72, ang);
      col = mix(col, vec3(0.01), t);
    }
    return col;
  }
`;

// Builds the #define header binding constants into a shader.
export function glslHeader(extra = '') {
  return `#version 300 es
precision highp float;
#define EYE_X 0.0345
#define EYE_R ${EYE_RADIUS.toFixed(4)}
#define NEUTRAL_JAW ${NEUTRAL.jaw.toFixed(3)}
#define NEUTRAL_BLINK ${NEUTRAL.blink.toFixed(3)}
#define MAT_SKIN 0.0
#define MAT_EYE 1.0
#define MAT_LIPS 2.0
#define MAT_CAVITY 3.0
#define MAT_TEETH 4.0
#define MAT_SUIT 5.0
#define MAT_HAIR 6.0
#define MAT_BROW 7.0
${extra}
`;
}
