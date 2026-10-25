# WebEyeTrack (vendored)

[WebEyeTrack](https://github.com/RedForestAI/WebEyeTrack) by Davalos et al., MIT licence (see LICENSE;
bundled dependencies' licences in THIRD_PARTY_LICENSES.txt). Paper: https://arxiv.org/abs/2508.19544

- `webeyetrack.js`: built from commit 75fbd2f with `npm ci && npm run build` in `js/`, after
  `git apply neurochat.patch` (in this folder). The patch:
  - loads the MediaPipe wasm for tasks-vision 0.10.18 (the version bundled) instead of 0.10.3;
  - keeps calibration points and click points in separate budgets (upstream keeps only the last 5 of
    either, so a 9-dot calibration lost 4 dots and every later click pushed out another);
  - adds `proxy.calibrate(x, y, fromMs, toMs)`, which trains on every frame captured while the user
    looked at a target instead of the single latest frame, plus `proxy.click()`,
    `proxy.resetCalibration()` and an `autoClick: false` option;
  - frees calibration tensors it used to leak;
  - a `mediapipeUrl` option to load MediaPipe's wasm and face model from our own server.
- `../../web/model.json` + `group1-shard1of1.bin`: the BlazeGaze model from `js/examples/minimal-example/public/web/`.
  The tracker loads it from `web/` next to the page.

MediaPipe's face landmarker (wasm + model) is served from `../mediapipe/` (the patch adds a
`mediapipeUrl` option), so nothing is fetched from the internet at runtime.
