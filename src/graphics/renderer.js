import{clouds,bolt,rain,rainRender,bloomShader,composeShader,copyShader,postHeader}from'./shaders.js';
import{LightningPool,MAX_EVENTS,MAX_SEGMENTS,color}from'./lightning.js';
import{createNoiseVolume}from'./noise-volume.js';
export class StormRenderer{
  constructor(canvas){
    this.canvas=canvas;this.renderScale=.72;this.cloudScale=.45;this.steps=44;this.autoQuality=true;this.targetFPS=30;
    this.pool=new LightningPool();this.effects=[];this.time=0;this.lastTime=0;this.drift=0;this.lastWall=0;this.resetParticles=true;
    this.uniforms=new Float32Array(24);this.lampData=new Float32Array(MAX_EVENTS*3*8);this.segmentData=new Float32Array(MAX_SEGMENTS*16);
    this.metrics={fps:0,gpuMs:null,activeBolts:0,segments:0,passes:7};this.frameTimes=[];this.qualityAt=0;this.frame=0;this.bloom=.85;this.exposure=1.05;
  }
  async module(code,label){const m=this.device.createShaderModule({code,label});const info=await m.getCompilationInfo();const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw new Error(`${label}: ${errors.map(e=>`${e.lineNum}:${e.linePos} ${e.message}`).join('; ')}`);return m;}
  async init(){
    if(!navigator.gpu)throw new Error('Нужен Chrome с WebGPU и HTTPS / localhost.');
    const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw new Error('WebGPU-адаптер недоступен.');
    const timestamps=adapter.features.has('timestamp-query');
    this.device=await adapter.requestDevice({requiredFeatures:timestamps?['timestamp-query']:[]});const d=this.device;
    d.addEventListener('uncapturederror',e=>{this.error=e.error.message;this.onError?.(new Error(e.error.message));});
    d.lost.then(info=>{this.lost=true;this.onError?.(new Error(`WebGPU: ${info.message||info.reason}. Перезагрузите страницу.`));});
    this.context=this.canvas.getContext('webgpu');this.format=navigator.gpu.getPreferredCanvasFormat();this.context.configure({device:d,format:this.format,alphaMode:'opaque'});
    this.uniform=d.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.lamps=d.createBuffer({size:this.lampData.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    this.segments=d.createBuffer({size:this.segmentData.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    this.particles=d.createBuffer({size:4096*32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
    const all=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT|GPUShaderStage.COMPUTE;
    this.noise=createNoiseVolume(d);
    const base=[{binding:0,visibility:all,buffer:{type:'uniform'}},{binding:1,visibility:all,buffer:{type:'read-only-storage'}},{binding:3,visibility:all,texture:{viewDimension:'3d'}},{binding:4,visibility:all,sampler:{}}];
    this.cloudLayout=d.createBindGroupLayout({entries:base});
    this.geometryLayout=d.createBindGroupLayout({entries:[...base,{binding:2,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}}]});
    this.computeLayout=d.createBindGroupLayout({entries:[...base,{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}]});
    const group=(layout,buffer)=>d.createBindGroup({layout,entries:[{binding:0,resource:{buffer:this.uniform}},{binding:1,resource:{buffer:this.lamps}},{binding:3,resource:this.noise.view},{binding:4,resource:this.noise.sampler},...(buffer?[{binding:2,resource:{buffer}}]:[])]});
    this.cloudGroup=group(this.cloudLayout);this.boltGroup=group(this.geometryLayout,this.segments);this.rainGroup=group(this.geometryLayout,this.particles);this.computeGroup=group(this.computeLayout,this.particles);
    this.cloudPipeline=await this.pipeline(clouds,'clouds','fullscreen','cloudFS',this.cloudLayout);
    this.boltPipeline=await this.pipeline(bolt,'lightning','boltVS','boltFS',this.geometryLayout,true);
    this.rainPipeline=await this.pipeline(rainRender,'rain','rainVS','rainFS',this.geometryLayout,true);
    this.computePipeline=await d.createComputePipelineAsync({label:'rain simulation',layout:d.createPipelineLayout({bindGroupLayouts:[this.computeLayout]}),compute:{module:await this.module(rain,'rain compute'),entryPoint:'rainCS'}});
    this.postLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{}},{binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
    this.sampler=d.createSampler({magFilter:'linear',minFilter:'linear'});
    this.copyPipeline=await this.pipeline(copyShader,'upsample','fullscreen','fs',this.postLayout);
    this.bloomPipeline=await this.pipeline(bloomShader,'bloom','fullscreen','fs',this.postLayout);
    this.composePipeline=await this.pipeline(composeShader,'tone mapping','fullscreen','fs',this.postLayout,false,this.format);
    this.copyUniform=this.postUniform();this.blurX=this.postUniform();this.blurY=this.postUniform();this.composeUniform=this.postUniform();
    if(timestamps){this.query=d.createQuerySet({type:'timestamp',count:2});this.resolve=d.createBuffer({size:256,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});this.readbacks=Array.from({length:3},()=>({buffer:d.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),busy:false}));}
    this.resize(true);return{...adapter.info,vendor:adapter.info?.vendor,architecture:adapter.info?.architecture,timestamps};
  }
  async pipeline(code,label,vs,fs,layout,add=false,format='rgba16float'){
    const module=await this.module(code,label),blend=add?{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}}:undefined;
    return this.device.createRenderPipelineAsync({label,layout:this.device.createPipelineLayout({bindGroupLayouts:[layout]}),vertex:{module,entryPoint:vs},fragment:{module,entryPoint:fs,targets:[{format,blend}]},primitive:{topology:'triangle-list'}});
  }
  postUniform(){return this.device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});}
  texture(w,h,label){const texture=this.device.createTexture({label,size:[w,h],format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});return{texture,view:texture.createView()};}
  postGroup(source,bloom,uniform){return this.device.createBindGroup({layout:this.postLayout,entries:[{binding:0,resource:source.view},{binding:1,resource:bloom.view},{binding:2,resource:this.sampler},{binding:3,resource:{buffer:uniform}}]});}
  resize(force=false){
    if(!this.device||this.lost)return;
    const dpr=Math.min(devicePixelRatio||1,2.5),pixelLimit=1_500_000;
    let w=Math.round(innerWidth*dpr*this.renderScale),h=Math.round(innerHeight*dpr*this.renderScale);const k=Math.min(1,Math.sqrt(pixelLimit/(w*h)));w=Math.max(2,Math.round(w*k));h=Math.max(2,Math.round(h*k));
    if(!force&&this.canvas.width===w&&this.canvas.height===h)return;
    this.canvas.width=w;this.canvas.height=h;
    for(const t of this.targets||[])t.texture.destroy();
    this.cloud=this.texture(Math.max(2,Math.round(w*this.cloudScale)),Math.max(2,Math.round(h*this.cloudScale)),'cloud volume');
    this.scene=this.texture(w,h,'HDR scene');this.ping=this.texture(w,h,'effect ping');this.pong=this.texture(w,h,'effect pong');
    this.bright=this.texture(Math.max(2,w>>2),Math.max(2,h>>2),'bloom horizontal');this.blurred=this.texture(Math.max(2,w>>2),Math.max(2,h>>2),'bloom vertical');
    this.targets=[this.cloud,this.scene,this.ping,this.pong,this.bright,this.blurred];
    this.copyGroup=this.postGroup(this.cloud,this.cloud,this.copyUniform);this.blurXGroup=this.postGroup(this.scene,this.scene,this.blurX);this.blurYGroup=this.postGroup(this.bright,this.bright,this.blurY);
    this.device.queue.writeBuffer(this.blurX,0,new Float32Array([w,h,0,0,1,0,.6,0,0,0,0,0]));this.device.queue.writeBuffer(this.blurY,0,new Float32Array([w,h,0,0,0,1,0,0,0,0,0,0]));
    this.rebindEffects();
  }
  // Public extension point. WGSL supplies fn effect(uv, linearHDR, audio, time) -> vec3f.
  async addPostEffect({id,wgsl,enabled=true}){
    if(this.effects.some(e=>e.id===id))throw new Error(`Duplicate effect: ${id}`);
    const code=postHeader+wgsl+'\n@fragment fn fs(in:Screen)->@location(0) vec4f {let c=textureSample(scene,linearSampler,in.uv).rgb;return vec4f(effect(in.uv,c,post.audio,post.resolution.z),1.);}';
    const pipeline=await this.pipeline(code,id,'fullscreen','fs',this.postLayout);
    this.effects.push({id,pipeline,enabled,uniform:this.postUniform()});this.rebindEffects();
  }
  setEffectEnabled(id,enabled){const e=this.effects.find(e=>e.id===id);if(e){e.enabled=enabled;this.rebindEffects();}}
  removePostEffect(id){const e=this.effects.find(e=>e.id===id);e?.uniform.destroy();this.effects=this.effects.filter(e=>e.id!==id);this.rebindEffects();}
  rebindEffects(){
    if(!this.scene)return;let source=this.scene,index=0;
    for(const e of this.effects){if(!e.enabled)continue;e.target=index++%2?this.pong:this.ping;e.group=this.postGroup(source,this.blurred,e.uniform);source=e.target;}
    this.composeGroup=this.postGroup(source,this.blurred,this.composeUniform);
  }
  setAutoQuality(v){this.autoQuality=!!v;}
  setTrack(map){this.pool.setMap(map);this.resetParticles=true;this.lastTime=0;this.drift=0;}
  reset(time=0){this.pool.time=-999;this.resetParticles=true;this.lastTime=time;this.drift=time*.09;}
  pass(encoder,label,target,pipeline,group,{load='clear',count=3,instances=1,timestampWrites}={}){
    const p=encoder.beginRenderPass({label,colorAttachments:[{view:target,loadOp:load,storeOp:'store',clearValue:[0,0,0,1]}],timestampWrites});p.setPipeline(pipeline);p.setBindGroup(0,group);p.draw(count,instances);p.end();
  }
  render(sample,time,playing=true){
    if(!this.device||this.lost)return;
    const wall=performance.now(),wallDT=this.lastWall?(wall-this.lastWall):33.333;this.lastWall=wall;
    this.frameTimes.push(wallDT);if(this.frameTimes.length>90)this.frameTimes.shift();this.metrics.fps=1000/(this.frameTimes.reduce((a,b)=>a+b,0)/this.frameTimes.length);
    const jump=Math.abs(time-this.lastTime)>.2||time<this.lastTime;let dt=playing?Math.min(.08,Math.max(0,time-this.lastTime)):0;this.lastTime=time;this.time=time;
    if(jump){this.resetParticles=true;this.drift=time*.09;dt=0;}
    this.drift+=dt*(.07+sample.bass*.035);
    const active=this.pool.update(time);let lampCount=0,segmentCount=0;
    for(const b of active){const rgb=color(b.event.hue),state=b.state;
      for(const pos of b.lights){this.lampData.set([...pos,1,...rgb,state.charge*(.5+b.event.power)],lampCount++*8);}
      for(const s of b.segments){if(segmentCount>=MAX_SEGMENTS)break;this.segmentData.set([...s.a,s.t0,...s.b,s.t1,...rgb,1,state.progress,state.brightness*(s.branch?.42:1),s.width,0],segmentCount++*16);}
    }
    this.metrics.activeBolts=active.length;this.metrics.segments=segmentCount;
    const width=this.canvas.width,height=this.canvas.height;
    this.uniforms.set([width,height,time,dt,sample.energy,sample.bass,sample.high,sample.transient,sample.kick,sample.snare,sample.vocal,sample.hue||.6,.85+sample.sectionEnergy*.55,this.drift,Math.min(.95,sample.energy*.65+sample.high*.25),0,this.steps,lampCount,this.resetParticles?1:0,0,Math.sin(time*.037)*.22,0,Math.sin(time*.021)*.1,0]);
    const queue=this.device.queue;queue.writeBuffer(this.uniform,0,this.uniforms);if(lampCount)queue.writeBuffer(this.lamps,0,this.lampData,0,lampCount*8);if(segmentCount)queue.writeBuffer(this.segments,0,this.segmentData,0,segmentCount*16);
    const postData=new Float32Array([width,height,time,dt,this.bloom,this.exposure,0,0,sample.energy,sample.bass,sample.high,sample.vocal]);queue.writeBuffer(this.composeUniform,0,postData);for(const e of this.effects)if(e.enabled)queue.writeBuffer(e.uniform,0,postData);
    const encoder=this.device.createCommandEncoder({label:'storm frame'});
    const querySlot=this.query&&this.frame%15===0?this.readbacks.find(x=>!x.busy):null;
    this.pass(encoder,'cloud volume',this.cloud.view,this.cloudPipeline,this.cloudGroup,{timestampWrites:querySlot?{querySet:this.query,beginningOfPassWriteIndex:0}:undefined});
    const compute=encoder.beginComputePass({label:'rain integration'});compute.setPipeline(this.computePipeline);compute.setBindGroup(0,this.computeGroup);compute.dispatchWorkgroups(64);compute.end();this.resetParticles=false;
    this.pass(encoder,'upsample clouds',this.scene.view,this.copyPipeline,this.copyGroup);
    if(segmentCount)this.pass(encoder,'3D lightning',this.scene.view,this.boltPipeline,this.boltGroup,{load:'load',count:6,instances:segmentCount});
    this.pass(encoder,'rain',this.scene.view,this.rainPipeline,this.rainGroup,{load:'load',count:6,instances:4096});
    this.pass(encoder,'bloom X',this.bright.view,this.bloomPipeline,this.blurXGroup);this.pass(encoder,'bloom Y',this.blurred.view,this.bloomPipeline,this.blurYGroup);
    for(const e of this.effects)if(e.enabled)this.pass(encoder,e.id,e.target.view,e.pipeline,e.group);
    this.pass(encoder,'tone mapping',this.context.getCurrentTexture().createView(),this.composePipeline,this.composeGroup,{timestampWrites:querySlot?{querySet:this.query,endOfPassWriteIndex:1}:undefined});
    if(querySlot){encoder.resolveQuerySet(this.query,0,2,this.resolve,0);encoder.copyBufferToBuffer(this.resolve,0,querySlot.buffer,0,16);querySlot.busy=true;}
    queue.submit([encoder.finish()]);this.frame++;
    if(querySlot)querySlot.buffer.mapAsync(GPUMapMode.READ).then(()=>{const a=new BigUint64Array(querySlot.buffer.getMappedRange());const ms=Number(a[1]-a[0])/1e6;if(ms>0&&ms<1000)this.metrics.gpuMs=this.metrics.gpuMs===null?ms:this.metrics.gpuMs*.7+ms*.3;querySlot.buffer.unmap();querySlot.busy=false;}).catch(()=>{querySlot.busy=false;});
    this.adjustQuality(wall);return this.metrics;
  }
  adjustQuality(now){
    if(!this.autoQuality||now-this.qualityAt<4000||this.frameTimes.length<45)return;this.qualityAt=now;
    const p75=[...this.frameTimes].sort((a,b)=>a-b)[Math.floor(this.frameTimes.length*.75)],gpu=this.metrics.gpuMs;
    const slow=(gpu!==null&&gpu>29)||p75>43,fast=gpu!==null&&gpu<19&&p75<36;
    const next=Math.max(.4,Math.min(.9,this.renderScale+(slow?-.06:fast?.025:0)));
    if(Math.abs(next-this.renderScale)>.01){this.renderScale=next;this.steps=Math.round(26+(next-.4)/.5*26);this.resize(true);this.frameTimes=[];}
  }
  dispose(){this.lost=true;this.targets?.forEach(t=>t.texture.destroy());this.noise?.texture.destroy();this.effects.forEach(e=>e.uniform.destroy());this.device?.destroy();}
}
