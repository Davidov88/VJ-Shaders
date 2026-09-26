import{analyzePCM}from'./dsp.js';
self.onmessage=({data})=>{try{const map=analyzePCM(data.channels,data.sampleRate,(value,stage)=>self.postMessage({progress:{value,stage}}));self.postMessage({map});}catch(error){self.postMessage({error:error.message});}};
