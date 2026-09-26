export const common=/*wgsl*/`
struct Frame { resolution:vec4f, audio:vec4f, music:vec4f, environment:vec4f, params:vec4f, camera:vec4f };
struct Lamp { position:vec4f, color:vec4f };
@group(0) @binding(0) var<uniform> u:Frame;
@group(0) @binding(1) var<storage,read> lamps:array<Lamp>;
@group(0) @binding(3) var cloudNoise:texture_3d<f32>;
@group(0) @binding(4) var noiseSampler:sampler;
fn hash(p:vec3f)->f32 {var q=fract(p*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
fn noise(p:vec3f)->f32 {
 let i=floor(p);let f=fract(p);let s=f*f*(3.-2.*f);
 return mix(mix(mix(hash(i),hash(i+vec3f(1,0,0)),s.x),mix(hash(i+vec3f(0,1,0)),hash(i+vec3f(1,1,0)),s.x),s.y),mix(mix(hash(i+vec3f(0,0,1)),hash(i+vec3f(1,0,1)),s.x),mix(hash(i+vec3f(0,1,1)),hash(i+vec3f(1,1,1)),s.x),s.y),s.z);
}
fn density(p:vec3f)->f32 {
 let drift=vec3f(u.environment.y,0.,u.environment.y*.21);
 let q=(p+drift)*vec3f(.065,.085,.065);
 let base=textureSampleLevel(cloudNoise,noiseSampler,q,0.);
 let detail=textureSampleLevel(cloudNoise,noiseSampler,q*3.07,0.);
 let weather=noise(vec3f(p.x*.14,1.3,p.z*.14)+drift*.1);
 let shape=base.r*.60+base.g*.40;
 let erosion=(1.-detail.g)*.11+(1.-detail.b)*.05;
 let body=max(0.,shape-.28+weather*.12-erosion)*3.5;
 let lower=1.5+noise(vec3f(p.x*.31,0.,p.z*.31))*.8;
 return body*smoothstep(lower,lower+.75,p.y)*(1.-smoothstep(6.,8.,p.y))*u.environment.x;
}
fn camera()->vec3f{return vec3f(u.camera.x,.05,u.camera.z);}
fn ray(uv:vec2f)->vec3f {let aspect=u.resolution.x/u.resolution.y;return normalize(vec3f((uv.x*2.-1.)*aspect,(1.-uv.y*2.)+.29,1.7));}
fn project(p:vec3f)->vec4f{let q=p-camera();return vec4f(q.x*1.7/(u.resolution.x/u.resolution.y),q.y*1.7-.29*q.z,0.,q.z);}
struct Screen{@builtin(position) position:vec4f,@location(0) uv:vec2f};
@vertex fn fullscreen(@builtin(vertex_index) i:u32)->Screen{var p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:Screen;o.position=vec4f(p[i],0,1);o.uv=p[i]*vec2f(.5,-.5)+.5;return o;}
`;
export const clouds=common+/*wgsl*/`
@fragment fn cloudFS(in:Screen)->@location(0) vec4f{
 let rd=ray(in.uv);let ro=camera();
 let horizon=exp(-abs(rd.y+.08)*6.);
 var sky=mix(vec3f(.009,.016,.034),vec3f(.075,.105,.16),horizon);
 let moon=pow(max(0.,dot(rd,normalize(vec3f(-.6,.68,1.7)))),65.);
 sky+=vec3f(.10,.16,.27)*moon;
 var trans=1.;var light=vec3f(0.);
 let steps=u32(u.params.x);let stepSize=19./f32(steps);
 let jitter=hash(vec3f(floor(in.position.xy),0.));
 for(var i=0u;i<steps;i++){
   let distance=1.5+(f32(i)+jitter)*stepSize;let p=ro+rd*distance;let d=density(p);
   if(d>.005){
     let shadow=density(p+vec3f(-.45,.6,-.2))*.8+density(p+vec3f(-1.1,1.5,-.5))*1.5;
     let shade=exp(-shadow*2.8);
     var illumination=mix(vec3f(.012,.020,.035),vec3f(.21,.27,.36),shade)+moon*.012;
     for(var j=0u;j<u32(u.params.y);j++){
       let delta=p-lamps[j].position.xyz;let dist2=dot(delta,delta);
       illumination+=lamps[j].color.rgb*lamps[j].color.w*3.8/(.7+dist2)*exp(-sqrt(dist2)*.12);
     }
     let wave=.5+.5*sin(p.x*1.6+p.z*.9-u.resolution.z*1.3+noise(p*.7)*4.);
     let aura=pow(wave,5.)*u.music.z*(.18+.22*noise(p*1.5));
     illumination+=mix(vec3f(.18,.12,.65),vec3f(.12,.6,.72),u.music.w)*aura;
     let alpha=1.-exp(-d*stepSize*1.7);light+=trans*alpha*illumination;trans*=1.-alpha;
     if(trans<.015){break;}
   }
 }
 var color=sky*trans+light;
 // Low, dark water horizon; local reflections respond to the same world-space lamps.
 if(rd.y<-.005){
   let distance=(-2.4-ro.y)/rd.y;let p=ro+rd*distance;
   let ripple=noise(vec3f(p.x*2.,p.z*.9,u.resolution.z*.7));
   var water=mix(vec3f(.004,.009,.015),vec3f(.025,.047,.065),pow(1.+rd.y,4.))*(.72+.28*ripple);
   for(var j=0u;j<u32(u.params.y);j++){let dx=p.x-lamps[j].position.x;let spread=exp(-dx*dx/(.3+distance*.15));water+=lamps[j].color.rgb*lamps[j].color.w*spread*(.2+.8*pow(ripple,4.))/(3.+distance);}
   color=mix(color,water,exp(-distance*.025));
 }
 return vec4f(color,trans);
}
`;
export const bolt=common+/*wgsl*/`
struct Segment{a:vec4f,b:vec4f,color:vec4f,life:vec4f};
@group(0) @binding(2) var<storage,read> segments:array<Segment>;
struct BoltOut{@builtin(position) position:vec4f,@location(0) uv:vec2f,@location(1) color:vec4f,@location(2) world:vec3f,@location(3) @interpolate(flat) visible:f32};
@vertex fn boltVS(@builtin(vertex_index) vertex:u32,@builtin(instance_index) index:u32)->BoltOut{
 let s=segments[index];var corners=array<vec2f,6>(vec2f(0,-1),vec2f(1,-1),vec2f(0,1),vec2f(0,1),vec2f(1,-1),vec2f(1,1));let c=corners[vertex];
 let fraction=clamp((s.life.x-s.a.w)/max(.0001,s.b.w-s.a.w),0.,1.);let endpoint=mix(s.a.xyz,s.b.xyz,fraction);
 let a=project(s.a.xyz);let b=project(endpoint);let aspect=u.resolution.x/u.resolution.y;
 let dir=normalize((b.xy/b.w-a.xy/a.w)*vec2f(aspect,1.)+vec2f(.00001));let normal=vec2f(-dir.y/aspect,dir.x);
 let world=mix(s.a.xyz,endpoint,c.x);var clip=project(world);
 let width=max(1.2/u.resolution.y,s.life.z*1.7/clip.w);clip=vec4f(clip.xy+normal*c.y*width*5.*clip.w,clip.zw);
 var o:BoltOut;o.position=clip;o.uv=vec2f(c.x,c.y);o.color=s.color;o.world=world;o.visible=select(0.,s.life.y,fraction>0.);return o;
}
@fragment fn boltFS(in:BoltOut)->@location(0) vec4f{
 if(in.visible<.001){discard;}
 // Integrate foreground density to hide channels INSIDE the cloud volume.
 let delta=in.world-camera();let distance=length(delta);var optical=0.;
 for(var i=0;i<8;i++){optical+=density(camera()+delta*(f32(i)+.5)/8.)*distance/8.;}
 let attenuation=exp(-optical*1.4);
 let core=exp(-in.uv.y*in.uv.y*100.);let halo=exp(-abs(in.uv.y)*4.5)*.2;
 let light=(mix(in.color.rgb,vec3f(1.),.82)*core+in.color.rgb*halo)*in.visible*attenuation;
 return vec4f(light,0.);
}
`;
export const rain=common+/*wgsl*/`
struct Drop{position:vec4f,velocity:vec4f};
@group(0) @binding(2) var<storage,read_write> particles:array<Drop>;
@compute @workgroup_size(64) fn rainCS(@builtin(global_invocation_id) gid:vec3u){
 let id=gid.x;if(id>=4096u){return;}var d=particles[id];let dt=u.resolution.w;let seed=f32(id);
 if(d.position.w==0. || u.params.z>.5){
   let depth=1.5+hash(vec3f(seed,8.,2.))*15.;d.position=vec4f((hash(vec3f(seed,1.,2.))-.5)*24.,-3.+hash(vec3f(seed,3.,2.))*12.,depth,1.);
   d.velocity=vec4f(0.,-(6.+hash(vec3f(seed,5.,2.))*6.),0.,hash(vec3f(seed,9.,2.)));
 }
 let wind=.7+sin(u.resolution.z*.6)*.55+u.audio.z*.8;
 d.velocity.x=mix(d.velocity.x,wind,1.-exp(-dt*2.));d.position.x+=d.velocity.x*dt;d.position.y+=d.velocity.y*dt;
 if(d.position.y< -3.){d.position.y+=12.;d.position.x=(hash(vec3f(seed,floor(u.resolution.z),4.))-.5)*24.;}
 if(d.position.x>12.){d.position.x-=24.;}particles[id]=d;
}
`;
export const rainRender=common+/*wgsl*/`
struct Drop{position:vec4f,velocity:vec4f};
@group(0) @binding(2) var<storage,read> particles:array<Drop>;
struct RainOut{@builtin(position) position:vec4f,@location(0) uv:vec2f,@location(1) color:vec3f};
@vertex fn rainVS(@builtin(vertex_index) vertex:u32,@builtin(instance_index) id:u32)->RainOut{
 let d=particles[id];var corners=array<vec2f,6>(vec2f(0,-1),vec2f(1,-1),vec2f(0,1),vec2f(0,1),vec2f(1,-1),vec2f(1,1));let c=corners[vertex];
 let world=d.position.xyz-d.velocity.xyz*c.x*.028;var clip=project(world);clip.x+=c.y*.00065*clip.w;
 var illumination=vec3f(.18,.28,.38);
 for(var j=0u;j<u32(u.params.y);j++){let delta=world-lamps[j].position.xyz;illumination+=lamps[j].color.rgb*lamps[j].color.w/(2.+dot(delta,delta));}
 let amount=u.environment.z;let gate=select(0.,1.,d.velocity.w<amount);
 var o:RainOut;o.position=clip;o.uv=vec2f(c.x,c.y);o.color=illumination*gate*.35*(.4+6./d.position.z);return o;
}
@fragment fn rainFS(in:RainOut)->@location(0) vec4f{return vec4f(in.color*(1.-abs(in.uv.y))*(1.-in.uv.x*.7),0.);}
`;
export const postHeader=/*wgsl*/`
struct Post{resolution:vec4f,controls:vec4f,audio:vec4f};
@group(0) @binding(0) var scene:texture_2d<f32>;
@group(0) @binding(1) var bloom:texture_2d<f32>;
@group(0) @binding(2) var linearSampler:sampler;
@group(0) @binding(3) var<uniform> post:Post;
struct Screen{@builtin(position) position:vec4f,@location(0) uv:vec2f};
@vertex fn fullscreen(@builtin(vertex_index) i:u32)->Screen{var p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:Screen;o.position=vec4f(p[i],0,1);o.uv=p[i]*vec2f(.5,-.5)+.5;return o;}
`;
export const bloomShader=postHeader+/*wgsl*/`
@fragment fn fs(in:Screen)->@location(0) vec4f{
 let texel=post.controls.xy/vec2f(textureDimensions(scene));var sum=vec3f(0.);
 for(var i=-6;i<=6;i++){let c=textureSample(scene,linearSampler,in.uv+texel*f32(i)*1.6).rgb;let bright=max(c-vec3f(post.controls.z),vec3f(0.));let weight=exp(-f32(i*i)/15.);sum+=bright*weight;}
 return vec4f(sum/6.8,1.);
}
`;
export const composeShader=postHeader+/*wgsl*/`
@fragment fn fs(in:Screen)->@location(0) vec4f{
 var c=textureSample(scene,linearSampler,in.uv).rgb+textureSample(bloom,linearSampler,in.uv).rgb*post.controls.x;
 let vignette=1.-.23*dot(in.uv-.5,in.uv-.5)*2.;c*=vignette*post.controls.y;
 c=clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),vec3f(0.),vec3f(1.));
 return vec4f(pow(c,vec3f(1./2.2)),1.);
}
`;
export const copyShader=postHeader+/*wgsl*/`@fragment fn fs(in:Screen)->@location(0) vec4f{return textureSample(scene,linearSampler,in.uv);}`;
