# DECISIONS (append-only)

date | node | decision | why | alternatives rejected

2026-10-18 | Planner | Local LLM via Ollama | runs on the reader's machine, private | hosted API
2026-10-18 | Planner | Muse S Athena via OpenMuse/BrainFlow, not muselsl | Athena protocol differs from Muse 2 | muselsl
2026-10-25 | Planner | Default model qwen3.5:4b (3.3 GB); 2b-q4_K_M for weak machines, 9b optional | Atishay wants a small download | Gemma 4 E2B (4.3 GB min)
2026-10-25 | Builder | WebEyeTrack replaces WebGazer (vendored, MIT, patched) | WebGazer "did not work" for Atishay | WebGazer
2026-10-25 | Planner | Distribution = ONE all-in-one Docker image incl. the model (ghcr.io/jatishay07/neurochat); desktop app later | technical users first | separate Ollama/model step
2026-10-25 | Builder | Headset in Docker via Web Bluetooth → /ws/headset → vendored OpenMuse decoder | containers can't reach Bluetooth | native bleak only
2026-10-25 | Reviewer | Glass chat at /chat in front, Open WebUI optional ("Continue in Open WebUI") | Atishay disliked Open WebUI's look | restyling Open WebUI
2026-10-25 | Builder | Disable Open WebUI builtin tools + Qwen thinking for neurochat-tutor | ~40 tool schemas + thinking gave empty replies on 4B | bigger model
2026-10-26 | Planner | Side chat = Chrome MV3 extension, one conversation per page | read anywhere in Chrome | desktop floating window (later)
2026-10-27 | Builder | Engagement = paper's β/(α+θ), min/max calibration, bands low <0.3, moderate 0.3–0.6, high ≥0.6 | paper §3.2; edges below thirds because E_max is an extreme | fixed paper buckets (paper has none)
2026-10-27 | Planner | Rethink: study mode (no hardware) ships first; headset becomes an optional add-on decided by Phase 1 | EEG engagement weak on real Muse data; webcam gaze not usable yet; no ground truth | headset-first product
2026-10-27 | Planner | Headset role if it earns a place: quiet underline of the suspect line only; needs slow line AND reread-sized backward jump | debate thread converged; popups interrupt | mid-line regressions, sweep counts, key-tap labels
2026-10-27 | Planner | Phase 1 data: Atishay downloads csv_raw.zip from Zenodo 14860668 and uploads it | Zenodo blocked from the sandbox | GitHub Actions download
2026-10-27 | Planner | Adopt the graph engineering contract (CLAUDE.md, .graph/) for every thread; Integrator = graph thread | Atishay asked for looped build→test→iterate and inter-thread messaging | ad-hoc ownership via memory only
2026-10-27 | Integrator | .graph/ and CLAUDE.md carry no personal facts from the brain vault; refer to "the owner's notes" | repo is going public (public-repo thread) | copying vault facts into the repo
