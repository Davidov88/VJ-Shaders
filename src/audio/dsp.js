// Pure DSP, shared by the worker and the signal regression tests.
export const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
export const mix=(a,b,t)=>a+(b-a)*t;
export function quantile(a,q){if(!a.length)return 0;const s=Array.from(a).sort((a,b)=>a-b);return s[Math.floor((s.length-1)*q)];}
export function random(seed){let s=seed>>>0;return()=>{s+=0x6D2B79F5;let t=Math.imul(s^s>>>15,1|s);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;};}
export class FFT {
  constructor(n){
    this.n=n;this.real=new Float64Array(n);this.imag=new Float64Array(n);this.reverse=new Uint32Array(n);this.window=new Float32Array(n);this.cos=new Float64Array(n/2);this.sin=new Float64Array(n/2);
    for(let i=0,bits=Math.log2(n);i<n;i++){let v=i,r=0;for(let j=0;j<bits;j++){r=(r<<1)|(v&1);v>>>=1;}this.reverse[i]=r;this.window[i]=0.5-0.5*Math.cos(2*Math.PI*i/(n-1));}
    for(let i=0;i<n/2;i++){this.cos[i]=Math.cos(-2*Math.PI*i/n);this.sin[i]=Math.sin(-2*Math.PI*i/n);}
  }
  spectrum(signal,center,out){
    const{n,real:re,imag:im}=this;
    for(let i=0;i<n;i++){re[this.reverse[i]]=(signal[center+i-n/2]||0)*this.window[i];im[i]=0;}
    for(let size=2;size<=n;size*=2){const half=size/2,step=n/size;for(let start=0;start<n;start+=size)for(let j=0;j<half;j++){const k=j*step,a=start+j,b=a+half,r=re[b]*this.cos[k]-im[b]*this.sin[k],v=re[b]*this.sin[k]+im[b]*this.cos[k];re[b]=re[a]-r;im[b]=im[a]-v;re[a]+=r;im[a]+=v;}}
    for(let i=0;i<n/2;i++)out[i]=Math.hypot(re[i],im[i])*2/n;
  }
}
const EDGES=[30,100,250,600,2000,5000,11026];
const norm=(a,floor)=>{const scale=Math.max(floor,quantile(a,.97));return Float32Array.from(a,v=>clamp(v/scale));};
export function analyzePCM(channels,sampleRate,progress=()=>{}){
  if(!channels.length||!channels[0].length||sampleRate<=0)throw new Error('Пустой аудиосигнал');
  const n=2048,hop=256,fps=sampleRate/hop,length=channels[0].length,count=Math.ceil(length/hop),duration=length/sampleRate;
  const fft=new FFT(n),spec=new Float32Array(n/2),mag=new Float32Array(n/2),prev=new Float32Array(n/2),history=new Float32Array(n/2);
  const raw=Array.from({length:13},()=>new Float32Array(count));
  const[energy,sub,bass,lowmid,mid,high,air,flux,kick,snare,vocal,centroid,flatness]=raw;
  const band=Uint8Array.from({length:n/2},(_,k)=>{const hz=k*sampleRate/n;return hz<30?255:Math.max(0,EDGES.findIndex((end,i)=>i>0&&hz<end)-1);});
  for(let f=0;f<count;f++){
    const center=f*hop;mag.fill(0);let rms=0,samples=0;
    // Average channel powers, not signed samples: antiphase stereo stays audible to the analyzer.
    for(const channel of channels){fft.spectrum(channel,center,spec);for(let k=1;k<mag.length;k++)mag[k]+=spec[k]**2/channels.length;for(let i=center;i<Math.min(length,center+hop);i++){rms+=channel[i]**2;samples++;}}
    energy[f]=Math.sqrt(rms/Math.max(1,samples));
    let total=0,weighted=0,logSum=0,harmonic=0;const sums=new Float64Array(6);
    for(let k=1;k<mag.length;k++){
      const hz=k*sampleRate/n,value=Math.sqrt(mag[k]),diff=Math.max(0,value-prev[k]*1.025);
      if(band[k]<6)sums[band[k]]+=mag[k];flux[f]+=diff;
      if(hz<180)kick[f]+=diff;if(hz>180&&hz<9000)snare[f]+=diff*(hz>1500?1:.35);
      if(hz>=250&&hz<=4000){const neighbors=(Math.sqrt(mag[Math.max(1,k-2)])+Math.sqrt(mag[Math.min(mag.length-1,k+2)]))*.5;harmonic+=Math.min(value,history[k])*clamp((value-neighbors)/(value+1e-7));}
      history[k]=mix(history[k],value,value>history[k]?.13:.32);prev[k]=value;total+=value;weighted+=hz*value;logSum+=Math.log(value+1e-10);
    }
    [sub,bass,lowmid,mid,high,air].forEach((a,i)=>a[f]=Math.sqrt(sums[i]));
    vocal[f]=harmonic*clamp(1-flux[f]/(total+1e-7)*3);centroid[f]=total?weighted/total:0;flatness[f]=total?Math.exp(logSum/(mag.length-1))/(total/(mag.length-1)+1e-10):0;
    if(!(f%256))progress(.08+f/count*.72,'FFT · спектр · атаки · гармоники');
  }
  const ref=Math.max(.005,quantile(energy,.97)),normalized=raw.slice(0,11).map((a,i)=>norm(a,i>=7?.001:.0002)),smooth=new Float32Array(11),frames=new Array(count);
  for(let i=0;i<count;i++){
    const gate=clamp((energy[i]-.00008)/.001);
    for(let j=0;j<11;j++){const v=normalized[j][i]*gate,tau=j>=7&&j<=9?.012:v>smooth[j]?.025:.12;smooth[j]=mix(smooth[j],v,1-Math.exp(-1/fps/tau));}
    frames[i]={rms:energy[i],energy:clamp(energy[i]/ref)*gate,sub:smooth[1],bass:smooth[2],lowmid:smooth[3],mid:smooth[4],high:smooth[5],air:smooth[6],flux:normalized[7][i]*gate,transient:smooth[7],kick:smooth[8],snare:smooth[9],vocal:smooth[10],centroid:centroid[i],flatness:flatness[i]};
  }
  progress(.84,'Атаки · темп · изменения композиции');
  const onsets=detectOnsets(frames,fps),tempo=estimateTempo(onsets,duration),sections=buildSections(frames,fps,duration),events=makeEvents(onsets,frames,sections);
  return{version:3,duration,sampleRate,fps,hop,frames,onsets,tempo,sections,events,vocalMode:'harmonic-proxy',stats:{lightningEvents:events.length,onsets:onsets.length,avgEnergy:frames.reduce((s,f)=>s+f.energy,0)/count}};
}
export function detectOnsets(frames,fps){
  const out=[],radius=Math.round(fps*.22),minGap=Math.round(fps*.105),values=frames.map(f=>f.flux);let last=-minGap;
  for(let i=1;i<frames.length-1;i++){
    const v=values[i];if(frames[i].rms<.001||v<.09||v<=values[i-1]||v<values[i+1]||i-last<minGap)continue;
    const threshold=quantile(values.slice(Math.max(0,i-radius),Math.min(values.length,i+radius+1)),.5)*1.6+.035;
    if(v<=threshold)continue;const f=frames[i];
    out.push({time:i/fps,frame:i,strength:clamp((v-threshold)/(1-threshold+1e-6)),kind:f.kick>f.snare*1.1?'kick':f.air>f.bass?'percussion':'snare'});last=i;
  }return out;
}
export function estimateTempo(onsets,duration){
  if(onsets.length<5||duration<3)return{bpm:null,confidence:0};const bins=new Float64Array(121);
  for(let i=0;i<onsets.length;i++)for(let j=i+1;j<Math.min(i+9,onsets.length);j++){let bpm=60/(onsets[j].time-onsets[i].time);while(bpm<60)bpm*=2;while(bpm>180)bpm/=2;const k=Math.round(bpm)-60;if(k>=0&&k<bins.length)bins[k]+=(.2+onsets[i].strength)/(j-i);}
  const scores=Array.from(bins,(_,i)=>(bins[i-1]||0)+bins[i]*2+(bins[i+1]||0));let best=scores.indexOf(Math.max(...scores));
  // Prefer the measured adjacent-attack period when half/double-time bins compete.
  const gaps=onsets.slice(1).map((o,i)=>o.time-onsets[i].time).filter(t=>t>.27&&t<1.05),median=quantile(gaps,.5),adjacent=median?Math.round(60/median):0;
  if(adjacent>=60&&adjacent<=180){const low=Math.max(0,adjacent-64),high=Math.min(120,adjacent-56);let candidate=low;for(let k=low;k<=high;k++)if(scores[k]>scores[candidate])candidate=k;if(scores[candidate]>scores[best]*.45)best=candidate;}
  return{bpm:best+60,confidence:clamp(scores[best]/Math.max(1,bins.reduce((a,b)=>a+b,0))*2)};
}
function buildSections(frames,fps,duration){
  const windows=[];
  for(let t=0;t<duration;t+=2){const group=frames.slice(Math.floor(t*fps),Math.min(frames.length,Math.floor((t+2)*fps))),mean=k=>group.reduce((a,f)=>a+f[k],0)/Math.max(1,group.length);windows.push({start:t,end:Math.min(duration,t+2),energy:mean('energy'),bass:mean('bass'),high:mean('high'),vocal:mean('vocal'),transient:mean('transient')});}
  const boundaries=[0];
  for(let i=2;i<windows.length-1;i++){const a=windows[i-1],b=windows[i],novelty=Math.abs(a.energy-b.energy)+.35*Math.abs(a.bass-b.bass)+.3*Math.abs(a.high-b.high)+.25*Math.abs(a.vocal-b.vocal),elapsed=b.start-boundaries.at(-1);if(elapsed>=4&&(novelty>.22||elapsed>=20))boundaries.push(b.start);}
  boundaries.push(duration);const sections=[];
  for(let i=0;i<boundaries.length-1;i++){
    const start=boundaries[i],end=boundaries[i+1],ws=windows.filter(w=>w.start>=start&&w.start<end),avg=k=>ws.reduce((s,w)=>s+w[k],0)/Math.max(1,ws.length);
    const energy=avg('energy'),bass=avg('bass'),high=avg('high'),transient=avg('transient'),trend=(ws.at(-1)?.energy||0)-(ws[0]?.energy||0),previous=sections.at(-1)?.energy||0;
    const type=energy<.15?(i===0?'intro':'calm'):energy<previous*.65?'breakdown':trend>.18?'build':energy>.8&&transient>.08?'climax':energy>.6&&energy>previous+.13?'drop':'steady';
    sections.push({id:i,start,end,energy,bass,high,transient,type,zone:(i*.61803398875)%1,hue:.53+((i*.137)%.29)});
  }return sections;
}
function makeEvents(onsets,frames,sections){
  return onsets.map((onset,i)=>{
    const f=frames[onset.frame],section=sections.find(s=>onset.time>=s.start&&onset.time<s.end)||sections[0],seed=(Math.imul(i+1,2654435761)^Math.round(onset.time*1000))>>>0,r=random(seed),power=clamp(onset.strength*.6+f.energy*.2+f.kick*.2);
    let type=onset.kind==='percussion'?'needle':power>.73?'impact':'fork';
    if(['intro','calm','breakdown'].includes(section.type))type=r()<.65?'internal':'arc';else if(onset.kind==='snare'&&r()<.4)type='restrike';else if(power<.35)type=r()<.5?'internal':'arc';
    const leaderDuration=.12+r()*.15;
    return{time:onset.time,startTime:onset.time-leaderDuration,leaderDuration,seed,power,type,section:section.id,zone:section.zone,hue:(section.hue+f.high*.08+r()*.055)%1,bass:f.bass,high:f.high,branchCount:3+Math.floor(power*9+f.high*4),restrikeCount:type==='restrike'?3:Math.floor(r()*3),afterglow:.22+power*.3};
  });
}
