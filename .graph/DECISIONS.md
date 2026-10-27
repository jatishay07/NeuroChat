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
2026-10-27 | Integrator | Per-thread files .graph/threads/<id>.md replace thread rows in THREADS.md and sections in STATE.md; Integrator owns STATE/THREADS | the first three registrations (#28–#30) all conflicted on adjacent lines of the same two files | keep shared files and resolve conflicts on every merge
2026-10-27 | Builder (reading-signals) | Saccades found with a step filter (mean of next 130 ms minus previous 130 ms of AF8 − AF7), not a velocity threshold | on synthetic Muse EEG the velocity of alpha rhythm swamps a 5–10° step; the step filter averages rhythms out | velocity threshold (found 0 of 78 jumps at 4 µV/°)
2026-10-27 | Builder (study-mode) | Study mode slow = ≥ 1.5× the reader's median ms/100 words, only after 3 timed paragraphs; median of the last 200 paragraphs across sessions (localStorage) | matches the tutor's own 1.5× "slowed down" cue (companion/tutor.py); median shrugs off a few outliers; 3 paragraphs is the first session's smallest usable baseline | MAD/z-score (too few samples early on), fixed wpm threshold (not personal)
2026-10-27 | Builder (study-mode) | Only active time counts: paragraph on screen, tab visible, and some input in the last 60 s; < 8 words, < 1.5 s or > 3 min/100 words is not a reading | a coffee break or a skip must not move the baseline or look like a struggle | raw on-screen time
2026-10-27 | Builder (study-mode) | Scrolling moves between paragraphs only once the page can't scroll further that way | a long explanation under the paragraph still scrolls normally | scroll always pages (hides long answers)
2026-10-27 | Reviewer (study-mode, round 1) | Scroll/swipe pages once per gesture (ends after 250 ms without wheel events, 150 px pull); ↓/PageDown/Space scroll a tall page first; ←/→ always move | a trackpad flick skipped 3 paragraphs; keyboard users couldn't read the end of a tall paragraph | fixed 700 ms lock
2026-10-27 | Reviewer (study-mode, round 1) | Paragraph pace freezes at Explain; a new text starts a new baseline session | time reading the answer inflated the median; paragraph 1 of a new text replaced paragraph 1 of the last | keep timing through the answer
2026-10-27 | Reviewer (study-mode, round 1) | parseText: hard-wrapped PDF lines are joined, > 180-word paragraphs are cut at sentence ends (~120 words), Markdown headings label the paragraph below, lists keep their items | real pasted text is rarely clean blank-line paragraphs | split by line always
2026-10-27 | Reviewer (study-mode, round 2) | A wheel/swipe gesture turns the page only if it started at the edge; mouse-wheel notches add up for 1 s; one-line-per-paragraph vs hard-wrapped is decided by line endings; Han/kana count one word per character | round 2: scroll-and-turn in one motion, plain mouse wheel never turned, narrow PDF columns lost words, Chinese never timed | per-event edge check, length-based line test
