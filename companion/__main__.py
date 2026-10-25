"""Run the companion app: python -m companion [--simulate] [--port 8765] [--host 127.0.0.1]."""
from __future__ import annotations

import argparse
import logging
import os

import uvicorn

from .app import create_app
from .device import MuseBackend, SimulatedBackend


def main() -> None:
    parser = argparse.ArgumentParser(description="NeuroChat companion app")
    parser.add_argument("--simulate", action="store_true", help="use a fake headset instead of a real Muse S Athena")
    parser.add_argument("--bad-channel", choices=["TP9", "AF7", "AF8", "TP10"], help="with --simulate, make one sensor flat")
    parser.add_argument("--port", type=int, default=8765)
    # Only this computer can reach the portal by default. Docker sets 0.0.0.0 so the published port works.
    parser.add_argument("--host", default=os.environ.get("NEUROCHAT_HOST", "127.0.0.1"))
    args = parser.parse_args()
    backend = SimulatedBackend(bad_channel=args.bad_channel) if args.simulate else MuseBackend()
    print(f"Portal: http://127.0.0.1:{args.port}")
    # Short graceful shutdown: the portal keeps a WebSocket open, which would otherwise make Ctrl+C
    # hang. Closing that socket on the way out is expected, so don't log it as an error.
    logging.getLogger("uvicorn.error").addFilter(
        lambda r: "timeout graceful shutdown exceeded" not in r.getMessage())
    uvicorn.run(create_app(backend), host=args.host, port=args.port, log_level="warning", timeout_graceful_shutdown=1)


if __name__ == "__main__":
    main()
