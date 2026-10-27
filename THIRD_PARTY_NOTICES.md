# Third-party notices

NeuroChat's own code is under the MIT License (see `LICENSE`). It includes, or its Docker image
bundles, the following work by others under their own licenses.

## Included in this repository

| What | Where | License |
|---|---|---|
| [WebEyeTrack](https://github.com/RedForestAI/WebEyeTrack) (Davalos et al.), patched build, and its BlazeGaze model | `portal/vendor/webeyetrack/`, `portal/web/` | MIT, see `portal/vendor/webeyetrack/LICENSE`; its bundled dependencies in `THIRD_PARTY_LICENSES.txt` there |
| [MediaPipe](https://github.com/google-ai-edge/mediapipe) Tasks Vision wasm 0.10.18 and the face landmarker model | `portal/vendor/mediapipe/` | Apache License 2.0, Copyright Google LLC, see `portal/vendor/mediapipe/LICENSE` |
| [OpenMuse](https://github.com/DominiqueMakowski/OpenMuse) message parser | `companion/device/athena_decode.py` | MIT (below) |
| OpenMuse public test recording (`tests/test_data/data_p1041.txt`, first lines) | `tests/fixtures/athena_p1041.txt` | MIT (below) |

### OpenMuse

OpenMuse declares the MIT License in its package metadata (PyPI classifier
`License :: OSI Approved :: MIT License`, author "OpenMuse Contributors").

```
MIT License

Copyright (c) OpenMuse Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Bundled in the Docker image (not in this repository)

`ghcr.io/jatishay07/neurochat` is built `FROM ghcr.io/open-webui/open-webui:ollama`, so it also ships:

- **[Open WebUI](https://github.com/open-webui/open-webui)** under the Open WebUI License, a BSD-3-Clause
  license with a branding clause: deployments with more than 50 users in 30 days must not remove or
  change the "Open WebUI" name or logo. NeuroChat does not rebrand Open WebUI; keep it that way.
- **[Ollama](https://github.com/ollama/ollama)**, MIT License.
- **The Qwen3.5 model weights** (`qwen3.5:4b` by default), under the license on Qwen's model card.

`start.sh` / `start.ps1` download Ollama, the model and Open WebUI from their own sources at run time
rather than redistributing them.

## Data that is downloaded, never committed

| Dataset | Used by | Why it isn't in the repo |
|---|---|---|
| Bird et al. 2018, "mental state" Muse recordings ([jordan-bird/eeg-feature-generation](https://github.com/jordan-bird/eeg-feature-generation)) | `python -m companion.realdata` | The source repository has no license, so it can't be redistributed; it's fetched into `data/` (git-ignored). |
| Afonso & Heinrichs 2025, Muse S eye-movement EEG (Zenodo 14860668) | Phase 1 of the reading-signals research | CC BY 4.0 and large; download it from Zenodo and cite the authors. |

Recordings of people (EEG, gaze) are biometric data. Never commit them; `data/`, `*.xdf`, `*.edf`
and `*.bdf` are git-ignored and the public-safety check rejects them.
