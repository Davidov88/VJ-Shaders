import { analyzeAudioFile, sampleTrackMap, drawTrackMap } from './audio-analysis.js?v=5';
import { StormRenderer } from './gpu-engine.js?v=5';

const $ = (id) => document.getElementById(id);
const canvas = $('storm-canvas');
const status = $('status');
const fileInput = $('audio-file');
const playBtn = $('play');
const recordBtn = $('record');
const fullscreenBtn = $('fullscreen');
const hideUiBtn = $('hide-ui');
const showUiBtn = $('show-ui');
const thunderToggle = $('thunder');
const autoQualityToggle = $('auto-quality');
const lightningSens = $('lightning-sens');
const rainSens = $('rain-sens');
const vocalSens = $('vocal-sens');
const analysisBlock = $('analysis-block');
const analysisStage = $('analysis-stage');
const analysisPercent = $('analysis-percent');
const analysisProgress = $('analysis-progress');
const mapCanvas = $('track-map');
const timeline = $('timeline');
const timelineFill = $('timeline-fill');
const telemetry = $('telemetry');
const meters = $('meters');

let renderer;
let trackMap = null;
let audio = null;
let audioUrl = null;
let audioCtx = null;
let mediaSource = null;
let recordDestination = null;
let masterGain = null;
let fxGain = null;
let thunderNoise = null;
let eventCursor = 0;
let lastPlaybackTime = 0;
let recorder = null;
let recordingChunks = [];
let renderStarted = false;

function setStatus(text) { status.textContent = text; }
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

async function initRenderer() {
  try {
    renderer = new StormRenderer(canvas);
    const info = await renderer.init();
    applyVisualControls();
    const gpu = [info.vendor, info.architecture].filter(Boolean).join(' / ') || 'WebGPU';
    setStatus(`WebGPU готов: ${gpu} · 30 FPS target`);
    renderStarted = true;
    requestAnimationFrame(loop);
  } catch (error) {
    renderStarted = false;
    renderer = null;
    console.error(error);
    setStatus(`Ошибка: ${error.message}`);
    document.body.classList.remove('ui-hidden');
  }
}

function updateAnalysisProgress(value, stage) {
  const pct = Math.round(value * 100);
  analysisBlock.classList.remove('hidden');
  analysisStage.textContent = stage;
  analysisPercent.textContent = `${pct}%`;
  analysisProgress.style.width = `${pct}%`;
}

async function teardownAudioGraph() {
  try { mediaSource?.disconnect(); } catch {}
  try { masterGain?.disconnect(); } catch {}
  try { fxGain?.disconnect(); } catch {}
  mediaSource = null;
  masterGain = null;
  fxGain = null;
  recordDestination = null;
  thunderNoise = null;
  if (audioCtx && audioCtx.state !== 'closed') {
    try { await audioCtx.close(); } catch {}
  }
  audioCtx = null;
}

async function loadTrack(file) {
  playBtn.disabled = true;
  recordBtn.disabled = true;
  mapCanvas.classList.add('hidden');
  telemetry.classList.add('hidden');
  meters.classList.add('hidden');
  trackMap = null;
  eventCursor = 0;
  renderer?.clearLightning();
  if (audio) {
    audio.pause();
    audio.src = '';
    audio.load();
  }
  await teardownAudioGraph();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null;

  try {
    setStatus(`Анализ: ${file.name}`);
    trackMap = await analyzeAudioFile(file, updateAnalysisProgress);
    drawTrackMap(mapCanvas, trackMap);
    mapCanvas.classList.remove('hidden');

    audioUrl = URL.createObjectURL(file);
    audio = new Audio(audioUrl);
    audio.preload = 'auto';
    await new Promise((resolve, reject) => {
      audio.addEventListener('canplay', resolve, { once: true });
      audio.addEventListener('error', () => reject(new Error('Браузер не смог открыть аудиофайл.')), { once: true });
      audio.load();
    });

    await setupAudioGraph();
    playBtn.disabled = false;
    recordBtn.disabled = false;
    timeline.classList.remove('hidden');
    telemetry.classList.remove('hidden');
    meters.classList.remove('hidden');
    analysisBlock.classList.add('hidden');
    $('bpm').textContent = trackMap.stats.bpm || '-';
    setStatus(`${formatTime(trackMap.duration)} · ${trackMap.stats.lightningEvents} разрядов · BPM ${trackMap.stats.bpm || '?'} · 6-band map готова`);
  } catch (error) {
    console.error(error);
    setStatus(`Ошибка анализа: ${error.message}`);
    analysisBlock.classList.add('hidden');
  }
}

async function setupAudioGraph() {
  if (!audio) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioCtx({ latencyHint: 'interactive' });
  mediaSource = audioCtx.createMediaElementSource(audio);
  masterGain = audioCtx.createGain();
  fxGain = audioCtx.createGain();
  recordDestination = audioCtx.createMediaStreamDestination();
  masterGain.gain.value = 1;
  fxGain.gain.value = 0.58;
  mediaSource.connect(masterGain);
  masterGain.connect(audioCtx.destination);
  masterGain.connect(recordDestination);
  fxGain.connect(audioCtx.destination);
  fxGain.connect(recordDestination);
  thunderNoise = createNoiseBuffer(audioCtx, 2.7);
}

function createNoiseBuffer(ctx, seconds) {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = last * 0.86 + white * 0.14;
    data[i] = last;
  }
  return buffer;
}

function playThunder(power, seed) {
  if (!audioCtx || !fxGain || !thunderNoise || !thunderToggle.checked || power < 0.42) return;
  const t = audioCtx.currentTime;
  const src = audioCtx.createBufferSource();
  src.buffer = thunderNoise;
  src.playbackRate.value = 0.72 + seed * 0.20;
  const lowpass = audioCtx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 165 + power * 360;
  lowpass.Q.value = 0.7 + power * 1.2;
  const gain = audioCtx.createGain();
  const peak = 0.035 + power * 0.14;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.62 + power * 1.0);
  const sub = audioCtx.createOscillator();
  const subGain = audioCtx.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(52 + seed * 13, t);
  sub.frequency.exponentialRampToValueAtTime(27, t + 0.62);
  subGain.gain.setValueAtTime(0.0001, t);
  subGain.gain.exponentialRampToValueAtTime(0.018 + power * 0.055, t + 0.015);
  subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.78 + power * 0.45);
  src.connect(lowpass).connect(gain).connect(fxGain);
  sub.connect(subGain).connect(fxGain);
  src.start(t);
  src.stop(t + 2.55);
  sub.start(t);
  sub.stop(t + 1.4);
}

function consumeLightningEvents(currentTime) {
  if (!trackMap || !audio || audio.paused || !renderer) return;
  if (currentTime + 0.05 < lastPlaybackTime || currentTime - lastPlaybackTime > 1.5) {
    eventCursor = trackMap.events.findIndex((e) => e.triggerTime >= currentTime - 0.03);
    if (eventCursor < 0) eventCursor = trackMap.events.length;
    renderer.clearLightning();
  }

  while (eventCursor < trackMap.events.length && trackMap.events[eventCursor].triggerTime <= currentTime + 0.020) {
    const event = trackMap.events[eventCursor];
    if (event.triggerTime >= currentTime - 0.18) {
      renderer.triggerLightning(event, currentTime);
      const untilImpact = Math.max(0, event.time - currentTime);
      const thunderDelay = untilImpact + 0.055 + (1 - event.power) * 0.085;
      setTimeout(() => {
        if (audio && !audio.paused) playThunder(event.power, event.seed);
      }, thunderDelay * 1000);
    }
    eventCursor++;
  }
  lastPlaybackTime = currentTime;
}

async function togglePlayback() {
  if (!audio || !trackMap) return;
  await audioCtx?.resume();
  if (audio.paused) {
    if (audio.ended) audio.currentTime = 0;
    eventCursor = trackMap.events.findIndex((e) => e.triggerTime >= audio.currentTime - 0.02);
    if (eventCursor < 0) eventCursor = trackMap.events.length;
    lastPlaybackTime = audio.currentTime;
    await audio.play();
    playBtn.textContent = 'Pause';
  } else {
    audio.pause();
    renderer?.clearLightning();
    playBtn.textContent = 'Play';
  }
}

function chooseRecorderMime() {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) || '';
}

async function toggleRecording() {
  if (recorder && recorder.state === 'recording') {
    recorder.stop();
    recordBtn.textContent = 'REC';
    return;
  }
  if (!audio || !recordDestination || !canvas.captureStream || !window.MediaRecorder) {
    setStatus('Запись MediaRecorder не поддерживается этим браузером.');
    return;
  }
  await audioCtx.resume();
  const canvasStream = canvas.captureStream(30);
  const combined = new MediaStream([...canvasStream.getVideoTracks(), ...recordDestination.stream.getAudioTracks()]);
  const mimeType = chooseRecorderMime();
  recorder = new MediaRecorder(combined, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
  recordingChunks = [];
  recorder.ondataavailable = (e) => { if (e.data?.size) recordingChunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(recordingChunks, { type: recorder.mimeType || 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vj-storm-v3-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setStatus(`Видео готово: ${(blob.size / 1024 / 1024).toFixed(1)} MB`);
  };
  recorder.start(1000);
  recordBtn.textContent = 'STOP';
  if (audio.paused) await togglePlayback();
}

function applyVisualControls() {
  renderer?.setControls({
    lightning: Number(lightningSens.value),
    rain: Number(rainSens.value),
    vocal: Number(vocalSens.value),
  });
}

function updateMeters(sample) {
  $('energy').textContent = Math.round(sample.energy * 100);
  $('drums').textContent = Math.round(sample.drums * 100);
  $('kick').textContent = Math.round((sample.kick || 0) * 100);
  $('vocal').textContent = Math.round(sample.vocal * 100);
  const pairs = [
    ['m-sub', sample.sub], ['m-bass', sample.bass], ['m-lowmid', sample.lowMid],
    ['m-vocal', sample.vocal], ['m-high', sample.high], ['m-air', sample.air],
  ];
  for (const [id, value] of pairs) $(id).style.width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function loop() {
  if (!renderStarted) return;
  const t = audio?.currentTime || 0;
  const sample = trackMap ? sampleTrackMap(trackMap, t) : {
    energy: 0.015, sub: 0.008, bass: 0.008, lowMid: 0.008, vocal: 0, high: 0.006, air: 0.004,
    onset: 0, kick: 0, snare: 0, drums: 0, instrumental: 0, mood: 0.48, sectionEnergy: 0.02, sectionType: 'calm',
  };
  consumeLightningEvents(t);
  renderer.render(sample, t);
  if (audio && trackMap) {
    timelineFill.style.width = `${Math.min(100, (audio.currentTime / trackMap.duration) * 100)}%`;
    updateMeters(sample);
    if (audio.ended) {
      playBtn.textContent = 'Play';
      renderer.clearLightning();
    }
  }
  requestAnimationFrame(loop);
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadTrack(file);
});
playBtn.addEventListener('click', togglePlayback);
recordBtn.addEventListener('click', toggleRecording);
fullscreenBtn.addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) { setStatus(`Fullscreen: ${error.message}`); }
});
hideUiBtn.addEventListener('click', () => document.body.classList.add('ui-hidden'));
showUiBtn.addEventListener('click', () => document.body.classList.remove('ui-hidden'));
autoQualityToggle.addEventListener('change', () => renderer?.setAutoQuality(autoQualityToggle.checked));
for (const input of [lightningSens, rainSens, vocalSens]) input.addEventListener('input', applyVisualControls);
timeline.addEventListener('pointerdown', (event) => {
  if (!audio || !trackMap) return;
  const rect = timeline.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
  audio.currentTime = ratio * trackMap.duration;
  eventCursor = trackMap.events.findIndex((e) => e.triggerTime >= audio.currentTime - 0.02);
  if (eventCursor < 0) eventCursor = trackMap.events.length;
  lastPlaybackTime = audio.currentTime;
  renderer?.clearLightning();
});
window.addEventListener('resize', () => { if (renderStarted) renderer?.resize(true); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && audio && !audio.paused) {
    audio.pause();
    renderer?.clearLightning();
    playBtn.textContent = 'Play';
  }
});

initRenderer();
