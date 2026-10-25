"""Per-sensor signal quality from the last couple of seconds of EEG.

The Athena gives no impedance reading, so quality is judged from the signal itself,
after a 1–30 Hz bandpass removes the DC offset and slow drift: a sensor that is
flat has lost contact, and one swinging more than ~100 µV is picking up movement,
blinks or a loose fit.
"""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfiltfilt

FLAT_STD_UV = 1.0       # below this the sensor is not touching skin
NOISY_PTP_UV = 100.0    # above this the signal is mostly artifact
MIN_SECONDS = 1.0


def channel_quality(window: np.ndarray, srate: float) -> list[str]:
    """Label each channel (row) of a channels × samples window in µV.

    Returns "good", "flat" or "noisy" per channel, or "unknown" until there is
    at least a second of data.
    """
    n_ch = window.shape[0]
    if window.shape[1] < MIN_SECONDS * srate:
        return ["unknown"] * n_ch
    sos = butter(4, [1.0, 30.0], btype="bandpass", fs=srate, output="sos")
    filtered = sosfiltfilt(sos, window, axis=1)
    labels = []
    for raw, ch in zip(window, filtered):
        if raw.std() < FLAT_STD_UV:
            labels.append("flat")
        elif np.ptp(ch) > NOISY_PTP_UV:
            labels.append("noisy")
        else:
            labels.append("good")
    return labels
