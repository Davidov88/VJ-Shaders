import{random}from'../audio/dsp.js';
// Tileable 64³ cellular/value-noise volume, generated once, not per pixel per frame.
export function createNoiseVolume(device){
  const size=64,cells=8,r=random(91273),points=Float32Array.from({length:cells**3*3},()=>r());
  const data=new Uint8Array(size**3*4),wrap=x=>(x+cells)%cells;
  const point=(x,y,z,k)=>points[((wrap(z)*cells+wrap(y))*cells+wrap(x))*3+k];
  const values=Float32Array.from({length:cells**3},()=>r());
  const val=(x,y,z)=>values[(wrap(z)*cells+wrap(y))*cells+wrap(x)];
  const noise=(x,y,z)=>{const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);let fx=x-ix,fy=y-iy,fz=z-iz;fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy);fz=fz*fz*(3-2*fz);let sum=0;for(let a=0;a<2;a++)for(let b=0;b<2;b++)for(let c=0;c<2;c++)sum+=val(ix+a,iy+b,iz+c)*(a?fx:1-fx)*(b?fy:1-fy)*(c?fz:1-fz);return sum;};
  for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const px=x/size*cells,py=y/size*cells,pz=z/size*cells,ix=Math.floor(px),iy=Math.floor(py),iz=Math.floor(pz);let nearest=10;
    for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(let c=-1;c<=1;c++){const dx=ix+a+point(ix+a,iy+b,iz+c,0)-px,dy=iy+b+point(ix+a,iy+b,iz+c,1)-py,dz=iz+c+point(ix+a,iy+b,iz+c,2)-pz;nearest=Math.min(nearest,dx*dx+dy*dy+dz*dz);}
    const i=((z*size+y)*size+x)*4;data[i]=Math.round(noise(px,py,pz)*255);data[i+1]=Math.round(Math.max(0,1-Math.sqrt(nearest)/1.15)*255);data[i+2]=Math.round(noise(px*2,py*2,pz*2)*255);data[i+3]=255;
  }
  const texture=device.createTexture({label:'tileable 3D cloud noise',dimension:'3d',size:[size,size,size],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  device.queue.writeTexture({texture},data,{bytesPerRow:size*4,rowsPerImage:size},[size,size,size]);
  return{texture,view:texture.createView(),sampler:device.createSampler({addressModeU:'repeat',addressModeV:'repeat',addressModeW:'repeat',minFilter:'linear',magFilter:'linear'})};
}
