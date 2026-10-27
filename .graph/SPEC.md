# SPEC: NeuroAI

Owner: Planner. Everyone reads it. Seeded 2026-10-27 from the Reading Signals Plan
(https://claude.ai/artifact/RRwsKs5xeyG9XMzYHtcKTu, incl. "Revised after the debate") and project memory.

## What we are building

A reading tutor that notices which paragraph you are struggling with and explains it again with a
local model (Qwen 3.5 4B on Ollama), running entirely on your own computer. It serves two users:
Atishay's own reading tutor, and the Longhorn Neurotech NeuroAI team (keep the eye and jaw detectors
reusable for their EEG-controlled rover).

The 2026-10-27 rethink reordered the work: **the no-hardware study mode ships first**. The Muse S
Athena headset is an optional add-on, and only if Phase 1 shows its forehead sensors can see the
eye movements we need.

## Milestone 1: study mode (no hardware)

| # | Acceptance criterion | Evidence needed |
|---|---|---|
| S1 | The reader shows **one paragraph at a time** of a pasted text or test passage; scrolling or next/back moves between paragraphs. | Playwright check |
| S2 | The page measures **time per paragraph normalised by length** (ms per 100 words) from when a paragraph is on screen. | unit test of the timing function |
| S3 | A **personal baseline** (median ms/100 words over the reader's own paragraphs) is kept across sessions in the browser; the first session uses the paragraphs read so far. | unit test + Playwright reload |
| S4 | A paragraph read much slower than the baseline is marked as **slow** (threshold in DECISIONS.md, tunable) with a quiet cue, never a popup. | unit test |
| S5 | An **Explain** button on every paragraph sends it to the tutor over `/ws/chat` (`explain` with `dwellMsPer100Words` and `medianMsPer100Words`) and streams the answer in place. | Playwright with the stand-in tutor |
| S6 | Works with **no headset and no webcam**; webcam gaze is an optional extra, off by default. | Playwright with no camera |
| S7 | Uses the glass UI pieces (`.card`, `button.primary`, `button.quiet`, `:root` vars), light only; every button earns its place. | screenshot in the PR |
| S8 | Reachable from the portal home and with `neurochat` / Docker; full suite green in CI (Tests + Docker). | CI links |

## Milestone 2: Reading Signals Phase 1 (decides the headset)

| # | Acceptance criterion | Evidence needed |
|---|---|---|
| P1 | Blink, horizontal-saccade (with size) and jaw-clench detectors on AF7/AF8 and TP9/TP10. | tests on synthetic + fixture data |
| P2 | Scored on the Afonso & Heinrichs 2025 Muse S dataset (Zenodo 14860668, `csv_raw.zip`, CC BY 4.0). | report in `/mnt/project-files/neurochat/` |
| P3 | **First number:** can AF7/AF8 detect 5–10° jumps back to the start of a sentence? | report with hit rate / false alarms |
| P4 | Go/stop written in DECISIONS.md: **go** = headset underlines the suspect line (needs a slow line vs word length/frequency prediction AND a reread-sized backward jump; bars < 10% false underlines per easy paragraph, < 2% interrupting); **stop** = headset only gives blinks + jaw-clench Explain. | DECISIONS entry, Atishay told |

Phase 2 (his own 20-minute Athena recording, next week) needs a recording mode built before then.

## Running alongside

UI polish, the Chrome side-chat extension, eye tracking accuracy, the engagement kernel and the
all-in-one Docker image continue in their threads. They must not break study mode or the suite.

## Non-goals (for now)

- A desktop app for non-technical users (later; Docker is the distribution today).
- Mid-line regressions, sweep counts and key-tap labels (dropped in the debate).
- EEG engagement as a per-paragraph signal (only a minute-scale session trend).
- Gaze in the Chrome extension (paused; WIP patch in project files).
- Claims about learning gains (the paper's own H3 result was null).
