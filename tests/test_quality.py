import numpy as np

from companion.device.quality import channel_quality

SR = 256.0


def eeg(seconds=2.0, amp=5.0, seed=0):
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * SR)) / SR
    return 800 + 8 * np.sin(2 * np.pi * 10 * t) + rng.normal(0, amp, t.size)


def test_good_flat_and_noisy_channels():
    good = eeg()
    flat = np.full_like(good, 800.0)
    noisy = eeg()
    noisy[200:210] += 300  # a movement spike
    assert channel_quality(np.vstack([good, flat, noisy]), SR) == ["good", "flat", "noisy"]


def test_slow_drift_alone_is_not_noise():
    drift = eeg() + np.linspace(0, 400, int(2 * SR))
    assert channel_quality(drift[None, :], SR) == ["good"]


def test_unknown_until_a_second_of_data():
    assert channel_quality(eeg(0.5)[None, :], SR) == ["unknown"]
