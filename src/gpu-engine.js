const shaderCode = /* wgsl */ `
struct Uniforms {
  resolutionTime: vec4f,
  audio0: vec4f,
  audio1: vec4f,
  lightning0: vec4f,
  lightning1: vec4f,
  lightningColor: vec4f,
  environment: vec4f,
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

fn fbm(p0: vec2f) -> f32 {
  var p = p0;
  var amp = 0.53;
  var sum = 0.0;
  for (var i = 0; i < 5; i++) {
    sum += noise2(p) * amp;
    p = mat2x2f(1.62, 1.17, -1.17, 1.62) * p + 13.7;
    amp *= 0.48;
  }
  return sum;
}

fn cloudLayer(uv: vec2f, depth: f32, time: f32, wind: f32) -> f32 {
  let drift = vec2f(time * (0.010 + depth * 0.009) * wind, time * 0.0025);
  let p = uv * (1.7 + depth * 1.9) + drift + vec2f(depth * 7.2, depth * 2.7);
  let warp = vec2f(fbm(p * 0.72 + 9.0), fbm(p * 0.63 - 5.0)) - 0.5;
  return fbm(p + warp * 1.25);
}

fn lightningPath(y: f32, seed: f32, tilt: f32, style: f32) -> f32 {
  var coarseFreq = 4.2;
  var fineFreq = 17.0;
  var coarseAmp = 0.17;
  var fineAmp = 0.060;
  var curve = 0.0;

  if (style < 0.5) {
    coarseFreq = 5.4;
    fineFreq = 19.0;
    coarseAmp = 0.17;
    fineAmp = 0.064;
    curve = sin(y * 7.0 + seed * 11.0) * 0.028;
  } else if (style < 1.5) {
    coarseFreq = 3.1;
    fineFreq = 12.0;
    coarseAmp = 0.095;
    fineAmp = 0.038;
    curve = (y - 0.5) * (y - 0.5) * sign(tilt + 0.0001) * 0.11;
  } else if (style < 2.5) {
    coarseFreq = 6.7;
    fineFreq = 25.0;
    coarseAmp = 0.22;
    fineAmp = 0.082;
    curve = sin(y * 12.0 + seed * 23.0) * 0.045;
  } else {
    coarseFreq = 2.5;
    fineFreq = 10.0;
    coarseAmp = 0.24;
    fineAmp = 0.052;
    curve = sin(y * 4.1 + seed * 19.0) * 0.09;
  }

  let n1 = noise2(vec2f(y * coarseFreq + seed * 2.7, seed * 91.7));
  let n2 = noise2(vec2f(y * fineFreq + seed * 7.1, seed * 211.0));
  let zig = (n1 - 0.5) * coarseAmp + (n2 - 0.5) * fineAmp;
  return zig + (y - 0.5) * tilt + curve;
}

fn branchMask(
  uv: vec2f,
  baseX: f32,
  originY: f32,
  branchLength: f32,
  direction: f32,
  seed: f32,
  tilt: f32,
  style: f32,
  thickness: f32
) -> vec2f {
  let q = clamp((uv.y - originY) / max(branchLength, 0.001), 0.0, 1.0);
  let gate = step(originY, uv.y) * (1.0 - step(originY + branchLength, uv.y));
  let anchor = baseX + lightningPath(originY, seed, tilt, style);
  let wobbleA = noise2(vec2f(q * (11.0 + seed * 7.0), seed * 311.0));
  let wobbleB = noise2(vec2f(q * 29.0 + seed * 4.0, seed * 571.0));
  let spread = (0.075 + seed * 0.12) * direction;
  let bx = anchor + q * spread + (wobbleA - 0.5) * 0.055 + (wobbleB - 0.5) * 0.022;
  let d = abs(uv.x - bx);
  let core = exp(-d * thickness) * gate * (1.0 - q * 0.35);
  let glow = exp(-d * (thickness * 0.085)) * gate * (1.0 - q * 0.46);
  return vec2f(core, glow);
}

fn boltMask(
  uv: vec2f,
  baseX: f32,
  seed: f32,
  tilt: f32,
  power: f32,
  style: f32,
  branchiness: f32,
  eventAge: f32
) -> vec3f {
  let leaderDuration = mix(0.18, 0.075, power);
  var endY = 0.985;
  if (style > 2.5) {
    endY = 0.74 + seed * 0.12;
  }

  let progress = clamp(eventAge / max(leaderDuration, 0.001), 0.0, 1.0);
  let frontY = progress * endY;
  let reveal = 1.0 - smoothstep(frontY - 0.010, frontY + 0.026, uv.y);
  let terminal = 1.0 - smoothstep(endY - 0.010, endY + 0.018, uv.y);

  let path = baseX + lightningPath(uv.y, seed, tilt, style);
  let d = abs(uv.x - path);
  var coreWidth = mix(520.0, 900.0, power);
  if (style > 1.5 && style < 2.5) {
    coreWidth *= 0.82;
  }
  if (style > 0.5 && style < 1.5) {
    coreWidth *= 1.18;
  }

  var core = exp(-d * coreWidth) * reveal * terminal;
  var glow = exp(-d * mix(30.0, 58.0, power)) * reveal * terminal;

  let r1 = hash21(vec2f(seed * 113.0, 1.7));
  let r2 = hash21(vec2f(seed * 197.0, 3.1));
  let r3 = hash21(vec2f(seed * 271.0, 5.9));
  let r4 = hash21(vec2f(seed * 349.0, 9.4));

  let b1 = branchMask(
    uv, baseX,
    0.16 + r1 * 0.20,
    0.17 + r2 * 0.24,
    select(-1.0, 1.0, r3 > 0.5),
    fract(seed * 2.71 + 0.13),
    tilt, style,
    mix(360.0, 540.0, power)
  );

  let b2 = branchMask(
    uv, baseX,
    0.38 + r2 * 0.20,
    0.16 + r3 * 0.28,
    select(-1.0, 1.0, r4 > 0.5),
    fract(seed * 4.37 + 0.31),
    tilt * 0.75, style,
    mix(330.0, 500.0, power)
  );

  let b3 = branchMask(
    uv, baseX,
    0.58 + r3 * 0.16,
    0.12 + r4 * 0.24,
    select(-1.0, 1.0, r1 > 0.5),
    fract(seed * 7.19 + 0.57),
    tilt * 0.55, style,
    mix(300.0, 470.0, power)
  );

  var branchScale = branchiness;
  if (style > 0.5 && style < 1.5) {
    branchScale *= 0.42;
  }
  if (style > 1.5 && style < 2.5) {
    branchScale *= 1.25;
  }

  core += (b1.x * (0.55 + r2 * 0.40) + b2.x * (0.48 + r3 * 0.42) + b3.x * (0.38 + r4 * 0.42)) * branchScale * reveal;
  glow += (b1.y + b2.y + b3.y) * branchScale * 0.34 * reveal;

  if (style > 1.5 && style < 2.5) {
    let splitGate = smoothstep(0.11, 0.18, uv.y) * (1.0 - smoothstep(0.58, 0.72, uv.y));
    let splitOffset = 0.045 + r2 * 0.065;
    let splitPath = path + select(-splitOffset, splitOffset, r1 > 0.5);
    let sd = abs(uv.x - splitPath);
    core += exp(-sd * 540.0) * splitGate * reveal * 0.62;
    glow += exp(-sd * 37.0) * splitGate * reveal * 0.24;
  }

  if (style > 2.5) {
    let sideFork = branchMask(
      uv, baseX,
      0.19 + r4 * 0.12,
      0.30 + r1 * 0.16,
      select(-1.0, 1.0, r2 > 0.5),
      fract(seed * 11.11 + 0.77),
      tilt * 1.2, style,
      380.0
    );
    core += sideFork.x * branchScale * 0.72 * reveal;
    glow += sideFork.y * branchScale * 0.29 * reveal;
  }

  let leaderHead = exp(-abs(uv.y - frontY) * 95.0)
    * exp(-abs(uv.x - path) * 42.0)
    * step(eventAge, leaderDuration)
    * terminal;

  return vec3f(core, glow, leaderHead);
}

fn rainMask(uv: vec2f, time: f32, amount: f32) -> f32 {
  let p = uv * vec2f(82.0, 38.0);
  let cell = floor(p);
  let r = hash21(cell);
  let speed = 1.7 + r * 2.8;
  let local = fract(p + vec2f(r * 4.0, time * speed));
  let x = abs(local.x - 0.5);
  let streak = smoothstep(0.055, 0.0, x) * smoothstep(0.84, 0.18, local.y);
  let alive = step(1.0 - amount * 0.82, r);
  return streak * alive * (0.25 + r * 0.55);
}

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vertexIndex], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let res = u.resolutionTime.xy;
  let time = u.resolutionTime.z;
  let aspect = res.x / max(1.0, res.y);
  var uv = pos.xy / res;
  var p = uv * 2.0 - 1.0;
  p.x *= aspect;

  let energy = u.audio0.x;
  let bass = u.audio0.y;
  let mid = u.audio0.z;
  let high = u.audio0.w;
  let transient = u.audio1.x;
  let sectionEnergy = u.audio1.y;
  let rainAmount = u.audio1.z;

  let flash = u.lightning0.x;
  let boltPower = u.lightning0.y;
  let seed = u.lightning0.z;
  let boltX = u.lightning0.w;
  let tilt = u.lightning1.x;
  let eventAge = u.lightning1.y;
  let style = u.lightning1.z;
  let branchiness = u.lightning1.w;
  let cloudDensity = u.environment.x;
  let wind = u.environment.y;
  let exposure = u.environment.z;

  let top = vec3f(0.008, 0.012, 0.026);
  let horizon = vec3f(0.026, 0.040, 0.068);
  var color = mix(horizon, top, smoothstep(-0.45, 0.95, p.y));

  var cloudAlpha = 0.0;
  var cloudLight = vec3f(0.0);
  let cloudUv = vec2f(p.x * 0.66, p.y * 0.82 - 0.12);
  for (var i = 0; i < 7; i++) {
    let depth = f32(i) / 6.0;
    let n = cloudLayer(cloudUv + vec2f(depth * 0.12, depth * -0.025), depth, time, wind);
    let vertical = smoothstep(-0.92, -0.35, p.y) * (1.0 - smoothstep(0.30, 1.10, p.y));
    let threshold = 0.50 - cloudDensity * 0.13 + depth * 0.018;
    let d = smoothstep(threshold, threshold + 0.16, n) * vertical;
    let front = d * (1.0 - cloudAlpha) * (0.55 + depth * 0.24);
    let silver = pow(clamp(n, 0.0, 1.0), 5.0) * (0.05 + high * 0.10);
    let cloudBase = vec3f(0.045, 0.055, 0.075) + vec3f(silver);
    cloudLight += cloudBase * front;
    cloudAlpha += front;
  }
  color = mix(color, cloudLight / max(cloudAlpha, 0.18), clamp(cloudAlpha, 0.0, 0.92));

  let boltUv = vec2f(p.x / max(aspect, 0.1), (p.y + 1.0) * 0.5);
  let bolt = boltMask(boltUv, boltX, seed, tilt, boltPower, style, branchiness, eventAge);
  let lightningColor = u.lightningColor.rgb;
  let leaderDuration = mix(0.18, 0.075, boltPower);
  let impactGate = smoothstep(leaderDuration * 0.80, leaderDuration + 0.035, eventAge);

  let core = bolt.x * flash * (1.45 + boltPower * 3.0);
  let glow = bolt.y * flash * (0.58 + boltPower * 2.0);
  let leaderHead = bolt.z * (0.85 + boltPower * 2.0);

  let cloudPulseNoise = fbm(p * 1.6 + vec2f(seed * 8.0, time * 0.02));
  let cloudPulse = flash * impactGate * smoothstep(0.40, 0.82, cloudPulseNoise) * (0.25 + cloudAlpha * 0.95);
  color += lightningColor * cloudPulse * (0.72 + boltPower * 1.8);
  color += lightningColor * glow;
  color += mix(lightningColor, vec3f(1.0), 0.76) * core;
  color += mix(lightningColor, vec3f(1.0), 0.88) * leaderHead;

  let ambientElectric = high * sectionEnergy * (0.035 + transient * 0.09);
  color += vec3f(0.20, 0.31, 0.56) * ambientElectric * cloudAlpha;

  let rain = rainMask(vec2f(uv.x + uv.y * 0.12, uv.y), time, rainAmount);
  color += vec3f(0.38, 0.55, 0.75) * rain * (0.12 + energy * 0.26);

  let impactAge = max(0.0, eventAge - leaderDuration);
  let flashWash = flash * impactGate * (0.035 + boltPower * 0.18) * exp(-impactAge * 4.5);
  color += lightningColor * flashWash;

  let vignette = smoothstep(1.28, 0.25, length(p * vec2f(0.78, 0.92)));
  color *= mix(0.56, 1.0, vignette);
  color *= exposure * (0.88 + energy * 0.28 + bass * 0.08);

  let grain = hash21(pos.xy + vec2f(time * 59.0, time * 17.0)) - 0.5;
  color += grain * 0.010;
  color = color / (color + vec3f(1.0));
  color = pow(max(color, vec3f(0.0)), vec3f(0.86));
  return vec4f(color, 1.0);
}
`;

function hslToRgb(h, s, l) {
  const hue2rgb = (p, q, t) => {
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

function fract(v) {
  return v - Math.floor(v);
}

function seeded(seed, salt) {
  return fract(Math.sin(seed * 913.71 + salt * 77.13) * 43758.5453123);
}

export class StormRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.device = null;
    this.context = null;
    this.pipeline = null;
    this.uniformBuffer = null;
    this.bindGroup = null;
    this.renderScale = 0.62;
    this.autoQuality = true;
    this.frameSamples = [];
    this.lastQualityCheck = performance.now();
    this.lastFrameTime = performance.now();
    this.lightning = {
      start: -999,
      power: 0,
      seed: 0.3,
      hue: 0.62,
      x: 0,
      tilt: 0,
      style: 0,
      branchiness: 0.5,
    };
  }

  async init() {
    if (!navigator.gpu) throw new Error('WebGPU недоступен в этом браузере.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('Не удалось получить WebGPU adapter.');
    this.device = await adapter.requestDevice();
    this.device.lost.then((info) => console.error('WebGPU device lost:', info));

    this.context = this.canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format, alphaMode: 'opaque' });

    const module = this.device.createShaderModule({ code: shaderCode });
    const compilation = await module.getCompilationInfo();
    const errors = compilation.messages.filter((m) => m.type === 'error');
    if (errors.length) {
      console.error('WGSL compilation errors:', errors);
      throw new Error('Ошибка компиляции WGSL: ' + errors[0].message);
    }

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 112,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    this.resize(true);
    return adapter.info || {};
  }

  setAutoQuality(enabled) {
    this.autoQuality = !!enabled;
  }

  resize(force = false) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.75);
    const maxWidth = 1200;
    let width = Math.max(2, Math.round(innerWidth * dpr * this.renderScale));
    let height = Math.max(2, Math.round(innerHeight * dpr * this.renderScale));
    if (width > maxWidth) {
      const k = maxWidth / width;
      width = maxWidth;
      height = Math.round(height * k);
    }
    if (force || this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  triggerLightning(event) {
    const seed = event.seed ?? Math.random();
    const power = Math.max(0.2, event.power || 0.5);
    const r1 = seeded(seed, 1);
    const r2 = seeded(seed, 2);
    const r3 = seeded(seed, 3);
    const r4 = seeded(seed, 4);
    const r5 = seeded(seed, 5);

    let style = 0;
    if (event.type === 'impact') {
      style = 2;
    } else if (event.type === 'fork') {
      style = r1 > 0.46 ? 0 : 1;
    } else {
      style = r2 > 0.52 ? 3 : 0;
    }
    if (power > 0.88 && r3 > 0.58) style = 2;

    let tiltRange = 0.42;
    if (style === 1) tiltRange = 0.22;
    if (style === 3) tiltRange = 0.82;

    const branchiness = Math.max(
      0.18,
      Math.min(1.0, (event.high || 0) * 0.66 + power * 0.46 + r5 * 0.24)
    );

    this.lightning = {
      start: performance.now() * 0.001,
      power,
      seed: fract(seed * 1.913 + r4 * 0.371),
      hue: fract((event.hue ?? 0.62) + (r3 - 0.5) * 0.10),
      x: -0.44 + r1 * 0.88,
      tilt: (r2 - 0.5) * tiltRange,
      style,
      branchiness,
    };
  }

  render(sample, playbackTime = 0) {
    if (!this.device || !this.pipeline) return;

    const nowMs = performance.now();
    const now = nowMs * 0.001;
    const age = Math.max(0, now - this.lightning.start);
    const leaderDuration = 0.18 + (0.075 - 0.18) * this.lightning.power;

    let flash = 0;
    if (age < leaderDuration) {
      const leadPulse = 0.64 + Math.sin(age * 150 + this.lightning.seed * 31) * 0.12;
      flash = Math.max(0.42, leadPulse) * (0.72 + this.lightning.power * 0.28);
    } else {
      const impactAge = age - leaderDuration;
      if (impactAge < 0.62) {
        const primary = Math.exp(-impactAge * 12.5);
        const reflash1 = Math.exp(-Math.pow((impactAge - 0.082) * 46, 2)) * (0.24 + this.lightning.power * 0.34);
        const reflash2 = Math.exp(-Math.pow((impactAge - 0.185) * 38, 2)) * (0.10 + this.lightning.branchiness * 0.20);
        const micro = 0.86 + Math.sin(impactAge * 205 + this.lightning.seed * 47) * 0.14;
        flash = Math.max(0, (primary + reflash1 + reflash2) * micro) * (0.62 + this.lightning.power * 0.92);
      }
    }

    const sectionType = sample.sectionType || 'steady';
    const sectionBoost = sectionType === 'climax' ? 0.15 : sectionType === 'drop' ? 0.10 : sectionType === 'build' ? 0.05 : 0;
    const rain = Math.min(1, 0.05 + sample.energy * 0.58 + sample.sectionEnergy * 0.30 + sectionBoost);
    const cloudDensity = Math.min(1, 0.38 + sample.energy * 0.25 + sample.bass * 0.14 + sample.sectionEnergy * 0.16);
    const wind = 0.55 + sample.mid * 0.45 + sample.high * 0.32;
    const exposure = 1.08 + sample.energy * 0.12;
    const rgb = hslToRgb(this.lightning.hue, 0.82, 0.66);

    const u = new Float32Array(28);
    u.set([this.canvas.width, this.canvas.height, playbackTime, 0], 0);
    u.set([sample.energy, sample.bass, sample.mid, sample.high], 4);
    u.set([sample.transient, sample.sectionEnergy, rain, 0], 8);
    u.set([flash, this.lightning.power, this.lightning.seed, this.lightning.x], 12);
    u.set([this.lightning.tilt, age, this.lightning.style, this.lightning.branchiness], 16);
    u.set([rgb[0], rgb[1], rgb[2], 0], 20);
    u.set([cloudDensity, wind, exposure, this.renderScale], 24);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, u);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    const dt = nowMs - this.lastFrameTime;
    this.lastFrameTime = nowMs;
    if (dt < 100) this.frameSamples.push(dt);
    if (this.frameSamples.length > 90) this.frameSamples.shift();
    this.maybeAdjustQuality(nowMs);
  }

  maybeAdjustQuality(nowMs) {
    if (!this.autoQuality || nowMs - this.lastQualityCheck < 2200 || this.frameSamples.length < 30) return;
    this.lastQualityCheck = nowMs;

    const sorted = [...this.frameSamples].sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    let next = this.renderScale;

    if (p75 > 20.5) next -= 0.06;
    else if (p75 > 18.1) next -= 0.035;
    else if (p75 < 14.8) next += 0.025;

    next = Math.max(0.42, Math.min(0.82, next));
    if (Math.abs(next - this.renderScale) >= 0.02) {
      this.renderScale = next;
      this.resize(true);
      this.frameSamples.length = 0;
    }
  }
}
