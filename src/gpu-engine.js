const MAX_BOLTS = 4;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fract = (v) => v - Math.floor(v);
const seeded = (seed, salt) => fract(Math.sin((seed + salt * 13.13) * 43758.5453) * 143.731);

function hslToRgb(h, s, l) {
  const hue2rgb = (p, q, t0) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

const sceneShader = /* wgsl */ `
struct Uniforms {
  resolutionTime: vec4f,
  audio0: vec4f,
  audio1: vec4f,
  audio2: vec4f,
  environment: vec4f,
  frameMeta: vec4f,
  boltA0: vec4f,
  boltA1: vec4f,
  boltA2: vec4f,
  boltA3: vec4f,
  boltB0: vec4f,
  boltB1: vec4f,
  boltB2: vec4f,
  boltB3: vec4f,
  boltC0: vec4f,
  boltC1: vec4f,
  boltC2: vec4f,
  boltC3: vec4f,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

fn hash21(p: vec2f) -> f32 {
  let q = fract(p * vec2f(123.34, 456.21));
  let d = dot(q, q + 45.32);
  return fract((q.x + d) * (q.y + d));
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  let s = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

fn fbm3(p0: vec2f) -> f32 {
  var p = p0;
  var amp = 0.55;
  var sum = 0.0;
  for (var i = 0; i < 3; i++) {
    sum += noise2(p) * amp;
    p = mat2x2f(1.68, 1.12, -1.12, 1.68) * p + 12.7;
    amp *= 0.48;
  }
  return sum;
}

fn boltA(i: i32) -> vec4f {
  if (i == 0) { return u.boltA0; }
  if (i == 1) { return u.boltA1; }
  if (i == 2) { return u.boltA2; }
  return u.boltA3;
}
fn boltB(i: i32) -> vec4f {
  if (i == 0) { return u.boltB0; }
  if (i == 1) { return u.boltB1; }
  if (i == 2) { return u.boltB2; }
  return u.boltB3;
}
fn boltC(i: i32) -> vec4f {
  if (i == 0) { return u.boltC0; }
  if (i == 1) { return u.boltC1; }
  if (i == 2) { return u.boltC2; }
  return u.boltC3;
}

fn lightningPath(y: f32, seed: f32, tilt: f32, style: f32) -> f32 {
  var coarseFreq = 5.2;
  var fineFreq = 19.0;
  var coarseAmp = 0.105;
  var fineAmp = 0.035;
  var curve = sin(y * 7.0 + seed * 11.0) * 0.018;
  if (style > 0.5 && style < 1.5) {
    coarseFreq = 3.2; fineFreq = 12.0; coarseAmp = 0.072; fineAmp = 0.025;
    curve = (y - 0.45) * (y - 0.45) * sign(tilt + 0.0001) * 0.075;
  } else if (style > 1.5 && style < 2.5) {
    coarseFreq = 6.8; fineFreq = 27.0; coarseAmp = 0.135; fineAmp = 0.048;
    curve = sin(y * 13.0 + seed * 23.0) * 0.028;
  } else if (style > 2.5) {
    coarseFreq = 2.6; fineFreq = 10.0; coarseAmp = 0.15; fineAmp = 0.038;
    curve = sin(y * 4.2 + seed * 19.0) * 0.055;
  }
  let n1 = noise2(vec2f(y * coarseFreq + seed * 2.7, seed * 91.7));
  let n2 = noise2(vec2f(y * fineFreq + seed * 7.1, seed * 211.0));
  return (n1 - 0.5) * coarseAmp + (n2 - 0.5) * fineAmp + (y - 0.48) * tilt + curve;
}

fn branchMask(uv: vec2f, baseX: f32, originY: f32, length: f32, direction: f32, seed: f32, tilt: f32, style: f32, frontY: f32, thickness: f32) -> vec2f {
  let q = clamp((uv.y - originY) / max(length, 0.001), 0.0, 1.0);
  let branchEnabled = step(originY, frontY);
  let gate = step(originY, uv.y) * (1.0 - step(originY + length, uv.y)) * branchEnabled;
  let anchor = baseX + lightningPath(originY, seed, tilt, style);
  let w1 = noise2(vec2f(q * (11.0 + seed * 5.0), seed * 311.0));
  let w2 = noise2(vec2f(q * 28.0 + seed * 4.0, seed * 571.0));
  let spread = (0.055 + seed * 0.090) * direction;
  let bx = anchor + q * spread + (w1 - 0.5) * 0.044 + (w2 - 0.5) * 0.018;
  let d = abs(uv.x - bx);
  let core = exp(-d * thickness) * gate * (1.0 - q * 0.30);
  let glow = exp(-d * thickness * 0.075) * gate * (1.0 - q * 0.45);
  return vec2f(core, glow);
}

fn boltMask(uv: vec2f, a: vec4f, b: vec4f) -> vec3f {
  let x = a.x;
  let depth = a.y;
  let power = a.z;
  let age = a.w;
  let seed = b.x;
  let tilt = b.y;
  let style = b.z;
  let branchiness = b.w;
  if (power <= 0.001 || age < 0.0) { return vec3f(0.0); }

  let lead = mix(0.065, 0.16, power);
  var endY = 0.79 + depth * 0.045;
  if (style > 2.5) { endY = 0.50 + seed * 0.17; }
  let progress = clamp(age / max(lead, 0.001), 0.0, 1.0);
  let frontY = progress * endY;
  let reveal = 1.0 - smoothstep(frontY - 0.008, frontY + 0.022, uv.y);
  let terminal = 1.0 - smoothstep(endY - 0.010, endY + 0.016, uv.y);
  let baseX = 0.5 + x * (0.43 - depth * 0.06);
  let path = baseX + lightningPath(uv.y, seed, tilt, style) * (1.0 - depth * 0.18);
  let d = abs(uv.x - path);
  let depthFade = mix(1.0, 0.56, depth);
  var core = exp(-d * mix(760.0, 1180.0, power)) * reveal * terminal * depthFade;
  var glow = exp(-d * mix(24.0, 48.0, power)) * reveal * terminal * mix(1.0, 0.68, depth);

  let r1 = hash21(vec2f(seed * 113.0, 1.7));
  let r2 = hash21(vec2f(seed * 197.0, 3.1));
  let r3 = hash21(vec2f(seed * 271.0, 5.9));
  let r4 = hash21(vec2f(seed * 349.0, 9.4));
  let b1 = branchMask(uv, baseX, 0.15 + r1 * 0.20, 0.14 + r2 * 0.21, select(-1.0, 1.0, r3 > 0.5), fract(seed * 2.71 + 0.13), tilt, style, frontY, 520.0);
  let b2 = branchMask(uv, baseX, 0.36 + r2 * 0.18, 0.15 + r3 * 0.24, select(-1.0, 1.0, r4 > 0.5), fract(seed * 4.37 + 0.31), tilt * 0.75, style, frontY, 470.0);
  let b3 = branchMask(uv, baseX, 0.55 + r3 * 0.15, 0.11 + r4 * 0.20, select(-1.0, 1.0, r1 > 0.5), fract(seed * 7.19 + 0.57), tilt * 0.55, style, frontY, 430.0);
  var branchScale = branchiness * depthFade;
  if (style > 0.5 && style < 1.5) { branchScale *= 0.46; }
  if (style > 1.5 && style < 2.5) { branchScale *= 1.20; }
  core += (b1.x * 0.75 + b2.x * 0.62 + b3.x * 0.52) * branchScale * reveal;
  glow += (b1.y + b2.y + b3.y) * branchScale * 0.28 * reveal;

  if (style > 1.5 && style < 2.5) {
    let splitGate = smoothstep(0.12, 0.18, uv.y) * (1.0 - smoothstep(0.54, 0.70, uv.y));
    let splitOffset = 0.034 + r2 * 0.052;
    let splitPath = path + select(-splitOffset, splitOffset, r1 > 0.5);
    let sd = abs(uv.x - splitPath);
    core += exp(-sd * 620.0) * splitGate * reveal * 0.66;
    glow += exp(-sd * 34.0) * splitGate * reveal * 0.22;
  }

  let leaderHead = exp(-abs(uv.y - frontY) * 100.0) * exp(-abs(uv.x - path) * 42.0) * step(age, lead) * terminal;
  return vec3f(core, glow, leaderHead);
}

fn rainLayer(uv: vec2f, time: f32, amount: f32, scale: f32, speed: f32, slant: f32, seedOffset: f32) -> f32 {
  let cell = floor(uv.x * scale);
  let rnd = hash21(vec2f(cell + seedOffset, seedOffset * 7.31));
  let x = (cell + 0.10 + rnd * 0.80) / scale;
  let headY = fract(rnd * 8.7 + time * speed + seedOffset);
  let length = mix(0.055, 0.18, rnd) * mix(0.75, 1.28, amount);
  let rel = headY - uv.y;
  let tail = step(0.0, rel) * (1.0 - step(length, rel));
  let driftX = x + (uv.y - headY) * slant;
  let width = 0.0016 + rnd * 0.0012;
  let line = 1.0 - smoothstep(width, width * 3.8, abs(uv.x - driftX));
  let fade = pow(clamp(1.0 - rel / max(length, 0.001), 0.0, 1.0), 0.42);
  let alive = step(1.0 - amount * 0.78, hash21(vec2f(cell * 1.77, seedOffset * 19.0)));
  return line * tail * fade * alive;
}

fn cloudField(p: vec2f, z: f32, time: f32, wind: f32) -> f32 {
  let drift = vec2f(time * (0.010 + z * 0.010) * wind, time * 0.0025);
  let base = p * (1.25 + z * 1.15) + drift + vec2f(z * 7.1, z * 3.7);
  let warp = vec2f(fbm3(base * 0.58 + 3.0), fbm3(base * 0.51 - 5.0)) - 0.5;
  return fbm3(base + warp * 0.95);
}

fn cloudLightningGlow(screen: vec2f, z: f32) -> vec3f {
  var glow = vec3f(0.0);
  for (var i = 0; i < 4; i++) {
    let a = boltA(i);
    let c = boltC(i);
    if (a.z <= 0.001 || c.w <= 0.001) { continue; }
    let bx = 0.5 + a.x * 0.42;
    let depthMatch = exp(-abs(z - a.y) * 5.5);
    let d = distance(screen * vec2f(1.0, 1.32), vec2f(bx, 0.28 + a.y * 0.13) * vec2f(1.0, 1.32));
    let g = exp(-d * mix(5.0, 2.7, a.z)) * depthMatch * c.w;
    glow += c.xyz * g * (0.9 + a.z * 1.7);
  }
  return glow;
}

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vertexIndex], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
  let res = max(u.resolutionTime.xy, vec2f(1.0));
  let screen = fragCoord.xy / res;
  let aspect = res.x / res.y;
  let p = (screen - 0.5) * vec2f(aspect, 1.0);
  let time = u.resolutionTime.z;
  let energy = u.audio0.x;
  let sub = u.audio0.y;
  let bass = u.audio0.z;
  let lowMid = u.audio0.w;
  let vocal = u.audio1.x;
  let high = u.audio1.y;
  let air = u.audio1.z;
  let onset = u.audio1.w;
  let drums = u.audio2.x;
  let mood = u.audio2.z;
  let cloudDensity = u.environment.x;
  let wind = u.environment.y;
  let rainAmount = u.environment.z;
  let exposure = u.environment.w;

  let zenith = vec3f(0.004, 0.007, 0.016);
  let horizon = vec3f(0.018, 0.024, 0.038) + vec3f(0.010, 0.007, 0.018) * mood;
  var color = mix(zenith, horizon, pow(screen.y, 1.45));

  let vocalRibbonY = 0.30 + sin(screen.x * 8.0 + time * 0.38) * 0.022 + sin(screen.x * 19.0 - time * 0.22) * 0.008;
  let vocalRibbon = exp(-abs(screen.y - vocalRibbonY) * 55.0) * vocal * (0.12 + lowMid * 0.10);
  color += vec3f(0.18 + mood * 0.10, 0.08, 0.28 + mood * 0.16) * vocalRibbon;

  var trans = 1.0;
  var cloudAccum = vec3f(0.0);
  for (var step = 0; step < 6; step++) {
    let z = f32(step) / 5.0;
    let cp = p * mix(1.05, 1.62, z) + vec2f(0.0, -0.12 + z * 0.05);
    let n = cloudField(cp, z, time, wind);
    let topMask = 1.0 - smoothstep(0.56, 0.83, screen.y + z * 0.035);
    let density = smoothstep(0.38, 0.74, n + cloudDensity * 0.17 + bass * 0.045) * topMask;
    let alpha = density * mix(0.20, 0.12, z);
    let internal = cloudLightningGlow(screen, z);
    let silver = pow(clamp(n, 0.0, 1.0), 4.0) * (0.025 + high * 0.035);
    let cloudCol = vec3f(0.025, 0.030, 0.042) + silver + internal;
    cloudAccum += trans * alpha * cloudCol;
    trans *= (1.0 - alpha);
  }
  color = color * trans + cloudAccum;

  var lightningColor = vec3f(0.0);
  var totalFlash = 0.0;
  for (var i = 0; i < 4; i++) {
    let a = boltA(i);
    let b = boltB(i);
    let c = boltC(i);
    let mask = boltMask(screen, a, b);
    let boltCol = c.xyz;
    lightningColor += boltCol * (mask.x * 4.2 + mask.y * 0.60 + mask.z * 1.8) * (0.55 + a.z * 0.95);
    totalFlash += c.w;

    if (a.z > 0.001 && a.w >= 0.0) {
      let lead = mix(0.065, 0.16, a.z);
      let impactAge = max(0.0, a.w - lead);
      let endX = 0.5 + a.x * (0.43 - a.y * 0.06) + lightningPath(0.79, b.x, b.y, b.z) * (1.0 - a.y * 0.18);
      let impact = exp(-distance(screen * vec2f(1.0, 1.7), vec2f(endX, 0.795) * vec2f(1.0, 1.7)) * 42.0) * exp(-impactAge * 7.5) * step(lead, a.w);
      lightningColor += boltCol * impact * a.z * 1.7;
    }
  }
  color += lightningColor;
  color += vec3f(0.08, 0.10, 0.15) * clamp(totalFlash, 0.0, 2.0) * 0.22;

  let waterMask = smoothstep(0.765, 0.81, screen.y);
  if (waterMask > 0.0) {
    let wave = noise2(vec2f(screen.x * 48.0 + time * 0.10, screen.y * 150.0 - time * 0.55));
    var water = vec3f(0.008, 0.014, 0.022) + wave * 0.010 + vec3f(0.004, 0.005, 0.010) * energy;
    for (var i = 0; i < 4; i++) {
      let a = boltA(i);
      let b = boltB(i);
      let c = boltC(i);
      if (a.z <= 0.001 || a.w < 0.0) { continue; }
      let lead = mix(0.065, 0.16, a.z);
      let impactAge = max(0.0, a.w - lead);
      let endX = 0.5 + a.x * (0.43 - a.y * 0.06) + lightningPath(0.79, b.x, b.y, b.z) * (1.0 - a.y * 0.18);
      let distortedX = endX + (wave - 0.5) * 0.035 * (screen.y - 0.78) * 4.0;
      let refl = exp(-abs(screen.x - distortedX) * (25.0 + (1.0 - a.z) * 28.0)) * exp(-(screen.y - 0.78) * 4.8) * c.w;
      let rippleR = impactAge * (0.10 + a.z * 0.06);
      let dist = distance(vec2f((screen.x - endX) * 1.6, screen.y - 0.80), vec2f(0.0));
      let ripple = exp(-abs(dist - rippleR) * 170.0) * exp(-impactAge * 3.0) * step(lead, a.w);
      water += c.xyz * (refl * 0.72 + ripple * a.z * 0.46);
    }
    color = mix(color, water, waterMask);
  }

  var rain = 0.0;
  rain += rainLayer(screen, time, rainAmount, 75.0, 1.05 + energy * 0.9, 0.11 + wind * 0.045, 1.3);
  rain += rainLayer(screen, time, rainAmount, 118.0, 1.48 + drums * 0.8, 0.08 + wind * 0.035, 5.7) * 0.74;
  rain += rainLayer(screen, time, rainAmount, 166.0, 1.92 + high * 0.65, 0.055 + wind * 0.025, 11.2) * 0.50;
  color += vec3f(0.16, 0.20, 0.26) * rain * (0.35 + rainAmount * 0.75);

  let atmosphericPulse = onset * 0.018 + sub * 0.012 + air * 0.008;
  color += vec3f(0.045, 0.055, 0.082) * atmosphericPulse;
  return vec4f(color * exposure, 1.0);
}
`;

const postShader = /* wgsl */ `
struct Uniforms {
  resolutionTime: vec4f,
  audio0: vec4f,
  audio1: vec4f,
  audio2: vec4f,
  environment: vec4f,
  frameMeta: vec4f,
  boltA0: vec4f,
  boltA1: vec4f,
  boltA2: vec4f,
  boltA3: vec4f,
  boltB0: vec4f,
  boltB1: vec4f,
  boltB2: vec4f,
  boltB3: vec4f,
  boltC0: vec4f,
  boltC1: vec4f,
  boltC2: vec4f,
  boltC3: vec4f,
};
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> u: Uniforms;

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vertexIndex], 0.0, 1.0);
}

fn aces(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
  let uv = fragCoord.xy / max(u.resolutionTime.xy, vec2f(1.0));
  let texel = 1.0 / max(u.resolutionTime.xy, vec2f(1.0));
  let center = textureSample(sceneTex, samp, uv).rgb;
  let h1 = textureSample(sceneTex, samp, uv + vec2f(texel.x * 3.0, 0.0)).rgb;
  let h2 = textureSample(sceneTex, samp, uv - vec2f(texel.x * 3.0, 0.0)).rgb;
  let h3 = textureSample(sceneTex, samp, uv + vec2f(texel.x * 7.0, 0.0)).rgb;
  let h4 = textureSample(sceneTex, samp, uv - vec2f(texel.x * 7.0, 0.0)).rgb;
  let v1 = textureSample(sceneTex, samp, uv + vec2f(0.0, texel.y * 2.0)).rgb;
  let v2 = textureSample(sceneTex, samp, uv - vec2f(0.0, texel.y * 2.0)).rgb;
  let blur = center * 0.30 + (h1 + h2) * 0.16 + (h3 + h4) * 0.07 + (v1 + v2) * 0.12;
  let lum = dot(blur, vec3f(0.2126, 0.7152, 0.0722));
  let bright = max(0.0, lum - 0.44);
  let bloomGain = 0.55 + u.audio1.w * 0.30 + min(1.0, u.frameMeta.y / 4.0) * 0.20;
  var color = center + blur * bright * bloomGain;
  color = aces(color);
  let d = distance(uv, vec2f(0.5));
  color *= 1.0 - smoothstep(0.40, 0.82, d) * 0.34;
  let grain = fract(sin(dot(uv * u.resolutionTime.xy + u.resolutionTime.z * 13.0, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
  color += grain * (0.006 + u.audio0.x * 0.003);
  color = pow(max(color, vec3f(0.0)), vec3f(0.92));
  return vec4f(color, 1.0);
}
`;

export class StormRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.device = null;
    this.context = null;
    this.format = null;
    this.sceneFormat = 'rgba16float';
    this.uniformBuffer = null;
    this.scenePipeline = null;
    this.postPipeline = null;
    this.sceneBindGroup = null;
    this.postBindGroup = null;
    this.sceneTexture = null;
    this.sampler = null;
    this.renderScale = 0.62;
    this.autoQuality = true;
    this.activeBolts = [];
    this.frameSamples = [];
    this.lastQualityCheck = 0;
    this.lastDrawTime = 0;
    this.targetInterval = 1000 / 30;
    this.controls = { lightning: 1, rain: 1, vocal: 1 };
  }

  async init() {
    if (!navigator.gpu) throw new Error('WebGPU недоступен. Нужен Chrome Android/Desktop с WebGPU.');
    const adapterOptions = /Windows/i.test(navigator.userAgent) ? undefined : { powerPreference: 'high-performance' };
    const adapter = await navigator.gpu.requestAdapter(adapterOptions);
    if (!adapter) throw new Error('WebGPU adapter не найден.');
    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu');
    if (!this.context) throw new Error('Не удалось получить WebGPU canvas context.');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

    this.uniformBuffer = this.device.createBuffer({
      size: 72 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const sceneModule = this.device.createShaderModule({ code: sceneShader });
    const postModule = this.device.createShaderModule({ code: postShader });
    const [sceneInfo, postInfo] = await Promise.all([
      sceneModule.getCompilationInfo(),
      postModule.getCompilationInfo(),
    ]);
    const shaderErrors = [...sceneInfo.messages, ...postInfo.messages].filter((message) => message.type === 'error');
    if (shaderErrors.length) {
      console.error('WGSL compilation errors:', shaderErrors);
      throw new Error(`Ошибка компиляции WGSL: ${shaderErrors[0].message}`);
    }
    this.scenePipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: sceneModule, entryPoint: 'vs' },
      fragment: { module: sceneModule, entryPoint: 'fs', targets: [{ format: this.sceneFormat }] },
      primitive: { topology: 'triangle-list' },
    });
    this.postPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: postModule, entryPoint: 'vs' },
      fragment: { module: postModule, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.sceneBindGroup = this.device.createBindGroup({
      layout: this.scenePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.resize(true);

    const info = adapter.info || {};
    return { vendor: info.vendor || '', architecture: info.architecture || '', description: info.description || '' };
  }

  setAutoQuality(value) { this.autoQuality = !!value; }
  setControls(next) { this.controls = { ...this.controls, ...next }; }
  clearLightning() { this.activeBolts.length = 0; }

  resize(force = false) {
    if (!this.device || !this.postPipeline || !this.uniformBuffer || !this.sampler) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const maxWidth = 1280;
    let width = Math.max(2, Math.round(innerWidth * dpr * this.renderScale));
    let height = Math.max(2, Math.round(innerHeight * dpr * this.renderScale));
    if (width > maxWidth) {
      const k = maxWidth / width;
      width = maxWidth;
      height = Math.max(2, Math.round(height * k));
    }
    if (!force && this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.sceneTexture?.destroy();
    this.sceneTexture = this.device.createTexture({
      size: [width, height],
      format: this.sceneFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.postBindGroup = this.device.createBindGroup({
      layout: this.postPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.sceneTexture.createView() },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  triggerLightning(event, playbackTime = 0) {
    if (!event || this.controls.lightning <= 0.01) return;
    const seed = event.seed ?? Math.random();
    const power = clamp((event.power || 0.5) * this.controls.lightning, 0.12, 1.25);
    const r1 = seeded(seed, 1), r2 = seeded(seed, 2), r3 = seeded(seed, 3), r4 = seeded(seed, 4), r5 = seeded(seed, 5);
    let style = 0;
    if (event.type === 'impact') style = 2;
    else if (event.type === 'fork') style = r1 > 0.42 ? 2 : 0;
    else if (event.type === 'arc') style = 3;
    else style = r2 > 0.68 ? 1 : 0;
    const tiltRange = style === 3 ? 0.54 : style === 1 ? 0.16 : 0.30;
    const branchiness = clamp((event.high || 0) * 0.62 + power * 0.48 + r5 * 0.20, 0.16, 1.0);
    const hue = fract((event.hue ?? 0.60) + (r3 - 0.5) * 0.055);
    const rgb = hslToRgb(hue, 0.86, 0.68);
    const leadTime = event.leadTime || (0.065 + clamp(power, 0, 1) * 0.095);
    const triggerTime = event.triggerTime ?? Math.max(0, (event.time ?? playbackTime) - leadTime);

    this.activeBolts.push({
      power,
      seed: fract(seed * 1.913 + r4 * 0.371),
      hue,
      rgb,
      x: -0.82 + r1 * 1.64,
      depth: clamp(event.depth ?? (0.12 + r4 * 0.78), 0.05, 0.95),
      tilt: (r2 - 0.5) * tiltRange,
      style,
      branchiness,
      leadTime,
      triggerTime,
    });
    if (this.activeBolts.length > MAX_BOLTS) {
      this.activeBolts.sort((a, b) => (a.power * 0.7 + a.triggerTime * 0.001) - (b.power * 0.7 + b.triggerTime * 0.001));
      this.activeBolts.shift();
    }
  }

  render(sample, playbackTime = 0) {
    if (!this.device || !this.scenePipeline || !this.postPipeline || !this.sceneTexture) return;
    const nowMs = performance.now();
    if (nowMs - this.lastDrawTime < this.targetInterval * 0.82) return;
    const dt = this.lastDrawTime ? nowMs - this.lastDrawTime : this.targetInterval;
    this.lastDrawTime = nowMs;
    const now = nowMs * 0.001;

    this.activeBolts = this.activeBolts.filter((bolt) => playbackTime - bolt.triggerTime < 0.90);
    const bolts = this.activeBolts.slice(-MAX_BOLTS);
    const sectionType = sample.sectionType || 'steady';
    const sectionBoost = sectionType === 'climax' ? 0.17 : sectionType === 'drop' ? 0.11 : sectionType === 'build' ? 0.055 : 0;
    const rain = clamp((0.01 + sample.energy * 0.48 + sample.drums * 0.34 + sample.sectionEnergy * 0.18 + sectionBoost) * this.controls.rain, 0, 1);
    const cloudDensity = clamp(0.35 + sample.energy * 0.24 + sample.sub * 0.12 + sample.sectionEnergy * 0.16, 0.28, 0.95);
    const wind = 0.50 + sample.lowMid * 0.30 + sample.high * 0.25 + sample.air * 0.12;
    const exposure = 1.04 + sample.energy * 0.10;
    const sectionCode = ({ intro: 0, calm: 1, build: 2, drop: 3, climax: 4, release: 5, vocal: 6, steady: 7 })[sectionType] ?? 7;
    const beatPulse = clamp(sample.onset * 0.72 + sample.drums * 0.28, 0, 1);

    const u = new Float32Array(72);
    u.set([this.canvas.width, this.canvas.height, now, playbackTime], 0);
    u.set([sample.energy || 0, sample.sub || 0, sample.bass || 0, sample.lowMid || 0], 4);
    u.set([(sample.vocal || 0) * this.controls.vocal, sample.high || 0, sample.air || 0, sample.onset || 0], 8);
    u.set([sample.drums || 0, sample.instrumental || 0, sample.mood ?? 0.5, sample.sectionEnergy || 0], 12);
    u.set([cloudDensity, wind, rain, exposure], 16);
    u.set([this.renderScale, bolts.length, beatPulse, sectionCode], 20);

    for (let i = 0; i < MAX_BOLTS; i++) {
      const bolt = bolts[i];
      const aOffset = 24 + i * 4;
      const bOffset = 40 + i * 4;
      const cOffset = 56 + i * 4;
      if (!bolt) {
        u.set([0, 0, 0, -1], aOffset);
        u.set([0, 0, 0, 0], bOffset);
        u.set([0, 0, 0, 0], cOffset);
        continue;
      }
      const age = playbackTime - bolt.triggerTime;
      const impactAge = age - bolt.leadTime;
      let flash = 0;
      if (age >= 0 && age < bolt.leadTime) {
        flash = (0.045 + 0.035 * Math.sin(age * 145 + bolt.seed * 31)) * bolt.power;
      } else if (impactAge >= 0 && impactAge < 0.62) {
        const primary = Math.exp(-impactAge * 15.0);
        const reflash1 = Math.exp(-Math.pow((impactAge - 0.075) * 48, 2)) * (0.22 + bolt.power * 0.36);
        const reflash2 = Math.exp(-Math.pow((impactAge - 0.175) * 38, 2)) * (0.08 + bolt.branchiness * 0.22);
        const micro = 0.88 + Math.sin(impactAge * 220 + bolt.seed * 47) * 0.12;
        flash = clamp((primary + reflash1 + reflash2) * micro * (0.62 + bolt.power * 0.95), 0, 2.2);
      }
      u.set([bolt.x, bolt.depth, bolt.power, age], aOffset);
      u.set([bolt.seed, bolt.tilt, bolt.style, bolt.branchiness], bOffset);
      u.set([bolt.rgb[0], bolt.rgb[1], bolt.rgb[2], flash], cOffset);
    }

    this.device.queue.writeBuffer(this.uniformBuffer, 0, u);
    const encoder = this.device.createCommandEncoder();
    const scenePass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.sceneTexture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    scenePass.setPipeline(this.scenePipeline);
    scenePass.setBindGroup(0, this.sceneBindGroup);
    scenePass.draw(3);
    scenePass.end();

    const postPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    postPass.setPipeline(this.postPipeline);
    postPass.setBindGroup(0, this.postBindGroup);
    postPass.draw(3);
    postPass.end();
    this.device.queue.submit([encoder.finish()]);

    if (dt < 120) this.frameSamples.push(dt);
    if (this.frameSamples.length > 75) this.frameSamples.shift();
    this.maybeAdjustQuality(nowMs);
  }

  maybeAdjustQuality(nowMs) {
    if (!this.autoQuality || nowMs - this.lastQualityCheck < 2400 || this.frameSamples.length < 30) return;
    this.lastQualityCheck = nowMs;
    const sorted = [...this.frameSamples].sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    let next = this.renderScale;
    if (p75 > 39) next -= 0.06;
    else if (p75 > 35) next -= 0.035;
    else if (p75 < 29) next += 0.025;
    next = clamp(next, 0.40, 0.84);
    if (Math.abs(next - this.renderScale) >= 0.02) {
      this.renderScale = next;
      this.resize(true);
      this.frameSamples.length = 0;
    }
  }
}
