# MediaPipe face landmarker (vendored)

Served locally so eye tracking works offline (e.g. in the all-in-one Docker image).

- `vision_wasm_internal.js` / `.wasm`: from `@mediapipe/tasks-vision` 0.10.18 (`wasm/`), the version
  bundled into `../webeyetrack/webeyetrack.js`. Apache License 2.0, Copyright Google LLC.
- `face_landmarker.task`: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
  (Apache License 2.0).

Only the SIMD build of the wasm is included; every current browser supports wasm SIMD.
- `LICENSE`: the Apache License 2.0 text that covers both files.
