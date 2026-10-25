import asyncio

import numpy as np
import pytest

from companion.device import BackendError, DeviceManager, SimulatedBackend
from companion.device import manager as manager_mod


def run(coro):
    return asyncio.run(coro)


async def wait_for(pred, timeout=4.0):
    end = asyncio.get_running_loop().time() + timeout
    while not pred():
        if asyncio.get_running_loop().time() > end:
            raise AssertionError("condition not met in time")
        await asyncio.sleep(0.05)


def test_scan_connect_stream_and_disconnect():
    async def go():
        m = DeviceManager(SimulatedBackend())
        devices = await m.scan(timeout=0.1)
        assert [d.address for d in devices] == ["SIM-0001"]
        await m.connect("SIM-0001")
        await wait_for(lambda: m.state == "streaming")
        await wait_for(lambda: "unknown" not in m.quality)
        assert m.quality == ["good"] * 4
        assert m.measured_srate == pytest.approx(256, rel=0.15)
        assert m.window(1.0).shape == (4, 256)
        await m.disconnect()
        assert m.state == "idle" and m.device is None
    run(go())


def test_flat_sensor_is_reported():
    async def go():
        m = DeviceManager(SimulatedBackend(bad_channel="AF8"))
        await m.scan(timeout=0.1)
        await m.connect("SIM-0001")
        await wait_for(lambda: "unknown" not in m.quality)
        assert m.quality == ["good", "good", "flat", "good"]
        await m.disconnect()
    run(go())


def test_connect_to_unknown_address_sets_error():
    async def go():
        m = DeviceManager(SimulatedBackend())
        with pytest.raises(BackendError):
            await m.connect("NOPE")
        assert m.state == "error" and "NOPE" in m.error
    run(go())


class DyingBackend(SimulatedBackend):
    """Streams briefly, then goes silent, like a headset walking out of range."""
    def read(self):
        data = super().read()
        if self._sent > 64:
            return np.empty((4, 0))
        return data


def test_lost_signal_is_detected(monkeypatch):
    monkeypatch.setattr(manager_mod, "STALL_SECONDS", 0.5)
    async def go():
        m = DeviceManager(DyingBackend())
        await m.scan(timeout=0.1)
        await m.connect("SIM-0001")
        await wait_for(lambda: m.state == "error")
        assert "Lost the headset signal" in m.error
    run(go())


def test_subscribers_get_status_updates():
    async def go():
        m = DeviceManager(SimulatedBackend())
        q = m.subscribe()
        assert (await q.get())["state"] == "idle"
        await m.scan(timeout=0.1)
        states = []
        while not q.empty():
            states.append((await q.get())["state"])
        assert states[:2] == ["scanning", "idle"]
    run(go())
