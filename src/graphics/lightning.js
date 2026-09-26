import{random,clamp,mix}from'../audio/dsp.js';
export const MAX_EVENTS=8,MAX_SEGMENTS=2400;
export function color(h){return[0,2/3,1/3].map(o=>{const k=((h+o)%1)*6;return .25+.75*clamp(Math.abs(k-3)-1);});}
export function generateBolt(event){
  const r=random(event.seed),z=5+r()*8,x=(event.zone-.5)*8+(r()-.5)*5;
  const start=[x,3.8+r()*1.6,z],horizontal=['arc','internal'].includes(event.type);
  const end=horizontal?[x+(r()>.5?1:-1)*(2+r()*4),2.3+r()*2,z+(r()-.5)*3]:[x+(r()-.5)*4,-2.4,z+(r()-.5)*2];
  const segments=[],main=[],steps=event.type==='needle'?22:40;
  let prev=start,walkX=0,walkZ=0;
  for(let i=1;i<=steps;i++){
    const t=i/steps,envelope=Math.sin(t*Math.PI);walkX=walkX*.68+(r()-.5)*.6;walkZ=walkZ*.68+(r()-.5)*.5;
    const next=[mix(start[0],end[0],t)+walkX*envelope,mix(start[1],end[1],t)+(horizontal?(r()-.5)*.3:0),mix(start[2],end[2],t)+walkZ*envelope];
    segments.push({a:prev,b:next,t0:(i-1)/steps,t1:t,width:event.type==='impact'?.026:event.type==='needle'?.009:.016,branch:0});main.push(next);prev=next;
  }
  for(let j=0;j<event.branchCount;j++){
    const index=3+Math.floor(r()*(steps-10)),origin=main[index],length=3+Math.floor(r()*9),side=r()>.5?1:-1;let a=origin;
    for(let k=1;k<=length;k++){
      const b=[a[0]+side*(.1+r()*.3),a[1]-(horizontal?(r()-.45)*.35:.09+r()*.19),a[2]+(r()-.5)*.4];
      segments.push({a,b,t0:clamp(index/steps+(k-1)/length*.22),t1:clamp(index/steps+k/length*.22),width:.007*(1-k/(length+2)),branch:1});a=b;
    }
  }
  return{event,segments,start,end,lights:[start,main[Math.floor(steps*.32)],main[Math.floor(steps*.64)]]};
}
export function boltState(e,time){
  const age=time-e.startTime,impact=time-e.time;
  if(age<0||impact>1)return{progress:0,brightness:0,charge:0,active:false};
  const progress=clamp(Math.floor(age/e.leaderDuration*18)/18);
  if(impact<0)return{progress,brightness:.18+.14*progress,charge:.06+progress*.16,active:true};
  // Pulses last at least one 30 FPS frame; source timestamps stay tied to the music clock.
  let flash=2.8*Math.exp(-impact*25)+.10*Math.exp(-impact/Math.max(.05,e.afterglow));
  for(let i=0;i<e.restrikeCount;i++){const at=.10+i*.115,dt=impact-at;if(dt>=0)flash+=1.9*Math.exp(-dt*35)*(1-i*.18);}
  return{progress:1,brightness:flash*(.7+e.power*1.4),charge:flash,active:true};
}
export class LightningPool{
  constructor(){this.events=[];this.cache=new Map();this.cursor=0;this.time=-1;this.active=[];}
  setMap(map){this.events=map?.events||[];this.cache.clear();this.cursor=0;this.time=-1;this.active=[];}
  update(time){
    if(time<this.time||time-this.time>1.2){let lo=0,hi=this.events.length;while(lo<hi){const m=(lo+hi)>>1;if(this.events[m].time<time-1)lo=m+1;else hi=m;}this.cursor=lo;this.active=[];}
    this.time=time;
    // Event order is by impact. A fixed lookahead handles unequal leader durations.
    while(this.cursor<this.events.length&&this.events[this.cursor].time<=time+.3){const e=this.events[this.cursor++];if(e.time>=time-1){let b=this.cache.get(e.seed);if(!b){b=generateBolt(e);this.cache.set(e.seed,b);}this.active.push(b);}}
    this.active=this.active.filter(b=>time-b.event.time<=1);
    if(this.cache.size>64){for(const[k,b]of this.cache)if(b.event.time<time-2)this.cache.delete(k);}
    return this.active.map(b=>({...b,state:boltState(b.event,time)})).filter(b=>b.state.active).sort((a,b)=>b.state.brightness-a.state.brightness).slice(0,MAX_EVENTS);
  }
}
