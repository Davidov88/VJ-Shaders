import{mix}from'./dsp.js';
export async function analyzeAudioFile(file,onProgress=()=>{},signal){
  const check=()=>{if(signal?.aborted)throw new DOMException('Отменено','AbortError');};
  onProgress(.01,'Декодирование аудио');check();
  // Browser resampler; playback retains the full-quality original file.
  const ctx=new OfflineAudioContext(2,1,22050),buffer=await ctx.decodeAudioData(await file.arrayBuffer());check();
  const channels=Array.from({length:Math.min(2,buffer.numberOfChannels)},(_,c)=>buffer.getChannelData(c).slice());
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./analysis-worker.js',import.meta.url),{type:'module'});
    const cleanup=()=>{worker.terminate();signal?.removeEventListener('abort',abort);},abort=()=>{cleanup();reject(new DOMException('Отменено','AbortError'));};
    signal?.addEventListener('abort',abort,{once:true});worker.onerror=e=>{cleanup();reject(new Error(e.message));};
    worker.onmessage=({data})=>{if(data.progress)onProgress(data.progress.value,data.progress.stage);if(data.error){cleanup();reject(new Error(data.error));}if(data.map){cleanup();onProgress(1,'Карта готова');resolve({...data.map,name:file.name});}};
    worker.postMessage({channels,sampleRate:buffer.sampleRate},channels.map(c=>c.buffer));
  });
}
export const EMPTY_SAMPLE=Object.freeze({energy:0,sub:0,bass:0,lowmid:0,mid:0,high:0,air:0,transient:0,flux:0,kick:0,snare:0,vocal:0,sectionEnergy:0,sectionType:'calm',sectionId:0,hue:.6,zone:.5});
export function sampleTrackMap(map,time){
  if(!map?.frames.length)return{...EMPTY_SAMPLE};const pos=Math.max(0,Math.min(map.frames.length-1,time*map.fps)),i=Math.floor(pos),a=map.frames[i],b=map.frames[Math.min(i+1,map.frames.length-1)],result={};for(const k of Object.keys(a))result[k]=mix(a[k],b[k],pos-i);
  const s=map.sections.find(s=>time>=s.start&&time<s.end)||map.sections.at(-1);return{...result,sectionEnergy:s.energy,sectionType:s.type,sectionId:s.id,hue:s.hue,zone:s.zone};
}
export function drawTrackMap(canvas,map){
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.fillStyle='#080e1c';ctx.fillRect(0,0,w,h);
  for(const s of map.sections){ctx.fillStyle=`hsla(${s.hue*360},55%,50%,.14)`;ctx.fillRect(s.start/map.duration*w,0,(s.end-s.start)/map.duration*w,h);}
  const lanes=[['energy','#eef6ff','Энергия'],['bass','#75bfff','Бас'],['transient','#ffd1a1','Атаки'],['vocal','#c5a1ff',map.vocalMode==='stem'?'Вокал':'Гармоники ≈ голос']];
  for(let row=0;row<lanes.length;row++){const[key,color,label]=lanes[row],height=h/4,base=(row+1)*height-5;ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();for(let x=0;x<w;x++){const from=Math.floor(x/w*map.frames.length),to=Math.max(from+1,Math.floor((x+1)/w*map.frames.length));let value=0;for(let i=from;i<Math.min(to,map.frames.length);i++)value=Math.max(value,map.frames[i][key]);const y=base-value*(height-18);if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();ctx.font='12px system-ui';ctx.fillStyle=color;ctx.fillText(label,8,row*height+13);}
}
