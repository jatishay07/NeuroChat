# RESEARCH

Owner: Researcher. Every source logged.

## Brain (jatishay07/brain) — searched 2026-10-27

- `rg -i "neurochat|2503.07599"` over the vault: **no NeuroChat notes, no captured sessions** about it.
- Found: `wiki/longhorn-neurotech-application.md` — Atishay was accepted 2026-09-24 onto the Longhorn
  Neurotech **NeuroAI software subteam** (a self-driving rover with EEG control). This is why the
  eye/jaw detectors must stay reusable.
- Action: project page `wiki/neuroai-neurochat.md` written back to the vault (brain PR, 2026-10-27).

## Primary sources

- NeuroChat paper, arXiv 2503.07599 (engagement β/(α+θ), §3.2; H3 learning result null; no buckets §6.2).
- Reading Signals Plan (incl. "Revised after the debate"): https://claude.ai/artifact/RRwsKs5xeyG9XMzYHtcKTu
- Struggle-Aware Tutor Build Plan: https://claude.ai/artifact/B7heEKCnARoA9t1QNRfA4D
- Afonso & Heinrichs 2025, arXiv 2503.14322, Muse S eye-tracking EEG, 113 people; data Zenodo 14860668;
  code github.com/FlorianHeinrichs/eeg_eye_tracking. HEROIC dataset Zenodo 11493897.
- Bird et al. 2018 Muse set (github.com/jordan-bird/eeg-feature-generation, no license: download only).
  Result: concentrating > neutral for 3/4 people; bands read too low. Report:
  `/mnt/project-files/neurochat/real-eeg-test.md`.
- WebEyeTrack (MIT): github.com/RedForestAI/WebEyeTrack, patched at upstream 75fbd2f.
- OpenMuse (Athena decoder, vendored as companion/device/athena_decode.py).

## Sandbox facts (cloud sessions)

Blocked: ollama.com / registry.ollama.ai, ghcr.io blobs, Zenodo, Kaggle, PhysioNet, arxiv HTML,
Hugging Face, jsdelivr. Working: GitHub (incl. raw), PyPI. So: real-Qwen and Docker runs happen in
GitHub Actions (`.github/workflows/docker.yml`); browser tests use Playwright with a fake camera.
Never `pkill -f` a pattern that appears in your own command.

## Open research questions

- Q1 (T5): are 5–10° saccades visible on AF7/AF8 at Muse S noise levels? Answered by Phase 1.
- Q2 (T2): slow-paragraph threshold vs personal median (1.5×? MAD-based?). Decide in Builder with a
  DECISIONS entry.
