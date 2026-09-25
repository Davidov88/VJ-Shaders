const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

function percentile(values, p) {
  if (!values.length) return 1;
  const copy = Array.from(values).sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(copy.length - 1, Math.floor((copy.length - 1) * p)));
  return copy[idx] || 1;
}

function normalizeByPercentile(values, p = 0.96) {
  const scale = Math.max(1e-8, percentile(values, p));
  return values.map((v) => clamp01(v / scale));
}

function estimateBpm(frames, fps) {
  if (frames.length < fps * 8) return { bpm: 0, confidence: 0 };
  const signal = frames.map((f) => f.drums);
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const centered = signal.map((v) => Math.max(0, v - mean * 0.72));
  const minBpm = 72;
  const maxBpm = 180;
  const minLag = Math.max(1, Math.floor((fps * 60) / maxBpm));
  const maxLag = Math.min(centered.length - 2, Math.ceil((fps * 60) / minBpm));
  const scores = new Map();
  let bestLag = minLag;
  let bestScore = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let dot = 0;
    let aa = 0;
    let bb = 0;
    for (let i = lag; i < centered.length; i++) {
      const a = centered[i];
      const b = centered[i - lag];
      dot += a * b;
      aa += a * a;
      bb += b * b;
    }
    const norm = Math.sqrt(aa * bb) || 1;
    const bpm = (fps * 60) / lag;
    const tempoBias = 0.94 + 0.06 * Math.exp(-Math.pow((bpm - 126) / 34, 2));
    const score = (dot / norm) * tempoBias;
    scores.set(lag, score);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  let bpm = (fps * 60) / bestLag;
  if (bpm < 92) {
    const halfLag = Math.max(minLag, Math.round(bestLag / 2));
    const halfScore = scores.get(halfLag) ?? 0;
    if (halfScore > bestScore * 0.62) bpm *= 2;
  }

  return {
    bpm: Math.round(bpm),
    confidence: clamp01((bestScore - 0.08) / 0.42),
  };
}

function buildSections(frames, duration, fps) {
  const secondsPerSection = 4;
  const sectionFrames = Math.max(1, Math.round(secondsPerSection * fps));
  const raw = [];

  for (let start = 0; start < frames.length; start += sectionFrames) {
    const end = Math.min(frames.length, start + sectionFrames);
    let energy = 0, drums = 0, vocal = 0, high = 0, mood = 0;
    for (let i = start; i < end; i++) {
      const f = frames[i];
      energy += f.energy;
      drums += f.drums;
      vocal += f.vocal;
      high += f.high;
      mood += f.mood;
    }
    const count = Math.max(1, end - start);
    raw.push({
      start: start / fps,
      end: Math.min(duration, end / fps),
      energy: energy / count,
      drums: drums / count,
      vocal: vocal / count,
      high: high / count,
      mood: mood / count,
    });
  }

  for (let i = 0; i < raw.length; i++) {
    const prev = raw[Math.max(0, i - 1)];
    const next = raw[Math.min(raw.length - 1, i + 1)];
    const trend = next.energy - prev.energy;
    const s = raw[i];
    let type = 'steady';
    if (s.energy < 0.17) type = 'calm';
    if (trend > 0.10 && s.energy < 0.76) type = 'build';
    if (s.energy > 0.67 && s.drums > 0.34) type = 'drop';
    if (s.energy > 0.84 && s.drums > 0.28) type = 'climax';
    if (trend < -0.13 && s.energy < 0.58) type = 'release';
    if (i === 0 && s.energy < 0.46) type = 'intro';
    if (s.vocal > 0.62 && s.drums < 0.32) type = 'vocal';
    s.type = type;
    s.trend = trend;
  }

  const merged = [];
  for (const s of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.type === s.type && prev.end - prev.start < 16) {
      const a = prev.end - prev.start;
      const b = s.end - s.start;
      const total = a + b;
      prev.end = s.end;
      for (const key of ['energy', 'drums', 'vocal', 'high', 'mood']) {
        prev[key] = (prev[key] * a + s[key] * b) / total;
      }
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

function buildLightningEvents(frames, fps, bpm) {
  const scores = frames.map((f) => clamp01(
    f.drums * 0.48 + f.onset * 0.25 + f.bass * 0.12 + f.sub * 0.09 + f.energy * 0.06
  ));
  const adaptive = percentile(scores, 0.78);
  const events = [];
  let lastFrame = -9999;
  const beatSeconds = bpm > 0 ? 60 / bpm : 0.48;
  const minGap = Math.max(2, Math.round(fps * Math.min(0.14, Math.max(0.075, beatSeconds * 0.19))));

  for (let i = 2; i < frames.length - 2; i++) {
    const f = frames[i];
    const v = scores[i];
    const localPeak = v >= scores[i - 1] && v >= scores[i + 1] && v >= scores[i - 2] * 0.97;
    const threshold = Math.max(0.34, adaptive * 0.72) + (f.energy < 0.20 ? 0.13 : 0);
    if (!localPeak || v < threshold || f.energy < 0.10 || i - lastFrame < minGap) continue;

    const seed = ((i * 48271) % 2147483647) / 2147483647;
    const power = clamp01((v - threshold) / Math.max(0.16, 1 - threshold) * 0.70 + f.energy * 0.30);
    const leadTime = 0.065 + power * 0.095;
    const time = i / fps;
    const depth = 0.14 + (((i * 69621) % 9973) / 9973) * 0.76;
    const hue = (seed * 0.72 + f.mood * 0.31 + f.vocal * 0.23 + f.high * 0.17 + time * 0.009) % 1;
    let type = 'strike';
    if (power > 0.78) type = 'impact';
    else if (f.high > 0.64) type = 'fork';
    else if (f.vocal > 0.64 && f.drums < 0.56) type = 'arc';

    events.push({
      time,
      triggerTime: Math.max(0, time - leadTime),
      leadTime,
      power,
      seed,
      depth,
      hue,
      bass: f.bass,
      high: f.high,
      vocal: f.vocal,
      drums: f.drums,
      kick: f.kick,
      snare: f.snare,
      type,
    });
    lastFrame = i;
  }
  return events;
}

export async function analyzeAudioFile(file, onProgress = () => {}) {
  onProgress(0.03, 'Чтение файла');
  const arrayBuffer = await file.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const decodeCtx = new AudioCtx({ latencyHint: 'playback' });

  onProgress(0.09, 'Декодирование аудио');
  const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  await decodeCtx.close();

  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const channels = audioBuffer.numberOfChannels;
  const fps = 30;
  const hop = Math.max(256, Math.round(sampleRate / fps));
  const stride = sampleRate >= 44100 ? 2 : 1;
  const frameCount = Math.ceil(length / hop);
  const cutoffs = [90, 230, 850, 3300, 7600];
  const alphas = cutoffs.map((fc) => 1 - Math.exp(-2 * Math.PI * fc * stride / sampleRate));
  const states = Array.from({ length: channels }, () => new Float64Array(cutoffs.length));
  const channelData = Array.from({ length: channels }, (_, c) => audioBuffer.getChannelData(c));

  const raw = {
    energy: new Array(frameCount).fill(0),
    sub: new Array(frameCount).fill(0),
    bass: new Array(frameCount).fill(0),
    lowMid: new Array(frameCount).fill(0),
    vocalBand: new Array(frameCount).fill(0),
    high: new Array(frameCount).fill(0),
    air: new Array(frameCount).fill(0),
    peak: new Array(frameCount).fill(0),
  };

  onProgress(0.16, '6-полосная карта трека');
  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hop;
    const end = Math.min(length, start + hop);
    let energy = 0, sub = 0, bass = 0, lowMid = 0, vocalBand = 0, high = 0, air = 0, peak = 0;
    let samples = 0;

    for (let i = start; i < end; i += stride) {
      let e0 = 0, e1 = 0, e2 = 0, e3 = 0, e4 = 0, e5 = 0, e6 = 0;
      for (let c = 0; c < channels; c++) {
        const x = channelData[c][i] || 0;
        const s = states[c];
        s[0] += alphas[0] * (x - s[0]);
        s[1] += alphas[1] * (x - s[1]);
        s[2] += alphas[2] * (x - s[2]);
        s[3] += alphas[3] * (x - s[3]);
        s[4] += alphas[4] * (x - s[4]);
        const v0 = s[0];
        const v1 = s[1] - s[0];
        const v2 = s[2] - s[1];
        const v3 = s[3] - s[2];
        const v4 = s[4] - s[3];
        const v5 = x - s[4];
        e0 += x * x;
        e1 += v0 * v0;
        e2 += v1 * v1;
        e3 += v2 * v2;
        e4 += v3 * v3;
        e5 += v4 * v4;
        e6 += v5 * v5;
        peak = Math.max(peak, Math.abs(x));
      }
      const invChannels = 1 / Math.max(1, channels);
      energy += e0 * invChannels;
      sub += e1 * invChannels;
      bass += e2 * invChannels;
      lowMid += e3 * invChannels;
      vocalBand += e4 * invChannels;
      high += e5 * invChannels;
      air += e6 * invChannels;
      samples++;
    }

    const inv = 1 / Math.max(1, samples);
    raw.energy[frame] = Math.sqrt(energy * inv);
    raw.sub[frame] = Math.sqrt(sub * inv);
    raw.bass[frame] = Math.sqrt(bass * inv);
    raw.lowMid[frame] = Math.sqrt(lowMid * inv);
    raw.vocalBand[frame] = Math.sqrt(vocalBand * inv);
    raw.high[frame] = Math.sqrt(high * inv);
    raw.air[frame] = Math.sqrt(air * inv);
    raw.peak[frame] = peak;

    if ((frame & 63) === 0) {
      onProgress(0.16 + 0.48 * (frame / Math.max(1, frameCount)), '6-полосная карта трека');
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  onProgress(0.67, 'Нормализация и детекция атак');
  const n = {};
  for (const key of ['energy', 'sub', 'bass', 'lowMid', 'vocalBand', 'high', 'air']) {
    n[key] = normalizeByPercentile(raw[key], key === 'air' ? 0.975 : 0.965);
  }
  n.peak = normalizeByPercentile(raw.peak, 0.985);

  const frames = new Array(frameCount);
  let prevEnergy = n.energy[0] || 0;
  let prevSub = n.sub[0] || 0;
  let prevBass = n.bass[0] || 0;
  let prevHigh = n.high[0] || 0;
  let smoothEnergy = 0, smoothSub = 0, smoothBass = 0, smoothVocal = 0, smoothDrums = 0, smoothKick = 0, smoothSnare = 0, smoothMood = 0.5;

  for (let i = 0; i < frameCount; i++) {
    const energyRise = Math.max(0, n.energy[i] - prevEnergy);
    const subRise = Math.max(0, n.sub[i] - prevSub);
    const bassRise = Math.max(0, n.bass[i] - prevBass);
    const highRise = Math.max(0, n.high[i] - prevHigh);
    const crest = Math.max(0, n.peak[i] - n.energy[i]);
    const onset = clamp01(energyRise * 3.4 + bassRise * 2.2 + highRise * 1.45 + crest * 0.28);
    const kickRaw = clamp01(subRise * 5.2 + bassRise * 3.0 + onset * 0.34 + n.sub[i] * 0.10);
    const snareRaw = clamp01(highRise * 3.0 + energyRise * 1.35 + onset * 0.42 + n.lowMid[i] * 0.08 - kickRaw * 0.12);
    const drumsRaw = clamp01(kickRaw * 0.52 + snareRaw * 0.30 + onset * 0.35 + n.bass[i] * 0.18);
    const vocalRaw = clamp01((n.vocalBand[i] * 0.73 + n.lowMid[i] * 0.27) * (1 - onset * 0.48));
    const brightness = clamp01((n.high[i] * 0.52 + n.air[i] * 0.48) - (n.sub[i] * 0.24));
    const moodRaw = clamp01(0.31 + brightness * 0.46 + vocalRaw * 0.18 + n.energy[i] * 0.08);

    smoothEnergy = lerp(smoothEnergy, n.energy[i], n.energy[i] > smoothEnergy ? 0.42 : 0.10);
    smoothSub = lerp(smoothSub, n.sub[i], n.sub[i] > smoothSub ? 0.38 : 0.10);
    smoothBass = lerp(smoothBass, n.bass[i], n.bass[i] > smoothBass ? 0.40 : 0.11);
    smoothVocal = lerp(smoothVocal, vocalRaw, vocalRaw > smoothVocal ? 0.30 : 0.08);
    smoothKick = lerp(smoothKick, kickRaw, kickRaw > smoothKick ? 0.92 : 0.24);
    smoothSnare = lerp(smoothSnare, snareRaw, snareRaw > smoothSnare ? 0.82 : 0.20);
    smoothDrums = lerp(smoothDrums, drumsRaw, drumsRaw > smoothDrums ? 0.72 : 0.18);
    smoothMood = lerp(smoothMood, moodRaw, 0.07);

    frames[i] = {
      energy: clamp01(smoothEnergy),
      sub: clamp01(smoothSub),
      bass: clamp01(smoothBass),
      lowMid: n.lowMid[i],
      vocal: clamp01(smoothVocal),
      high: n.high[i],
      air: n.air[i],
      onset,
      kick: clamp01(smoothKick),
      snare: clamp01(smoothSnare),
      drums: clamp01(smoothDrums),
      instrumental: clamp01(n.energy[i] * 0.62 + n.bass[i] * 0.15 + n.lowMid[i] * 0.13 + n.high[i] * 0.10 - smoothVocal * 0.08),
      mood: clamp01(smoothMood),
      peak: n.peak[i],
    };
    prevEnergy = n.energy[i];
    prevSub = n.sub[i];
    prevBass = n.bass[i];
    prevHigh = n.high[i];
  }

  onProgress(0.78, 'BPM, секции и карта молний');
  const duration = audioBuffer.duration;
  const tempo = estimateBpm(frames, fps);
  const sections = buildSections(frames, duration, fps);
  const events = buildLightningEvents(frames, fps, tempo.bpm);

  const avg = (key) => frames.reduce((a, f) => a + f[key], 0) / Math.max(1, frames.length);
  const stats = {
    bpm: tempo.bpm,
    bpmConfidence: tempo.confidence,
    avgEnergy: avg('energy'),
    avgDrums: avg('drums'),
    avgVocal: avg('vocal'),
    lightningEvents: events.length,
  };

  onProgress(1, 'Карта готова');
  return { name: file.name, duration, sampleRate, fps, frames, events, sections, stats };
}

export function sampleTrackMap(map, time) {
  const empty = {
    energy: 0, sub: 0, bass: 0, lowMid: 0, vocal: 0, high: 0, air: 0,
    onset: 0, kick: 0, snare: 0, drums: 0, instrumental: 0, mood: 0.5, sectionEnergy: 0, sectionType: 'calm',
  };
  if (!map || !map.frames.length) return empty;
  const framePos = Math.max(0, Math.min(map.frames.length - 1, time * map.fps));
  const i0 = Math.floor(framePos);
  const i1 = Math.min(map.frames.length - 1, i0 + 1);
  const t = framePos - i0;
  const a = map.frames[i0], b = map.frames[i1];
  const section = map.sections.find((s) => time >= s.start && time < s.end) || map.sections[map.sections.length - 1];
  const mix = (key) => lerp(a[key], b[key], t);
  return {
    energy: mix('energy'), sub: mix('sub'), bass: mix('bass'), lowMid: mix('lowMid'), vocal: mix('vocal'),
    high: mix('high'), air: mix('air'), onset: mix('onset'), kick: mix('kick'), snare: mix('snare'), drums: mix('drums'), instrumental: mix('instrumental'),
    mood: mix('mood'), sectionEnergy: section?.energy ?? 0, sectionType: section?.type ?? 'steady',
  };
}

export function drawTrackMap(canvas, map) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#050812';
  ctx.fillRect(0, 0, w, h);

  const sectionColors = {
    intro: 'rgba(70,100,150,.16)', calm: 'rgba(60,90,125,.13)', build: 'rgba(85,70,160,.17)',
    drop: 'rgba(125,80,190,.20)', climax: 'rgba(160,95,210,.23)', release: 'rgba(70,110,130,.15)',
    vocal: 'rgba(135,85,180,.20)', steady: 'rgba(90,95,130,.14)'
  };
  for (const s of map.sections) {
    const x = (s.start / map.duration) * w;
    const sw = Math.max(1, ((s.end - s.start) / map.duration) * w);
    ctx.fillStyle = sectionColors[s.type] || sectionColors.steady;
    ctx.fillRect(x, 0, sw, h);
  }

  const drawLine = (key, stroke, scale, offset = 0) => {
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const idx = Math.min(map.frames.length - 1, Math.floor((x / Math.max(1, w - 1)) * map.frames.length));
      const y = h - 15 - map.frames[idx][key] * scale - offset;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  drawLine('energy', 'rgba(232,239,255,.92)', h * 0.62);
  drawLine('drums', 'rgba(130,175,255,.72)', h * 0.34);
  drawLine('vocal', 'rgba(205,135,255,.70)', h * 0.26, 2);

  for (const e of map.events) {
    if (e.power < 0.32) continue;
    const x = (e.time / map.duration) * w;
    ctx.fillStyle = `hsla(${Math.round(e.hue * 360)}, 90%, 72%, ${0.20 + e.power * 0.62})`;
    ctx.fillRect(x, h - 11, Math.max(1, e.power * 2.4), 7);
  }
}
