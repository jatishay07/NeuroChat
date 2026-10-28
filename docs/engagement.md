# Engagement score → tutor prompt

How the headset's EEG becomes a 0–1 engagement score, and how that score changes
what the tutor is told. This needs a Muse S Athena (or the simulator); study mode
doesn't use it.

`companion/engagement.py` is the NeuroChat kernel, computed the way the paper does (§3.2): 1–30 Hz
band-pass and 60 Hz notch, 1 s epochs every 250 ms, engagement = β / (α + θ) with θ 4–7, α 7–11 and
β 11–20 Hz, band powers averaged over a 15 s window that moves every second. Epochs with blinks or a
sensor off the skin are dropped. A calibration (2 min relaxing, 2 min word chain) gives E_min and
E_max, and the score is normalized to 0–1 against them. Without a calibration the score is relative
to the reading's own range.

The score falls in one of three bands, and each band adds its own instructions to Qwen's system prompt:

| Band     | Score      | What the tutor is told                                                                                 |
| -------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| Low      | under 0.3  | Under 80 words, a small story or familiar example, one idea, end with a question that sparks curiosity |
| Moderate | 0.3 to 0.6 | Normal depth up to 120 words, main idea first, define jargon, check what's unclear                     |
| High     | 0.6 and up | More technical, explain the mechanism, up to 180 words, connect to a related idea                      |

When you ask about a paragraph, the score is the one from while your eyes were on it; for an added
passage it's that passage's own; for a follow-up question it's the last 15 seconds, as in the paper.
The model is told never to mention or hint at the EEG, and the end-to-end check fails if a reply does. The plain simulated headset's EEG is noise and never
reaches the prompt.

```bash
python -m companion.engagement synth --out synthetic-eeg        # relax.csv, task.csv, reading.csv, labels.json
python -m companion.engagement score synthetic-eeg/reading.csv \
    --relax synthetic-eeg/relax.csv --task synthetic-eeg/task.csv  # per-second score and band
python -m companion --simulate --engagement demo                 # live: low, moderate, high every 60 s
python -m companion.e2e                                          # end-to-end check, about a minute
python -m companion.e2e --ollama http://127.0.0.1:11434          # same, with the real model answering
```

`python -m companion.realdata --out data/bird` downloads public Muse recordings (Bird et al. 2018: four
people, relaxed / neutral / concentrating) and scores them. Concentrating reads above neutral for three
of the four, and above it on held-out sessions; set `NEUROCHAT_BIRD_DATA=data/bird` to include that
check in `pytest`.

`score` reads a real recording too: Mind Monitor or muselsl CSVs (TP9, AF7, AF8, TP10 columns), NPZ,
or XDF (with `pip install pyxdf`). Live calibration is `POST /api/engagement/calibration/relax/start`,
then `/relax/finish`, the same for `task`; `PUT /api/engagement/calibration` sets E_min and E_max from
an offline one, and `GET /api/engagement` shows the score now.
