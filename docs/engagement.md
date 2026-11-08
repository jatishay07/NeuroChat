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

## Seeing the signals

The Chrome extension's **signals page** (the wave button in the side chat's header) shows what the
headset buffer holds: the alpha and beta waves of the last 4 s, the share of theta, alpha and beta
over the last minute, the engagement score with its band, and the system prompt the tutor was last
given, with the part that came from the measurements highlighted. It reads `GET
/api/engagement/signals` and `GET /api/engagement/prompt` once a second.

To see it on real EEG without a headset, play a recording back as if it were streaming:

```bash
python -m companion --replay bird                 # public Muse recordings (Bird et al.), downloaded once
python -m companion --replay my-calm.csv,my-focus.csv   # your own Mind Monitor / muselsl / NPZ / XDF files
```

`--replay bird` plays three of one person's minutes in a loop: one that scores low (neutral), one that
scores moderate (concentrating, second session; it wobbles into high), one that scores high
(concentrating, first session), calibrated the paper's way on the neutral and concentrating minutes.
The device name on the signals page says which is playing. `--replay bird:low`, `bird:moderate` or
`bird:high` stays on one band, to test what the tutor is told at that level. The set's "relaxed"
minutes (eyes closed, calm music) are not played: this index reads them as more engaged than
concentrating, which is one of the things the headset study has to settle. The files go in `data/bird`
(or `NEUROCHAT_BIRD_DATA`). The simulated headset's noise is drawn too, but the page says it never
reaches the tutor.

`python -m companion.realdata --out data/bird` downloads public Muse recordings (Bird et al. 2018: four
people, relaxed / neutral / concentrating) and scores them. Concentrating reads above neutral for three
of the four, and above it on held-out sessions; set `NEUROCHAT_BIRD_DATA=data/bird` to include that
check in `pytest`.

`score` reads a real recording too: Mind Monitor or muselsl CSVs (TP9, AF7, AF8, TP10 columns), NPZ,
or XDF (with `pip install pyxdf`). Live calibration is `POST /api/engagement/calibration/relax/start`,
then `/relax/finish`, the same for `task`; `PUT /api/engagement/calibration` sets E_min and E_max from
an offline one, and `GET /api/engagement` shows the score now.
