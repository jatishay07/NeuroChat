"""Run the companion app: python -m companion [--simulate [--engagement
LEVEL|demo]] [--port 8765] [--host 127.0.0.1].
"""

from __future__ import annotations

import argparse
import logging
import os

import uvicorn

from .app import create_app
from .device import MuseBackend
from .device import SimulatedBackend


def demo_levels(t):
    """Synthetic engagement for --engagement demo: 60 s each of low, moderate
    and high, repeating.
    """
    import numpy as np

    return np.choose((np.asarray(t) // 60).astype(int) % 3, [0.05, 0.5, 0.95])


def main() -> None:
    parser = argparse.ArgumentParser(description="NeuroChat companion app")
    parser.add_argument(
        "--simulate",
        action="store_true",
        help="use a fake headset instead of a real Muse S Athena",
    )
    parser.add_argument(
        "--bad-channel",
        choices=["TP9", "AF7", "AF8", "TP10"],
        help="with --simulate, make one sensor flat",
    )
    parser.add_argument(
        "--engagement",
        metavar="LEVEL|demo",
        help="with --simulate, stream synthetic EEG at this engagement level (0-1), or 'demo' to "
        "cycle low, moderate and high every 60 s, so the tutor's prompt reacts to it",
    )
    parser.add_argument("--port", type=int, default=8765)
    # Only this computer can reach the portal by default. Docker sets 0.0.0.0 so
    # the published port works.
    parser.add_argument(
        "--host", default=os.environ.get("NEUROCHAT_HOST", "127.0.0.1")
    )
    args = parser.parse_args()
    level = None
    if args.engagement == "demo":
        level = demo_levels
    elif args.engagement is not None:
        level = min(max(float(args.engagement), 0.0), 1.0)
    backend = (
        SimulatedBackend(bad_channel=args.bad_channel, engagement=level)
        if args.simulate
        else MuseBackend()
    )
    print(f"Portal: http://127.0.0.1:{args.port}")
    print(
        f"Study mode (no headset needed): http://127.0.0.1:{args.port}/study.html"
    )
    # Short graceful shutdown: the portal keeps a WebSocket open, which would
    # otherwise make Ctrl+C hang. Closing that socket on the way out is
    # expected, so don't log it as an error.
    logging.getLogger("uvicorn.error").addFilter(
        lambda r: "timeout graceful shutdown exceeded" not in r.getMessage()
    )
    uvicorn.run(
        create_app(backend),
        host=args.host,
        port=args.port,
        log_level="warning",
        timeout_graceful_shutdown=1,
    )


if __name__ == "__main__":
    main()
