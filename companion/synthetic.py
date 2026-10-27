"""Synthetic Muse EEG with a known engagement level, for building and testing without a headset.

Each channel is 1/f background plus band-limited θ, α and β activity. An engagement level from
0 (drowsy, relaxed) to 1 (absorbed) trades θ/α power for β power, which is what the engagement
index β / (α + θ) picks up. Blinks on the forehead sensors are mixed in so artifact rejection is
exercised too. Signals sit on the ~800 µV offset the Athena's raw stream has.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Sequence

import numpy as np
from scipy.signal import butter, sosfiltfilt

from .device.backends import EEG_CHANNELS, EEG_SRATE

OFFSET_UV = 800.0
BANDS = {"theta": (4.5, 6.5), "alpha": (8.0, 10.5), "beta": (12.0, 19.0)}


def _band_noise(rng: np.random.Generator, lo: float, hi: float, n: int, srate: float, channels: int) -> np.ndarray:
    """Unit-RMS noise limited to lo–hi Hz, a little different on each channel."""
    sos = butter(4, (lo, hi), btype="bandpass", fs=srate, output="sos")
    common = sosfiltfilt(sos, rng.normal(size=n))
    own = sosfiltfilt(sos, rng.normal(size=(channels, n)), axis=1)
    x = 0.3 * common + 0.7 * own
    return x / x.std(axis=1, keepdims=True)


def _pink(rng: np.random.Generator, n: int, channels: int) -> np.ndarray:
    spec = np.fft.rfft(rng.normal(size=(channels, n)), axis=1)
    f = np.arange(spec.shape[1])
    spec[:, 1:] /= np.sqrt(f[1:])
    spec[:, 0] = 0
    x = np.fft.irfft(spec, n, axis=1)
    return x / x.std(axis=1, keepdims=True)


def synthetic_eeg(level: float | Sequence[float] | Callable[[np.ndarray], np.ndarray], seconds: float,
                  srate: float = EEG_SRATE, channels: int = len(EEG_CHANNELS), seed: int = 0,
                  blinks_per_minute: float = 6.0) -> np.ndarray:
    """channels × samples of EEG in µV. level is a constant, one value per second, or a function of
    time in seconds; it is smoothed so changes ramp over about a second rather than jump."""
    rng = np.random.default_rng(seed)
    n = int(round(seconds * srate))
    t = np.arange(n) / srate
    if callable(level):
        lv = np.asarray(level(t), dtype=float)
    elif np.ndim(level) == 0:
        lv = np.full(n, float(level))
    else:
        per_second = np.asarray(level, dtype=float)
        lv = per_second[np.minimum((t).astype(int), len(per_second) - 1)]
    kernel = np.ones(int(srate)) / int(srate)
    lv = np.clip(np.convolve(np.pad(lv, (len(kernel) // 2, len(kernel) - 1 - len(kernel) // 2), mode="edge"), kernel, "valid"), 0, 1)
    # Slow rhythms shrink and fast ones grow as engagement rises (µV RMS), sized so that the
    # β / (α + θ) power ratio climbs about linearly from 0.25 at level 0 to 1.0 at level 1.
    a_theta, a_alpha = 6.0 - 1.5 * lv, 9.0 - 3.0 * lv
    a_beta = np.sqrt((0.25 + 0.75 * lv) * (a_theta ** 2 + a_alpha ** 2))
    theta = a_theta * _band_noise(rng, *BANDS["theta"], n, srate, channels)
    alpha = a_alpha * _band_noise(rng, *BANDS["alpha"], n, srate, channels)
    beta = a_beta * _band_noise(rng, *BANDS["beta"], n, srate, channels)
    x = theta + alpha + beta + 4.0 * _pink(rng, n, channels) + rng.normal(0, 1.0, (channels, n))
    # Blinks: a ~300 ms bump, large on AF7/AF8 (channels 1 and 2), faint behind the ears.
    width = int(0.3 * srate)
    bump = np.hanning(width)
    for start in rng.integers(0, max(n - width, 1), int(seconds / 60 * blinks_per_minute)):
        size = rng.uniform(250, 400)
        for ch, gain in enumerate((0.1, 1.0, 1.0, 0.1)[:channels]):
            x[ch, start:start + width] += gain * size * bump[: n - start]
    return OFFSET_UV + x


@dataclass
class SyntheticSession:
    srate: float
    recordings: dict[str, np.ndarray] = field(default_factory=dict)
    labels: dict = field(default_factory=dict)


# A reading of five paragraphs: one gripping, one where they drift, the rest steady.
READING_SCRIPT = [(0, 40, 0.5), (1, 40, 1.0), (2, 50, 0.1), (3, 40, 0.55), (4, 40, 0.45)]


def synthetic_session(seed: int = 1, srate: float = EEG_SRATE) -> SyntheticSession:
    """A full session like the paper's: 2 min relaxing, 2 min word chain, then a reading where the
    engagement changes per paragraph. labels says what each part was generated as."""
    s = SyntheticSession(srate)
    s.recordings["relax"] = synthetic_eeg(0.05, 120, srate, seed=seed)
    s.recordings["task"] = synthetic_eeg(0.95, 120, srate, seed=seed + 1)
    levels, paragraphs, t = [], [], 0
    for paragraph, seconds, level in READING_SCRIPT:
        levels += [level] * seconds
        paragraphs.append({"paragraph": paragraph, "start": t, "end": t + seconds, "level": level})
        t += seconds
    s.recordings["reading"] = synthetic_eeg(levels, t, srate, seed=seed + 2)
    s.labels = {"srate": srate, "relax_level": 0.05, "task_level": 0.95, "reading": paragraphs}
    return s


class SyntheticStream:
    """Plays synthetic EEG in real time, looping. level(t) sets engagement t seconds after start."""

    def __init__(self, level: Callable[[np.ndarray], np.ndarray] | float, seconds: float = 300.0,
                 srate: float = EEG_SRATE, seed: int = 0):
        self.srate = srate
        self.data = synthetic_eeg(level, seconds, srate, seed=seed, blinks_per_minute=0)
        self._pos = 0

    def take(self, n: int) -> np.ndarray:
        idx = (self._pos + np.arange(n)) % self.data.shape[1]
        self._pos += n
        return self.data[:, idx]
