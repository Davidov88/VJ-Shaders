# VJ-Shaders / VJ Storm

Мобильная аудиореактивная грозовая VJ-сцена для Chrome Android на WebGPU.

## Что уже реализовано

- предварительный анализ всего трека до запуска визуализации;
- карта энергии, bass / mid / high, transient и секций композиции;
- заранее рассчитанные события молний;
- WebGPU/WGSL полноэкранный renderer без тяжелого 3D-фреймворка;
- многослойные процедурные тучи с параллаксом и динамической плотностью;
- разные по мощности и рисунку молнии с цветом, зависящим от спектральной карты;
- вспышки внутри облаков, glow и вторичные ветви;
- аудиореактивный дождь;
- опциональный синтетический Thunder FX;
- скрываемый минимальный UI;
- автоматическое динамическое разрешение под FPS;
- запись canvas + аудио в WebM через MediaRecorder, если браузер поддерживает API.

## Запуск

WebGPU требует secure context. Используйте HTTPS или localhost.

Для локального запуска достаточно статического HTTP-сервера:

```bash
python -m http.server 8080
```

После этого откройте `http://localhost:8080` в Chrome.

## GitHub Pages

Workflow `.github/workflows/pages.yml` публикует содержимое репозитория как статический сайт. В настройках GitHub Pages выберите источник `GitHub Actions`.

## Архитектура

- `src/audio-analysis.js` - O(N) предварительный анализ PCM: bass / mid / high, transients, секции и lightning events.
- `src/gpu-engine.js` - raw WebGPU renderer и WGSL shader: sky, layered volumetric-style clouds, procedural lightning, internal cloud flashes, rain, tone mapping, dynamic render scale.
- `src/app.js` - playback, event scheduler, минимальный UI, synthetic thunder, запись видео.

## Почему raw WebGPU

Первая версия использует чистый WebGPU/WGSL, чтобы на мобильном Chrome контролировать стоимость каждого пикселя и не зависеть от экспериментальных изменений WebGPURenderer/TSL.

## Следующие этапы

1. Multi-pass bloom / anamorphic glow.
2. Half-resolution cloud buffer + temporal accumulation.
3. GPU particle rain.
4. Water pass с отражением молний и ripple impacts.
5. Более точная onset/beat карта и BPM estimation.
6. Presets.
7. Расширенные настройки записи.
