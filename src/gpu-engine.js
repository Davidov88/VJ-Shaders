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
  for (var octave = 0; octave < 3; octave++) {
    sum += noise2(p) * amp;
    p = mat2x2f(1.68, 1.12, -1.12, 1.68) * p + 12.7;
    amp *= 0.48;
  }
  return sum;
}

fn hsv2rgb(c: vec3f) -> vec3f {
  let k = vec4f(1.0, 0.6666667, 0.3333333, 3.0);
  let p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
  return c.z * mix(k.xxx, clamp(p - k.xxx, vec3f(0.0), vec3f(1.0)), c.y);
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
  var coarseAmp = 0.080;
  var fineAmp = 0.025;
  var curve = sin(y * 7.0 + seed * 11.0) * 0.014;
  if (style > 0.5 && style < 1.5) {
    coarseFreq = 3.2; fineFreq = 12.0; coarseAmp = 0.055; fineAmp = 0.020;
    curve = (y - 0.45) * (y - 0.45) * sign(tilt + 0.0001) * 0.060;
  } else if (style > 1.5 && style < 2.5) {
    coarseFreq = 6.8; fineFreq = 27.0; coarseAmp = 0.105; fineAmp = 0.036;
    curve = sin(y * 13.0 + seed * 23.0) * 0.023;
  } else if (style > 2.5) {
    coarseFreq = 2.6; fineFreq = 10.0; coarseAmp = 0.115; fineAmp = 0.030;
    curve = sin(y * 4.2 + seed * 19.0) * 0.040;
  }
  let n1 = noise2(vec2f(y * coarseFreq + seed * 2.7, seed * 91.7));
  let n2 = noise2(vec2f(y * fineFreq + seed * 7.1, seed * 211.0));
  return (n1 - 0.5) * coarseAmp + (n2 - 0.5) * fineAmp + (y - 0.48) * tilt + curve;
}

fn branchMask(uv: vec2f, baseX: f32, originY: f32, branchLength: f32, direction: f32, seed: f32, tilt: f32, style: f32, frontY: f32, thickness: f32) -> vec2f {
  let q = clamp((uv.y - originY) / max(branchLength, 0.001), 0.0, 1.0);
  let branchEnabled = step(originY, frontY);
  let gate = step(originY, uv.y) * (1.0 - step(originY + branchLength, uv.y)) * branchEnabled;
  let anchor = baseX + lightningPath(originY, seed, tilt, style);
  let w1 = noise2(vec2f(q * (11.0 + seed * 5.0), seed * 311.0));
  let w2 = noise2(vec2f(q * 28.0 + seed * 4.0, seed * 571.0));
  let spread = (0.050 + seed * 0.075) * direction;
  let bx = anchor + q * spread + (w1 - 0.5) * 0.036 + (w2 - 0.5) * 0.014;
  let d = abs(uv.x - bx);
  let core = exp(-d * thickness) * gate * (1.0 - q * 0.32);
  let glow = exp(-d * thickness * 0.068) * gate * (1.0 - q * 0.46);
  return vec2f(core, glow);
}

fn boltMask(uv: vec2f, a: vec4f, b: vec4f) -> vec3f {
  let x = a.x; let depth = a.y; let power = a.z; let age = a.w;
  let seed = b.x; let tilt = b.y; let style = b.z; let branchiness = b.w;
  if (power <= 0.001 || age < 0.0) { return vec3f(0.0); }
  let lead = mix(0.065, 0.16, power);
  var endY = 0.775 + depth * 0.035;
  if (style > 2.5) { endY = 0.54 + seed * 0.15; }
  let progress = clamp(age / max(lead, 0.001), 0.0, 1.0);
  let frontY = progress * endY;
  let reveal = 1.0 - smoothstep(frontY - 0.007, frontY + 0.020, uv.y);
  let terminal = 1.0 - smoothstep(endY - 0.008, endY + 0.014, uv.y);
  let baseX = 0.5 + x * (0.40 - depth * 0.05);
  let path = baseX + lightningPath(uv.y, seed, tilt, style) * (1.0 - depth * 0.20);
  let d = abs(uv.x - path);
  let depthFade = mix(1.0, 0.58, depth);
  var core = exp(-d * mix(920.0, 1450.0, power)) * reveal * terminal * depthFade;
  var glow = exp(-d * mix(34.0, 62.0, power)) * reveal * terminal * mix(1.0, 0.70, depth);
  let r1 = hash21(vec2f(seed * 113.0, 1.7));
  let r2 = hash21(vec2f(seed * 197.0, 3.1));
  let r3 = hash21(vec2f(seed * 271.0, 5.9));
  let r4 = hash21(vec2f(seed * 349.0, 9.4));
  let b1 = branchMask(uv, baseX, 0.16 + r1 * 0.18, 0.12 + r2 * 0.18, select(-1.0, 1.0, r3 > 0.5), fract(seed * 2.71 + 0.13), tilt, style, frontY, 650.0);
  let b2 = branchMask(uv, baseX, 0.37 + r2 * 0.16, 0.13 + r3 * 0.20, select(-1.0, 1.0, r4 > 0.5), fract(seed * 4.37 + 0.31), tilt * 0.75, style, frontY, 590.0);
  let b3 = branchMask(uv, baseX, 0.55 + r3 * 0.13, 0.10 + r4 * 0.17, select(-1.0, 1.0, r1 > 0.5), fract(seed * 7.19 + 0.57), tilt * 0.55, style, frontY, 540.0);
  var branchScale = branchiness * depthFade;
  if (style > 0.5 && style < 1.5) { branchScale *= 0.46; }
  if (style > 1.5 && style < 2.5) { branchScale *= 1.18; }
  core += (b1.x * 0.66 + b2.x * 0.55 + b3.x * 0.44) * branchScale * reveal;
  glow += (b1.y + b2.y + b3.y) * branchScale * 0.20 * reveal;
  let leaderHead = exp(-abs(uv.y - frontY) * 115.0) * exp(-abs(uv.x - path) * 48.0) * step(age, lead) * terminal;
  return vec3f(core, glow, leaderHead);
}

fn sdSegment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00001), 0.0, 1.0);
  return length(pa - ba * h);
}

fn rainLayer(uv: vec2f, time: f32, amount: f32, cells: vec2f, speed: f32, slant: f32, seedOffset: f32, thickness: f32) -> f32 {
  let scaled = uv * cells;
  let tile = floor(scaled);
  let rnd = hash21(tile + vec2f(seedOffset, seedOffset * 1.73));
  let local = fract(scaled + vec2f(rnd * 0.71, -time * speed + rnd * 5.31));
  let startP = vec2f(0.18 + rnd * 0.62, 0.08);
  let endP = startP + vec2f(slant * (0.55 + rnd * 0.45), 0.48 + rnd * 0.34);
  let dist = sdSegment(local, startP, endP);
  let line = 1.0 - smoothstep(thickness, thickness * 2.8, dist);
  let gate = step(1.0 - amount * 0.72, hash21(tile * 1.91 + vec2f(seedOffset * 4.0)));
  return line * gate * (0.36 + rnd * 0.64);
}

fn cloudDensity3d(worldPos: vec3f, time: f32, wind: f32, densityControl: f32) -> f32 {
  let drift = vec3f(time * 0.025 * wind, 0.0, time * 0.010 * wind);
  let q = (worldPos + drift) * 0.62;
  let broad = fbm3(q.xz + vec2f(q.y * 0.31, q.y * 0.13));
  let detail = fbm3(q.xy * 1.38 + vec2f(q.z * 0.28, time * 0.008));
  let shape = broad * 0.72 + detail * 0.28;
  let heightMask = smoothstep(1.05, 1.38, worldPos.y) * (1.0 - smoothstep(3.05, 3.72, worldPos.y));
  let distanceMask = 1.0 - smoothstep(10.0, 15.0, worldPos.z);
  return smoothstep(0.47 - densityControl * 0.12, 0.72, shape) * heightMask * distanceMask;
}

fn volumeLightning(worldPos: vec3f) -> vec3f {
  var glow = vec3f(0.0);
  for (var i = 0; i < 4; i++) {
    let a = boltA(i); let c = boltC(i);
    if (a.z <= 0.001 || c.w <= 0.001) { continue; }
    let boltWorldX = a.x * 3.2;
    let boltWorldZ = 1.4 + a.y * 6.0;
    let radial = distance(worldPos.xz, vec2f(boltWorldX, boltWorldZ));
    let vertical = smoothstep(0.10, 0.55, worldPos.y) * (1.0 - smoothstep(2.85, 3.45, worldPos.y));
    let scatter = exp(-radial * mix(4.8, 2.2, a.z)) * vertical * c.w;
    glow += c.xyz * scatter * (0.95 + a.z * 2.8);
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
  let time = u.resolutionTime.z;
  let playbackTime = u.resolutionTime.w;
  let energy = u.audio0.x; let sub = u.audio0.y; let bass = u.audio0.z; let lowMid = u.audio0.w;
  let vocal = u.audio1.x; let high = u.audio1.y; let air = u.audio1.z; let onset = u.audio1.w;
  let drums = u.audio2.x; let instrumental = u.audio2.y; let mood = u.audio2.z; let sectionEnergy = u.audio2.w;
  let cloudControl = u.environment.x; let wind = u.environment.y; let rainAmount = u.environment.z; let exposure = u.environment.w;
  let kick = u.frameMeta.z; let snare = u.frameMeta.w;

  let paletteHue = fract(0.54 + mood * 0.58 + vocal * 0.18 + high * 0.11 + playbackTime * 0.0045);
  let paletteA = hsv2rgb(vec3f(paletteHue, 0.72, 0.78));
  let paletteB = hsv2rgb(vec3f(fract(paletteHue + 0.19 + high * 0.08), 0.76, 0.70));
  let paletteDark = hsv2rgb(vec3f(fract(paletteHue + 0.04), 0.58, 0.11));

  let shake = vec2f(sin(time * 31.0 + sub * 7.0) * kick * 0.010 + sin(time * 11.0) * snare * 0.004, cos(time * 27.0 + bass * 5.0) * kick * 0.007);
  let p = vec2f((screen.x - 0.5) * aspect, 0.5 - screen.y) + shake;
  let fov = 1.04 - kick * 0.17;

  var cameraPos = vec3f(0.0, 0.92 + bass * 0.035, -3.85 + kick * 0.24);
  cameraPos.x += sin(time * 0.13) * 0.055;
  let lookPoint = vec3f(sin(time * 0.07) * 0.08, 0.68, 2.35);
  let forwardDir = normalize(lookPoint - cameraPos);
  let rightDir = normalize(cross(forwardDir, vec3f(0.0, 1.0, 0.0)));
  let upDir = normalize(cross(rightDir, forwardDir));
  let rayDir = normalize(forwardDir * 1.55 + rightDir * p.x * fov + upDir * p.y * fov);

  let skyTop = paletteDark * 0.23 + vec3f(0.002, 0.004, 0.009);
  let skyHorizon = paletteDark * 0.48 + paletteA * (0.022 + mood * 0.020);
  let skyBlend = clamp(0.42 - rayDir.y * 0.82, 0.0, 1.0);
  var color = mix(skyTop, skyHorizon, skyBlend);

  var groundDistance = 1000.0;
  if (rayDir.y < -0.025) { groundDistance = -cameraPos.y / rayDir.y; }
  let marchEnd = min(11.0, groundDistance);
  var cloudTransmit = 1.0;
  var cloudLight = vec3f(0.0);
  if (marchEnd > 0.45) {
    let stepSize = (marchEnd - 0.45) / 10.0;
    for (var march = 0; march < 10; march++) {
      let t = 0.45 + (f32(march) + 0.5) * stepSize;
      let worldPos = cameraPos + rayDir * t;
      let density = cloudDensity3d(worldPos, time, wind, cloudControl);
      if (density > 0.005) {
        let electric = volumeLightning(worldPos);
        let silver = pow(clamp(density + high * 0.12, 0.0, 1.0), 2.2) * (0.020 + air * 0.035);
        let cloudBase = vec3f(0.018, 0.021, 0.029) + paletteDark * 0.11 + paletteB * silver;
        let scatter = cloudBase + electric * (0.72 + density * 0.58);
        let alpha = 1.0 - exp(-density * stepSize * (0.82 + cloudControl * 0.45));
        cloudLight += cloudTransmit * alpha * scatter;
        cloudTransmit *= (1.0 - alpha);
      }
    }
  }
  color = color * cloudTransmit + cloudLight;

  if (groundDistance > 0.0 && groundDistance < 100.0) {
    let world = cameraPos + rayDir * groundDistance;
    let waveA = noise2(world.xz * vec2f(0.55, 1.75) + vec2f(time * 0.035, -time * 0.070));
    let waveB = noise2(world.xz * vec2f(2.2, 5.0) + vec2f(-time * 0.045, time * 0.11));
    let wave = waveA * 0.70 + waveB * 0.30;
    let horizonFog = exp(-groundDistance * 0.075);
    var groundColor = vec3f(0.004, 0.008, 0.012) + paletteDark * (0.11 + wave * 0.08);
    let bassSheen = pow(clamp(1.0 - abs(wave - 0.52) * 3.2, 0.0, 1.0), 3.0) * (0.012 + bass * 0.030);
    groundColor += paletteA * bassSheen;
    for (var i = 0; i < 4; i++) {
      let a = boltA(i); let c = boltC(i);
      if (a.z <= 0.001 || c.w <= 0.001) { continue; }
      let boltWorldX = a.x * 3.2;
      let boltWorldZ = 1.4 + a.y * 6.0;
      let dx = abs(world.x - boltWorldX);
      let dz = abs(world.z - boltWorldZ);
      let reflected = exp(-dx * 2.8) * exp(-dz * 0.33) * c.w * (0.50 + a.z * 0.90);
      let rippleRadius = max(0.0, a.w - mix(0.065, 0.16, a.z)) * (1.4 + a.z * 0.9);
      let rippleDistance = distance(world.xz, vec2f(boltWorldX, boltWorldZ));
      let ripple = exp(-abs(rippleDistance - rippleRadius) * 8.0) * c.w * 0.20;
      groundColor += c.xyz * (reflected + ripple);
    }
    let fogColor = paletteDark * 0.30 + paletteA * 0.020;
    color = mix(fogColor, groundColor, horizonFog);
  }

  var lightningColor = vec3f(0.0);
  var flashSum = 0.0;
  for (var i = 0; i < 4; i++) {
    let a = boltA(i); let b = boltB(i); let c = boltC(i);
    let mask = boltMask(screen, a, b);
    lightningColor += c.xyz * (mask.x * 2.65 + mask.y * 0.34 + mask.z * 1.10) * (0.52 + a.z * 0.78);
    flashSum += c.w;
  }
  color += lightningColor;
  color += paletteA * kick * (0.035 + energy * 0.025);
  color += paletteB * snare * 0.025;
  color += vec3f(0.70, 0.78, 0.95) * clamp(flashSum, 0.0, 2.5) * 0.025;

  let vocalFog = exp(-abs(p.y + 0.02) * 3.6) * vocal * (0.035 + lowMid * 0.045);
  color += paletteB * vocalFog * (0.55 + instrumental * 0.18);

  var rain = 0.0;
  rain += rainLayer(screen, time, rainAmount, vec2f(58.0, 15.0), 2.3 + energy * 1.0, 0.10 + wind * 0.028, 1.7, 0.018);
  rain += rainLayer(screen, time, rainAmount, vec2f(92.0, 20.0), 3.2 + drums * 1.3, 0.075 + wind * 0.020, 5.9, 0.015) * 0.72;
  rain += rainLayer(screen, time, rainAmount, vec2f(136.0, 26.0), 4.2 + high * 1.5, 0.050 + wind * 0.016, 11.4, 0.013) * 0.48;
  let rainColor = mix(vec3f(0.28, 0.38, 0.52), paletteA, 0.28 + mood * 0.18);
  color += rainColor * rain * (0.14 + rainAmount * 0.40 + air * 0.08);

  let drumLight = kick * 0.055 + snare * 0.030 + onset * 0.012;
  color += paletteA * drumLight * (0.65 + sectionEnergy * 0.35);
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
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}
@fragment
fn fs(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
  let res = max(u.resolutionTime.xy, vec2f(1.0));
  let uv = fragCoord.xy / res;
  let texel = 1.0 / res;
  let kick = u.frameMeta.z;
  let snare = u.frameMeta.w;
  let zoom = 1.0 - kick * 0.018;
  let sampleUv = (uv - 0.5) * zoom + 0.5;
  let center = textureSample(sceneTex, samp, sampleUv).rgb;
  let h1 = textureSample(sceneTex, samp, sampleUv + vec2f(texel.x * 2.5, 0.0)).rgb;
  let h2 = textureSample(sceneTex, samp, sampleUv - vec2f(texel.x * 2.5, 0.0)).rgb;
  let h3 = textureSample(sceneTex, samp, sampleUv + vec2f(texel.x * 6.0, 0.0)).rgb;
  let h4 = textureSample(sceneTex, samp, sampleUv - vec2f(texel.x * 6.0, 0.0)).rgb;
  let v1 = textureSample(sceneTex, samp, sampleUv + vec2f(0.0, texel.y * 2.0)).rgb;
  let v2 = textureSample(sceneTex, samp, sampleUv - vec2f(0.0, texel.y * 2.0)).rgb;
  let blur = center * 0.32 + (h1 + h2) * 0.15 + (h3 + h4) * 0.065 + (v1 + v2) * 0.12;
  let lum = dot(blur, vec3f(0.2126, 0.7152, 0.0722));
  let bright = max(0.0, lum - 0.38);
  let bloomGain = 0.46 + u.audio1.w * 0.20 + kick * 0.24 + snare * 0.12 + min(1.0, u.frameMeta.y / 4.0) * 0.12;
  var color = center + blur * bright * bloomGain;
  let chroma = (kick * 0.75 + snare * 0.25) * texel.x * 1.8;
  let redSample = textureSample(sceneTex, samp, sampleUv + vec2f(chroma, 0.0)).r;
  let blueSample = textureSample(sceneTex, samp, sampleUv - vec2f(chroma, 0.0)).b;
  color.r = mix(color.r, redSample, kick * 0.10);
  color.b = mix(color.b, blueSample, kick * 0.10);
  color = aces(color);
  let vignetteDistance = distance(uv, vec2f(0.5));
  color *= 1.0 - smoothstep(0.43, 0.82, vignetteDistance) * 0.26;
  let grain = fract(sin(dot(uv * res + u.resolutionTime.z * 13.0, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
  color += grain * (0.0045 + u.audio0.x * 0.0025);
  color = pow(max(color, vec3f(0.0)), vec3f(0.94));
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
    this.renderScale = 0.68;
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
    const kickPulse = clamp((sample.kick || 0) * 1.15 + (sample.onset || 0) * 0.08, 0, 1);
    const snarePulse = clamp((sample.snare || 0) * 1.05, 0, 1);

    const u = new Float32Array(72);
    u.set([this.canvas.width, this.canvas.height, now, playbackTime], 0);
    u.set([sample.energy || 0, sample.sub || 0, sample.bass || 0, sample.lowMid || 0], 4);
    u.set([(sample.vocal || 0) * this.controls.vocal, sample.high || 0, sample.air || 0, sample.onset || 0], 8);
    u.set([sample.drums || 0, sample.instrumental || 0, sample.mood ?? 0.5, sample.sectionEnergy || 0], 12);
    u.set([cloudDensity, wind, rain, exposure], 16);
    u.set([this.renderScale, bolts.length, kickPulse, snarePulse], 20);

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
