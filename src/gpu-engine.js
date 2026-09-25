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

fn lightningPath(y: f32, seed: f32, tilt: f32) -> f32 {
  let n1 = noise2(vec2f(y * 5.5, seed * 91.7));
  let n2 = noise2(vec2f(y * 18.0 + seed * 3.0, seed * 211.0));
  let zig = (n1 - 0.5) * 0.20 + (n2 - 0.5) * 0.075;
  return zig + (y - 0.5) * tilt;
}

fn boltMask(uv: vec2f, baseX: f32, seed: f32, tilt: f32, power: f32) -> vec2f {
  let path = baseX + lightningPath(uv.y, seed, tilt);
  let d = abs(uv.x - path);
  let core = exp(-d * mix(520.0, 820.0, power));
  let glow = exp(-d * mix(34.0, 55.0, power));

  var branch = 0.0;
  let branchGateA = smoothstep(0.22, 0.30, uv.y) * (1.0 - smoothstep(0.56, 0.68, uv.y));
  let branchXA = path + (uv.y - 0.32) * (0.34 + seed * 0.22) + (noise2(vec2f(uv.y * 21.0, seed * 71.0)) - 0.5) * 0.05;
  branch += exp(-abs(uv.x - branchXA) * 410.0) * branchGateA;

  let branchGateB = smoothstep(0.48, 0.57, uv.y) * (1.0 - smoothstep(0.84, 0.93, uv.y));
  let branchXB = path - (uv.y - 0.56) * (0.22 + seed * 0.25) + (noise2(vec2f(uv.y * 17.0, seed * 131.0)) - 0.5) * 0.05;
  branch += exp(-abs(uv.x - branchXB) * 460.0) * branchGateB;
  return vec2f(core + branch * 0.72, glow + branch * 0.25);
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
  let bolt = boltMask(boltUv, boltX, seed, tilt, boltPower);
  let lightningColor = u.lightningColor.rgb;
  let core = bolt.x * flash * (1.5 + boltPower * 2.8);
  let glow = bolt.y * flash * (0.65 + boltPower * 1.8);

  let cloudPulseNoise = fbm(p * 1.6 + vec2f(seed * 8.0, time * 0.02));
  let cloudPulse = flash * smoothstep(0.40, 0.82, cloudPulseNoise) * (0.25 + cloudAlpha * 0.95);
  color += lightningColor * cloudPulse * (0.8 + boltPower * 1.6);
  color += lightningColor * glow;
  color += mix(lightningColor, vec3f(1.0), 0.72) * core;

  let ambientElectric = high * sectionEnergy * (0.035 + transient * 0.09);
  color += vec3f(0.20, 0.31, 0.56) * ambientElectric * cloudAlpha;

  let rain = rainMask(vec2f(uv.x + uv.y * 0.12, uv.y), time, rainAmount);
  color += vec3f(0.38, 0.55, 0.75) * rain * (0.12 + energy * 0.26);

  let flashWash = flash * (0.035 + boltPower * 0.18) * exp(-eventAge * 4.5);
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
    this.lightning = { start: -999, power: 0, seed: 0.3, hue: 0.62, x: 0, tilt: 0 };
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

  setAutoQuality(enabled) { this.autoQuality = !!enabled; }

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
    this.lightning = {
      start: performance.now() * 0.001,
      power: Math.max(0.2, event.power || 0.5),
      seed: event.seed ?? Math.random(),
      hue: event.hue ?? 0.62,
      x: -0.32 + (event.seed ?? Math.random()) * 0.64,
      tilt: ((event.seed ?? 0.5) - 0.5) * 0.22,
    };
  }

  render(sample, playbackTime = 0) {
    if (!this.device || !this.pipeline) return;
    const nowMs = performance.now();
    const now = nowMs * 0.001;
    const age = Math.max(0, now - this.lightning.start);
    let flash = 0;
    if (age < 0.58) {
      const primary = Math.exp(-age * 13.0);
      const reflash = Math.exp(-Math.pow((age - 0.095) * 45, 2)) * 0.52;
      const micro = 0.84 + Math.sin(age * 180 + this.lightning.seed * 40) * 0.16;
      flash = Math.max(0, (primary + reflash) * micro) * (0.55 + this.lightning.power * 0.8);
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
    u.set([this.lightning.tilt, age, 0, 0], 16);
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
