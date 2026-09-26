import{analyzeAudioFile,sampleTrackMap,drawTrackMap,EMPTY_SAMPLE}from'./audio/index.js';
import{AudioTransport}from'./audio/transport.js';
import{StormRenderer}from'./graphics/renderer.js';
const $=id=>document.getElementById(id),transport=new AudioTransport();
let renderer,map,controller,stemController,stemMap=null,generation=0,thunderCursor=0,lastThunderTime=0,recorder=null,recordStream=null,raf=0,lastRender=-100,lastHUD=0;
const status=text=>{$('status').textContent=text;};
const format=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
function progress(v,text){$('analysis-block').classList.remove('hidden');$('analysis-stage').textContent=text;$('analysis-percent').textContent=`${Math.round(v*100)}%`;$('analysis-progress').style.width=`${v*100}%`;}
function stopRecording(){if(recorder?.state==='recording')recorder.stop();}
function resetEvents(t){lastThunderTime=t;thunderCursor=map?.events.findIndex(e=>e.time>=t)??0;if(thunderCursor<0)thunderCursor=map.events.length;renderer?.reset(t);}
async function loadTrack(file){
  const id=++generation;controller?.abort();stemController?.abort();controller=new AbortController();const signal=controller.signal;
  stopRecording();transport.unload();map=null;stemMap=null;renderer?.setTrack(null);$('play').disabled=true;$('record').disabled=true;$('stem-file').disabled=true;$('play').textContent='Play';$('track-map').classList.add('hidden');$('timeline').classList.add('hidden');$('track-info').textContent='';$('stem-status').textContent='Гармоническая оценка ≈ голос';$('stem-file').value='';
  try{
    status(`Анализ: ${file.name}`);const result=await analyzeAudioFile(file,progress,signal);if(id!==generation)return;
    await transport.load(file,signal);if(id!==generation)return;map=result;renderer?.setTrack(map);resetEvents(0);
    drawTrackMap($('track-map'),map);$('track-map').classList.remove('hidden');$('timeline').classList.remove('hidden');$('seek').max=map.duration;$('seek').value=0;
    $('analysis-block').classList.add('hidden');$('play').disabled=!renderer||renderer.lost;$('record').disabled=!renderer||!window.MediaRecorder;$('stem-file').disabled=false;
    const tempo=map.tempo.confidence>.15?`≈ ${map.tempo.bpm} BPM`:'темп не определён';
    $('track-info').textContent=`${format(map.duration)} · ${tempo} · ${map.events.length} атак · ${map.sections.length} секций`;
    status(`Карта готова · ${file.name}`);
    transport.audio.addEventListener('ended',()=>{$('play').textContent='Play';stopRecording();transport.cancelFX();});
  }catch(e){if(e.name==='AbortError')return;console.error(e);status(`Ошибка: ${e.message}`);$('analysis-block').classList.add('hidden');}
}
async function loadStem(file){
  if(!map)return;const id=generation;stemController?.abort();stemController=new AbortController();transport.pause();$('play').textContent='Play';
  try{const stem=await analyzeAudioFile(file,progress,stemController.signal);if(id!==generation)return;if(Math.abs(stem.duration-map.duration)>.3)throw new Error('Длина вокальной дорожки должна совпадать с треком (±0,3 с), без обрезки тишины.');stemMap=stem;map.vocalMode='stem';$('stem-status').textContent='Вокал: отдельная дорожка';drawTrackMap($('track-map'),{...map,frames:map.frames.map((f,i)=>({...f,vocal:sampleTrackMap(stem,i/map.fps).energy}))});status('Вокальная дорожка подключена');}
  catch(e){if(e.name!=='AbortError')status(e.message);}finally{if(id===generation)$('analysis-block').classList.add('hidden');}
}
async function togglePlayback(){
  if(!map)return;try{if(transport.playing){transport.pause();$('play').textContent='Play';}else{if(transport.audio.ended){transport.seek(0);resetEvents(0);}await transport.play();$('play').textContent='Pause';}}catch(e){status(`Воспроизведение: ${e.message}`);}
}
function consumeThunder(time){
  if(!map||!transport.playing)return;if(time<lastThunderTime||time-lastThunderTime>.5)resetEvents(time);
  while(thunderCursor<map.events.length&&map.events[thunderCursor].time<=time){const e=map.events[thunderCursor++];if(time-e.time<.12&&$('thunder').checked&&e.power>.5)transport.thunder(e);}lastThunderTime=time;
}
function loop(now){
  raf=requestAnimationFrame(loop);if(document.hidden||!renderer||renderer.lost||now-lastRender<1000/30-.5)return;
  lastRender=now-(now-lastRender)%(1000/30);
  const time=transport.time,sample=map?sampleTrackMap(map,time):{...EMPTY_SAMPLE};if(stemMap)sample.vocal=sampleTrackMap(stemMap,time).energy;
  consumeThunder(time);renderer.render(sample,time,transport.playing);
  if(now-lastHUD>200){lastHUD=now;if(map){$('seek').value=time;$('timecode').textContent=`${format(time)} / ${format(map.duration)}`;}
    const m=renderer.metrics;$('metrics').textContent=`${m.fps.toFixed(0)} FPS · ${m.gpuMs===null?'GPU —':m.gpuMs.toFixed(1)+' ms GPU'} · ${renderer.canvas.width}×${renderer.canvas.height} · ${m.activeBolts} разрядов`;
    $('section-label').textContent=map?({intro:'Вступление',calm:'Тишина',build:'Нарастание',drop:'Дроп',climax:'Пик',breakdown:'Спад',steady:'Развитие'}[sample.sectionType]||sample.sectionType):'Сначала выберите трек';
    for(const k of['bass','transient','vocal'])$(`meter-${k}`).style.width=`${Math.round(sample[k]*100)}%`;
  }
}
async function toggleRecording(){
  if(recorder?.state==='recording'){stopRecording();return;}if(!map||!renderer.canvas.captureStream||!window.MediaRecorder){status('Запись недоступна в этом браузере');return;}
  try{
    await transport.context.resume();const video=renderer.canvas.captureStream(30);recordStream=video;
    const combined=new MediaStream([...video.getVideoTracks(),...transport.destination.stream.getAudioTracks()]);
    const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(m=>MediaRecorder.isTypeSupported(m));
    recorder=new MediaRecorder(combined,mime?{mimeType:mime,videoBitsPerSecond:6000000}:undefined);const chunks=[];const current=recorder;
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=()=>{const blob=new Blob(chunks,{type:current.mimeType}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='vj-storm.webm';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);video.getTracks().forEach(t=>t.stop());$('record').textContent='REC';};
    recorder.start(1000);$('record').textContent='STOP';if(!transport.playing)await togglePlayback();
  }catch(e){recordStream?.getTracks().forEach(t=>t.stop());status(`Запись: ${e.message}`);}
}
$('audio-file').onchange=()=>{const f=$('audio-file').files[0];if(f)loadTrack(f);};
$('stem-file').onchange=()=>{const f=$('stem-file').files[0];if(f)loadStem(f);};
$('play').onclick=togglePlayback;$('record').onclick=toggleRecording;
$('seek').oninput=()=>{const time=Number($('seek').value);transport.seek(time);resetEvents(time);};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(e){status(e.message);}};
$('hide-ui').onclick=()=>document.body.classList.add('ui-hidden');$('show-ui').onclick=()=>document.body.classList.remove('ui-hidden');
$('auto-quality').onchange=()=>renderer?.setAutoQuality($('auto-quality').checked);
$('bloom').oninput=()=>{if(renderer)renderer.bloom=Number($('bloom').value);};$('exposure').oninput=()=>{if(renderer)renderer.exposure=Number($('exposure').value);};
$('thunder').onchange=()=>{if(!$('thunder').checked)transport.cancelFX();};
window.addEventListener('resize',()=>renderer?.resize());
document.addEventListener('visibilitychange',()=>{if(document.hidden){transport.pause();$('play').textContent='Play';stopRecording();}else{lastRender=performance.now();renderer.frameTimes=[];renderer.lastWall=0;}});
window.addEventListener('pagehide',()=>{controller?.abort();stemController?.abort();transport.unload();cancelAnimationFrame(raf);renderer?.dispose();});
async function init(){
  try{renderer=new StormRenderer($('storm-canvas'));renderer.onError=e=>{status(e.message);document.body.classList.remove('ui-hidden');transport.pause();};const info=await renderer.init();status(`WebGPU · ${info.vendor||'GPU'} · цель 30 FPS`);if(map){renderer.setTrack(map);$('play').disabled=false;}requestAnimationFrame(loop);
    // Explicit development API: diagnostics, shader extension, reproducible offline frame inspection.
    window.storm={renderer,transport,get map(){return map;},get sample(){const s=sampleTrackMap(map,transport.time);if(stemMap)s.vocal=sampleTrackMap(stemMap,transport.time).energy;return s;},loadTrack,seek(time){transport.seek(time);resetEvents(time);},inspect(time){transport.pause();transport.seek(time);resetEvents(time);renderer.render(sampleTrackMap(map,time),time,false);}};
  }catch(e){console.error(e);status(`Ошибка WebGPU: ${e.message}`);$('play').disabled=true;}
}
init();
