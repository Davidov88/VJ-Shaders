import{test}from'node:test';
import assert from'node:assert/strict';
import{analyzePCM,FFT,estimateTempo}from'../src/audio/dsp.js';
import{sampleTrackMap}from'../src/audio/index.js';
const rate=22050;
const tone=(hz,seconds=2,amp=.3)=>Float32Array.from({length:rate*seconds},(_,i)=>amp*Math.sin(2*Math.PI*hz*i/rate));
test('FFT resolves a sinusoid at the expected frequency',()=>{const fft=new FFT(2048),out=new Float32Array(1024);fft.spectrum(tone(1000),22050,out);const peak=out.indexOf(Math.max(...out));assert.ok(Math.abs(peak*rate/2048-1000)<rate/2048);});
test('silence produces zero energy, no lightning, no fabricated tempo',()=>{const m=analyzePCM([new Float32Array(rate*3)],rate);assert.equal(m.events.length,0);assert.equal(m.tempo.bpm,null);assert.ok(m.frames.every(f=>Object.values(f).every(Number.isFinite)&&f.energy===0&&f.vocal===0));});
test('antiphase stereo is not canceled',()=>{const a=tone(80),mono=analyzePCM([a],rate),stereo=analyzePCM([a,Float32Array.from(a,x=>-x)],rate);assert.ok(Math.abs(mono.frames[80].rms-stereo.frames[80].rms)<1e-6);assert.ok(stereo.frames[80].sub>.8);});
test('sustained sine does not create repetitive percussion events',()=>{const m=analyzePCM([tone(440,4)],rate);assert.ok(m.events.length<=2,`events: ${m.events.length}`);assert.ok(m.frames[100].vocal>.5);});
test('120 BPM kick attacks are aligned to audio within 35 ms',()=>{
  const a=new Float32Array(rate*9),times=[];
  for(let t=1;t<8;t+=.5){times.push(t);for(let i=0;i<rate*.18;i++){a[Math.floor(t*rate)+i]+=.8*Math.sin(2*Math.PI*(90*i/rate-85*(i/rate)**2))*Math.exp(-i/rate*26);}}
  const m=analyzePCM([a],rate);
  for(const t of times)assert.ok(m.events.some(e=>Math.abs(e.time-t)<.035),`missed ${t}: ${m.events.map(e=>e.time).join(',')}`);
  assert.ok(m.events.length<=times.length+1);assert.ok(Math.abs(m.tempo.bpm-120)<=2);
  assert.ok(m.events.every(e=>Math.abs(e.startTime+e.leaderDuration-e.time)<1e-6));
});
test('sample timing uses actual sample-rate/hop, including track end',()=>{const m=analyzePCM([tone(250,1)],rate);assert.equal(m.fps,rate/256);assert.ok(Number.isFinite(sampleTrackMap(m,900).energy));assert.equal(m.sections.at(-1).end,m.duration);});
test('tiny input is not amplified into a storm',()=>{const m=analyzePCM([tone(440,2,1e-6)],rate);assert.equal(m.events.length,0);assert.ok(m.frames.every(f=>f.energy===0));});
test('tempo with insufficient evidence is unknown',()=>assert.equal(estimateTempo([{time:1},{time:2}],3).bpm,null));
