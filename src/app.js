import { analyzeAudioFile, sampleTrackMap, drawTrackMap } from './audio-analysis.js';
import { StormRenderer } from './gpu-engine.js?v=2';

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
const analysisBlock = $('analysis-block');
const analysisStage = $('analysis-stage');
const analysisPercent = $('analysis-percent');
const analysisProgress = $('analysis-progress');
const mapCanvas = $('track-map');
const timeline = $('timeline');
const timelineFill = $('timeline-fill');

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
    const gpu = [info.vendor, info.architecture].filter(Boolean).join(' / ') || 'WebGPU';
    setStatus(`WebGPU готов: ${gpu}`);
    renderStarted = true;
    requestAnimationFrame(loop);
  } catch (error) {
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

async function loadTrack(file) {
  playBtn.disabled = true;
  recordBtn.disabled = true;
  mapCanvas.classList.add('hidden');
  trackMap = null;
  eventCursor = 0;
  if (audio) audio.pause();
  if (audioUrl) URL.revokeObjectURL(audioUrl);

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
    analysisBlock.classList.add('hidden');
    setStatus(`${formatTime(trackMap.duration)} · ${trackMap.events.length} электрических событий · карта готова`);
  } catch (error) {
    console.error(error);
    setStatus(`Ошибка анализа: ${error.message}`);
  }
}

async function setupAudioGraph() {
  if (!audio) return;
  if (audioCtx && mediaSource) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioCtx({ latencyHint: 'interactive' });
  mediaSource = audioCtx.createMediaElementSource(audio);
  masterGain = audioCtx.createGain();
  fxGain = audioCtx.createGain();
  recordDestination = audioCtx.createMediaStreamDestination();

  masterGain.gain.value = 1;
  fxGain.gain.value = 0.68;
  mediaSource.connect(masterGain);
  masterGain.connect(audioCtx.destination);
  masterGain.connect(recordDestination);
  fxGain.connect(audioCtx.destination);
  fxGain.connect(recordDestination);

  thunderNoise = createNoiseBuffer(audioCtx, 2.6);
}

function createNoiseBuffer(ctx, seconds) {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = last * 0.82 + white * 0.18;
    data[i] = last;
  }
  return buffer;
}

function playThunder(power, seed) {
  if (!audioCtx || !fxGain || !thunderNoise || !thunderToggle.checked || power < 0.46) return;
  const t = audioCtx.currentTime;
  const src = audioCtx.createBufferSource();
  src.buffer = thunderNoise;
  src.playbackRate.value = 0.76 + seed * 0.22;

  const lowpass = audioCtx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 180 + power * 320;
  lowpass.Q.value = 0.6 + power * 1.4;

  const gain = audioCtx.createGain();
  const peak = 0.045 + power * 0.16;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.52 + power * 1.15);

  const sub = audioCtx.createOscillator();
  const subGain = audioCtx.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(54 + seed * 15, t);
  sub.frequency.exponentialRampToValueAtTime(29, t + 0.55);
  subGain.gain.setValueAtTime(0.0001, t);
  subGain.gain.exponentialRampToValueAtTime(0.02 + power * 0.065, t + 0.012);
  subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.65 + power * 0.55);

  src.connect(lowpass).connect(gain).connect(fxGain);
  sub.connect(subGain).connect(fxGain);
  src.start(t);
  src.stop(t + 2.5);
  sub.start(t);
  sub.stop(t + 1.4);
}

function consumeLightningEvents(currentTime) {
  if (!trackMap || !audio || audio.paused) return;
  if (currentTime + 0.05 < lastPlaybackTime) {
    eventCursor = trackMap.events.findIndex((e) => e.time >= currentTime);
    if (eventCursor < 0) eventCursor = trackMap.events.length;
  }

  while (eventCursor < trackMap.events.length && trackMap.events[eventCursor].time <= currentTime + 0.018) {
    const event = trackMap.events[eventCursor];
    if (event.time >= currentTime - 0.16) {
      renderer.triggerLightning(event);
      const thunderDelay = 75 + (1 - event.power) * 105;
      setTimeout(() => {
        if (audio && !audio.paused) playThunder(event.power, event.seed);
      }, thunderDelay);
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
    eventCursor = trackMap.events.findIndex((e) => e.time >= audio.currentTime);
    if (eventCursor < 0) eventCursor = trackMap.events.length;
    lastPlaybackTime = audio.currentTime;
    await audio.play();
    playBtn.textContent = 'Pause';
  } else {
    audio.pause();
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
  const canvasStream = canvas.captureStream(60);
  const combined = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...recordDestination.stream.getAudioTracks(),
  ]);
  const mimeType = chooseRecorderMime();
  recorder = new MediaRecorder(combined, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
  recordingChunks = [];
  recorder.ondataavailable = (e) => { if (e.data?.size) recordingChunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(recordingChunks, { type: recorder.mimeType || 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vj-storm-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setStatus(`Видео готово: ${(blob.size / 1024 / 1024).toFixed(1)} MB`);
  };
  recorder.start(1000);
  recordBtn.textContent = 'STOP';
  if (audio.paused) await togglePlayback();
}

function loop() {
  if (!renderStarted) return;
  const t = audio?.currentTime || 0;
  const sample = trackMap ? sampleTrackMap(trackMap, t) : {
    energy: 0.04, bass: 0.02, mid: 0.02, high: 0.015, transient: 0,
    sectionEnergy: 0.05, sectionType: 'calm',
  };
  consumeLightningEvents(t);
  renderer.render(sample, t);
  if (audio && trackMap) {
    timelineFill.style.width = `${Math.min(100, (audio.currentTime / trackMap.duration) * 100)}%`;
    if (audio.ended) playBtn.textContent = 'Play';
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
window.addEventListener('resize', () => renderer?.resize(true));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && audio && !audio.paused) {
    audio.pause();
    playBtn.textContent = 'Play';
  }
});

initRenderer();
