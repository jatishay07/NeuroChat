# WebEyeTrack (vendored)

[WebEyeTrack](https://github.com/RedForestAI/WebEyeTrack) by Davalos et al., MIT licence (see LICENSE;
bundled dependencies' licences in THIRD_PARTY_LICENSES.txt). Paper: https://arxiv.org/abs/2508.19544

- `webeyetrack.js`: built from commit 75fbd2f with `npm ci && npm run build` in `js/`,
  with one change: `src/FaceLandmarkerClient.ts` loads the MediaPipe wasm for tasks-vision 0.10.18
  (the version bundled) instead of 0.10.3.
- `../../web/model.json` + `group1-shard1of1.bin`: the BlazeGaze model from `js/examples/minimal-example/public/web/`.
  The tracker loads it from `web/` next to the page.

At runtime it also downloads MediaPipe's face landmarker (wasm from jsdelivr, model from
storage.googleapis.com) on first use; the browser caches them.
