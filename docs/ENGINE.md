# Storm v3: audio and render contracts

## Audio

Original audio plays through a reusable AudioContext, a fresh MediaElementSource per file, analyser and limiter. Synthetic thunder is optional and off by default. It never feeds back into the offline analysis. All processing stays in the browser; no uploads or paid services.

The browser decodes an analysis copy at 22,050 Hz. A module worker runs a Hann-windowed 2048-point FFT every 256 samples (86.13 frames/s). Stereo spectral powers are averaged, preventing antiphase cancellation. Six bands, RMS, spectral flux, low/high onset proxies, centroid, flatness and a sustained harmonic proxy are stored in the track map. Percussion labels are estimates, not isolated drum stems. Quiet inputs are gated before normalization.

Onsets use a local median threshold and a refractory interval. Tempo is an estimate with confidence; half/double-time ambiguity is possible. Sections are based on two-second feature changes, minimum four-second spans; labels such as drop and climax are heuristic. Sample time is exactly `frame * hop / sampleRate`, avoiding cumulative drift.

`sampleTrackMap(map, audio.currentTime)` yields the shared audio bus. The main clock is the media element clock, never wall time. Pause freezes both audio-driven motion and lightning. Seeking reconstructs the event pool and resets rain. Leaders start 120–270 ms before an onset; the primary return stroke occurs on the detected onset. Strokes are artistically slowed to remain visible at 30 FPS, not a scientific electrical discharge solver.

Vocal default: **harmonic proxy, not source separation**. Synths, strings and other sustained instruments can drive it. An optional time-aligned vocal stem replaces this bus with the stem energy, without playing a second audio track. Do not describe the default as AI stem separation.

## Graphics

Raw WebGPU/WGSL; no runtime CDN/library dependency. The existing raw WebGPU architecture is retained. Three.js/TSL shaders cannot be pasted verbatim: extensions use the WGSL contract below.

1. Low-resolution volume raymarch: tileable 64³ cellular/value noise, density extinction, approximate directional shadowing and local lights from active bolts. 26–52 steps under adaptive quality.
2. Compute rain: 4096 persistent world-space particles, negative vertical velocity, depth perspective, wind and continuous respawn above the scene. Compute workgroup size 64.
3. HDR `rgba16float` scene: upsampled clouds, instanced branching lightning segments, foreground density attenuation and rain lit by the same lightning lights. Water reflection is approximate, not ray-traced.
4. Quarter-resolution bloom: threshold extraction and separable horizontal/vertical blur.
5. Optional ordered HDR shader effects using ping/pong targets.
6. Exposure, bloom composite, filmic tone mapping, gamma, vignette, canvas.

The lightning pool holds up to eight active events, deterministically seeded, with independent topology, positions, color, leader duration, branches, restrikes and afterglow. There are six event presets: internal, arc, fork, impact, needle, restrike. The geometry is 3D; segment ribbons face the camera. Cloud light uses three representative point samples per channel, not full multiple-scattering transport.

## Add a post-effect

```js
await window.storm.renderer.addPostEffect({
  id: 'music-tint',
  wgsl: `
    fn effect(uv: vec2f, hdr: vec3f, audio: vec4f, time: f32) -> vec3f {
      // audio = energy, bass, high, vocal; input/output are linear HDR.
      return hdr * mix(vec3f(1.), vec3f(.8, .92, 1.15), audio.w * .3);
    }
  `
});
window.storm.renderer.setEffectEnabled('music-tint', false);
window.storm.renderer.removePostEffect('music-tint');
```

`scene`, `bloom`, `linearSampler` and `post` are available to WGSL extensions. Use `textureSampleLevel` inside nonuniform flow. Effects run before tone mapping, after base-scene bloom. Shader compilation is checked before installing an effect; a failed effect does not replace the working chain. Resource allocation happens on resize/registration; buffers are reused per frame.

## Performance and diagnostics

30 FPS cadence. Auto quality adjusts render scale and ray steps with four-second hysteresis; it does not treat intentional 33 ms cadence as a failure. Optional timestamp queries measure the GPU frame asynchronously; if unavailable, frame pacing is the fallback. No special f16/subgroup feature is required. Canvas budget: 1.5 million pixels. Cloud buffer: 45% per axis of scene size. Bloom: 25% per axis. UI stays at native CSS resolution.

`window.storm.renderer.metrics` contains measured FPS, GPU milliseconds, active bolts and segments. `window.storm.map` exposes the analysis map. `window.storm.transport.liveRMS()` monitors the actual output graph. Device loss displays a reload instruction. The application requires WebGPU: it does not silently pretend to supply a WebGL fallback.

## Findings in the replaced v2 path

- One mutable `lightning` object overwrote preceding events before their animation completed.
- Clouds were shifted 2D noise layers; there was no volume traversal or channel occlusion.
- Rain hashed fixed screen cells and advanced `fract(y + time*speed)`, making the pattern travel upward and reset within cells.
- Audio used two one-pole filters, broad-band energy differences, no FFT or measured tempo; no vocal bus.
- A second file created a new Audio element, but `setupAudioGraph()` returned early and retained the first source.
- Event animation used wall time while environmental movement used playback time.
- Render quality thresholds targeted 60 FPS, not the requested 30 FPS.

## Validation boundary

Automated signal and topology tests are in `tests/`. Browser QA exercises original audio loading, FFT worker, playback, seek, pause, repeated file loads, silent input, an optional stem and shader registration. Desktop Chrome GPU execution and a 393×873 mobile viewport are checked. A mobile viewport is not an Adreno performance test. A final performance and visual check on the actual phone and the user's actual track remains necessary.
