# VJ Storm v3

Audio-reactive WebGPU storm. Load a local track, wait for analysis, press Play. Runs entirely in the browser; audio is not uploaded.

## Run

Node.js: `npm start`, then http://127.0.0.1:8765. Or serve this directory over HTTPS. Chrome with WebGPU is required. There is no WebGL fallback.

## Engine

- FFT analysis in a worker, six frequency bands, adaptive onset detection, estimated tempo, composition sections.
- A pool of deterministic 3D branching discharges: stepped leaders, onset-aligned strokes, restrikes, afterglow, six presets.
- Raymarched cloud volume with 3D cellular noise, shadowing, local lightning illumination and channel occlusion.
- 4096 persistent GPU rain particles, downward motion, wind, perspective depth.
- HDR render targets, separable bloom, exposure and tone mapping; extensible WGSL post-effect chain.
- 30 FPS target with GPU timing when supported and adaptive resolution.
- Minimal hideable UI, seeking, repeated track loading, optional thunder and WebM recording.
- Separate harmonic/vocal visual bus. Default is a harmonic proxy, NOT stem separation. A time-aligned vocal stem can be loaded for accurate vocal energy.

## Validation and extension

`npm test` runs signal and event regression tests. See [docs/ENGINE.md](docs/ENGINE.md) for the audio contract, shader extension example, performance limits and v2 audit findings. Chrome desktop and a mobile viewport were exercised; real Adreno performance and the user's own track still need device testing.
