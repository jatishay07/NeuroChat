"""Run the companion app: python -m companion [--simulate] [--port 8765]."""
from __future__ import annotations

import argparse

import uvicorn

from .app import create_app
from .device import MuseBackend, SimulatedBackend


def main() -> None:
    parser = argparse.ArgumentParser(description="NeuroChat companion app")
    parser.add_argument("--simulate", action="store_true", help="use a fake headset instead of a real Muse S Athena")
    parser.add_argument("--bad-channel", choices=["TP9", "AF7", "AF8", "TP10"], help="with --simulate, make one sensor flat")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    backend = SimulatedBackend(bad_channel=args.bad_channel) if args.simulate else MuseBackend()
    print(f"Portal: http://127.0.0.1:{args.port}")
    uvicorn.run(create_app(backend), host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
