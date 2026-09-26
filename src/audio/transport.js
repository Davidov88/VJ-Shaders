export class AudioTransport{
  constructor(){this.audio=null;this.url=null;this.nodes=new Set();}
  async init(){
    if(this.context)return;this.context=new AudioContext({latencyHint:'interactive'});const c=this.context;
    this.master=c.createGain();this.fx=c.createGain();this.fx.gain.value=.4;
    this.limiter=c.createDynamicsCompressor();this.limiter.threshold.value=-3;this.limiter.knee.value=3;this.limiter.ratio.value=12;this.limiter.attack.value=.003;this.limiter.release.value=.18;
    this.analyser=c.createAnalyser();this.analyser.fftSize=2048;this.analyser.smoothingTimeConstant=.1;this.wave=new Float32Array(2048);
    this.destination=c.createMediaStreamDestination();this.master.connect(this.analyser);this.analyser.connect(this.limiter);this.fx.connect(this.limiter);this.limiter.connect(c.destination);this.limiter.connect(this.destination);
    this.noise=c.createBuffer(1,Math.floor(c.sampleRate*3),c.sampleRate);let last=0;const data=this.noise.getChannelData(0);for(let i=0;i<data.length;i++){last=last*.87+(Math.random()*2-1)*.13;data[i]=last;}
  }
  async load(file,signal){
    await this.init();this.unload();
    const url=URL.createObjectURL(file),audio=new Audio(url);audio.preload='auto';this.audio=audio;this.url=url;
    try{await new Promise((resolve,reject)=>{
      const cleanup=()=>{audio.removeEventListener('canplay',ready);audio.removeEventListener('error',error);signal?.removeEventListener('abort',abort);clearTimeout(timer);};
      const ready=()=>{cleanup();resolve();},error=()=>{cleanup();reject(new Error('Не удалось воспроизвести файл'));},abort=()=>{cleanup();reject(new DOMException('Отменено','AbortError'));};
      const timer=setTimeout(()=>{cleanup();reject(new Error('Превышено время загрузки аудио'));},30000);
      audio.addEventListener('canplay',ready,{once:true});audio.addEventListener('error',error,{once:true});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}audio.load();
    });
    if(signal?.aborted)throw new DOMException('Отменено','AbortError');
    this.source=this.context.createMediaElementSource(audio);this.source.connect(this.master);
    }catch(e){if(this.audio===audio)this.unload();throw e;}
  }
  unload(){this.pause();this.source?.disconnect();this.source=null;if(this.audio){this.audio.removeAttribute('src');this.audio.load();}if(this.url)URL.revokeObjectURL(this.url);this.audio=null;this.url=null;}
  async play(){await this.context.resume();await this.audio?.play();}
  pause(){this.audio?.pause();this.cancelFX();}
  seek(time){this.cancelFX();if(this.audio)this.audio.currentTime=Math.max(0,Math.min(this.audio.duration||0,time));}
  get time(){return this.audio?.currentTime||0;}
  get playing(){return !!this.audio&&!this.audio.paused&&!this.audio.ended;}
  liveRMS(){if(!this.analyser)return 0;this.analyser.getFloatTimeDomainData(this.wave);let s=0;for(const x of this.wave)s+=x*x;return Math.sqrt(s/this.wave.length);}
  cancelFX(){for(const node of this.nodes){try{node.stop();}catch{}}this.nodes.clear();}
  thunder(event){
    if(!this.context||!this.playing)return;const c=this.context,t=c.currentTime+.10+(1-event.power)*.24;
    const source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain();source.buffer=this.noise;source.playbackRate.value=.7+(event.seed%100)/300;
    filter.type='lowpass';filter.frequency.value=190+event.power*450;
    gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.10+event.power*.27,t+.018);gain.gain.exponentialRampToValueAtTime(.0001,t+1.1+event.power);
    source.connect(filter).connect(gain).connect(this.fx);source.start(t);source.stop(t+2.8);this.nodes.add(source);source.onended=()=>{this.nodes.delete(source);source.disconnect();filter.disconnect();gain.disconnect();};
  }
}
