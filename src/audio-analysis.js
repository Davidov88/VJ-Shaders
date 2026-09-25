const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

function percentile(values, p) {
  if (!values.length) return 1;
  const copy = Array.from(values).sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(copy.length - 1, Math.floor((copy.length - 1) * p)));
  return copy[idx] || 1;
}

function normalizeByPercentile(values, p = 0.96) {
  const scale = Math.max(1e-7, percentile(values, p));
  return values.map((v) => clamp01(v / scale));
}

function buildSections(frames, duration, fps) {
  const secondsPerSection = 4;
  const sectionFrames = Math.max(1, Math.round(secondsPerSection * fps));
  const raw = [];

  for (let start = 0; start < frames.length; start += sectionFrames) {
    const end = Math.min(frames.length, start + sectionFrames);
    let energy = 0, bass = 0, high = 0, transient = 0;
    for (let i = start; i < end; i++) {
      energy += frames[i].energy;
      bass += frames[i].bass;
      high += frames[i].high;
      transient += frames[i].transient;
    }
    const count = Math.max(1, end - start);
    raw.push({
      start: start / fps,
      end: Math.min(duration, end / fps),
      energy: energy / count,
      bass: bass / count,
      high: high / count,
      transient: transient / count,
    });
  }

  for (let i = 0; i < raw.length; i++) {
    const prev = raw[Math.max(0, i - 1)];
    const next = raw[Math.min(raw.length - 1, i + 1)];
    const trend = next.energy - prev.energy;
    const s = raw[i];
    let type = 'steady';
    if (s.energy < 0.20) type = 'calm';
    if (trend > 0.13 && s.energy < 0.72) type = 'build';
    if (s.energy > 0.74 && s.transient > 0.22) type = 'drop';
    if (s.energy > 0.86) type = 'climax';
    if (trend < -0.15 && s.energy < 0.55) type = 'release';
    if (i === 0 && s.energy < 0.48) type = 'intro';
    s.type = type;
    s.trend = trend;
  }

  const merged = [];
  for (const s of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.type === s.type && prev.end - prev.start < 16) {
      const spanA = prev.end - prev.start;
      const spanB = s.end - s.start;
      const total = spanA + spanB;
      prev.end = s.end;
      prev.energy = (prev.energy * spanA + s.energy * spanB) / total;
      prev.bass = (prev.bass * spanA + s.bass * spanB) / total;
      prev.high = (prev.high * spanA + s.high * spanB) / total;
      prev.transient = (prev.transient * spanA + s.transient * spanB) / total;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

function buildLightningEvents(frames, fps) {
  const impacts = frames.map((f) => clamp01(f.transient * 0.56 + f.bass * 0.26 + f.energy * 0.18));
  const events = [];
  let lastFrame = -9999;
  const minGap = Math.round(fps * 0.11);

  for (let i = 2; i < frames.length - 2; i++) {
    const v = impacts[i];
    const localPeak = v >= impacts[i - 1] && v >= impacts[i + 1];
    const threshold = 0.38 + (frames[i].energy < 0.3 ? 0.10 : 0);
    if (!localPeak || v < threshold || i - lastFrame < minGap) continue;

    const power = clamp01((v - threshold) / Math.max(0.2, 1 - threshold) * 0.72 + frames[i].energy * 0.28);
    const seed = ((i * 16807) % 2147483647) / 2147483647;
    const hue = (0.55 + frames[i].high * 0.28 + seed * 0.18) % 1;
    events.push({
      time: i / fps,
      power,
      seed,
      hue,
      bass: frames[i].bass,
      high: frames[i].high,
      type: power > 0.78 ? 'impact' : (frames[i].high > 0.62 ? 'fork' : 'arc'),
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

  onProgress(0.10, 'Декодирование аудио');
  const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  await decodeCtx.close();

  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const channels = audioBuffer.numberOfChannels;
  const fps = 30;
  const hop = Math.max(128, Math.round(sampleRate / fps));
  const frameCount = Math.ceil(length / hop);

  const rawEnergy = new Array(frameCount).fill(0);
  const rawBass = new Array(frameCount).fill(0);
  const rawMid = new Array(frameCount).fill(0);
  const rawHigh = new Array(frameCount).fill(0);
  const rawPeak = new Array(frameCount).fill(0);

  const channelData = [];
  for (let c = 0; c < channels; c++) channelData.push(audioBuffer.getChannelData(c));

  const lowAlpha = 1 - Math.exp(-2 * Math.PI * 180 / sampleRate);
  const midAlpha = 1 - Math.exp(-2 * Math.PI * 2400 / sampleRate);
  let lpLow = 0;
  let lpMid = 0;

  onProgress(0.18, 'Построение частотной карты');

  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hop;
    const end = Math.min(length, start + hop);
    let e = 0, b = 0, m = 0, h = 0, peak = 0;
    const count = Math.max(1, end - start);

    for (let i = start; i < end; i++) {
      let x = 0;
      for (let c = 0; c < channels; c++) x += channelData[c][i] || 0;
      x /= channels;

      lpLow += lowAlpha * (x - lpLow);
      lpMid += midAlpha * (x - lpMid);
      const bass = lpLow;
      const mid = lpMid - lpLow;
      const high = x - lpMid;

      e += x * x;
      b += bass * bass;
      m += mid * mid;
      h += high * high;
      peak = Math.max(peak, Math.abs(x));
    }

    rawEnergy[frame] = Math.sqrt(e / count);
    rawBass[frame] = Math.sqrt(b / count);
    rawMid[frame] = Math.sqrt(m / count);
    rawHigh[frame] = Math.sqrt(h / count);
    rawPeak[frame] = peak;

    if ((frame & 127) === 0) {
      onProgress(0.18 + 0.48 * (frame / frameCount), 'Построение частотной карты');
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  onProgress(0.70, 'Нормализация динамики');
  const energyN = normalizeByPercentile(rawEnergy, 0.965);
  const bassN = normalizeByPercentile(rawBass, 0.965);
  const midN = normalizeByPercentile(rawMid, 0.965);
  const highN = normalizeByPercentile(rawHigh, 0.965);
  const peakN = normalizeByPercentile(rawPeak, 0.985);

  const frames = new Array(frameCount);
  let prevEnergy = energyN[0] || 0;
  let prevHigh = highN[0] || 0;
  let smoothEnergy = 0;
  let smoothBass = 0;

  for (let i = 0; i < frameCount; i++) {
    const rise = Math.max(0, energyN[i] - prevEnergy);
    const highRise = Math.max(0, highN[i] - prevHigh);
    const transient = clamp01(rise * 3.7 + highRise * 1.6 + Math.max(0, peakN[i] - energyN[i]) * 0.38);
    smoothEnergy = lerp(smoothEnergy, energyN[i], energyN[i] > smoothEnergy ? 0.38 : 0.10);
    smoothBass = lerp(smoothBass, bassN[i], bassN[i] > smoothBass ? 0.34 : 0.12);

    frames[i] = {
      energy: clamp01(smoothEnergy),
      bass: clamp01(smoothBass),
      mid: midN[i],
      high: highN[i],
      peak: peakN[i],
      transient,
    };
    prevEnergy = energyN[i];
    prevHigh = highN[i];
  }

  onProgress(0.82, 'Поиск ударов и секций');
  const duration = audioBuffer.duration;
  const events = buildLightningEvents(frames, fps);
  const sections = buildSections(frames, duration, fps);

  const avgEnergy = frames.reduce((a, f) => a + f.energy, 0) / Math.max(1, frames.length);
  const maxEnergy = frames.reduce((a, f) => Math.max(a, f.energy), 0);
  const avgBass = frames.reduce((a, f) => a + f.bass, 0) / Math.max(1, frames.length);

  onProgress(1, 'Карта готова');
  return {
    name: file.name,
    duration,
    sampleRate,
    fps,
    frames,
    events,
    sections,
    stats: { avgEnergy, maxEnergy, avgBass, lightningEvents: events.length },
  };
}

export function sampleTrackMap(map, time) {
  if (!map || !map.frames.length) return { energy: 0, bass: 0, mid: 0, high: 0, transient: 0, sectionEnergy: 0, sectionType: 'calm' };
  const framePos = Math.max(0, Math.min(map.frames.length - 1, time * map.fps));
  const i0 = Math.floor(framePos);
  const i1 = Math.min(map.frames.length - 1, i0 + 1);
  const t = framePos - i0;
  const a = map.frames[i0], b = map.frames[i1];
  const section = map.sections.find((s) => time >= s.start && time < s.end) || map.sections[map.sections.length - 1];

  return {
    energy: lerp(a.energy, b.energy, t),
    bass: lerp(a.bass, b.bass, t),
    mid: lerp(a.mid, b.mid, t),
    high: lerp(a.high, b.high, t),
    transient: lerp(a.transient, b.transient, t),
    sectionEnergy: section?.energy ?? 0,
    sectionType: section?.type ?? 'steady',
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
    intro: 'rgba(70,100,150,.22)', calm: 'rgba(60,90,125,.18)', build: 'rgba(85,70,160,.22)',
    drop: 'rgba(125,80,190,.26)', climax: 'rgba(160,95,210,.30)', release: 'rgba(70,110,130,.20)', steady: 'rgba(90,95,130,.18)'
  };
  for (const s of map.sections) {
    const x = (s.start / map.duration) * w;
    const sw = Math.max(1, ((s.end - s.start) / map.duration) * w);
    ctx.fillStyle = sectionColors[s.type] || sectionColors.steady;
    ctx.fillRect(x, 0, sw, h);
  }

  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const idx = Math.min(map.frames.length - 1, Math.floor((x / (w - 1)) * map.frames.length));
    const y = h - 16 - map.frames[idx].energy * (h - 35);
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(226,238,255,.92)';
  ctx.lineWidth = 2;
  ctx.stroke();

  for (const e of map.events) {
    if (e.power < 0.46) continue;
    const x = (e.time / map.duration) * w;
    ctx.fillStyle = `hsla(${Math.round(e.hue * 360)}, 90%, 72%, ${0.20 + e.power * 0.55})`;
    ctx.fillRect(x, h - 11, Math.max(1, e.power * 2.2), 7);
  }
}
