"""Run the engagement kernel on real, public Muse recordings.

    python -m companion.realdata --out data/bird    # downloads about 18 MB, then prints the report

The recordings are the "mental state" set from Bird et al., "A Study on Mental
State Classification using EEG-based Brain-Machine Interface" (IEEE IS 2018),
published with github.com/jordan-bird/eeg-feature-generation: four people on a
Muse (TP9, AF7, AF8, TP10, 256 Hz, muselsl CSV), about a minute each of relaxed
(calm music), neutral (no task) and concentrating (following a shell game), in
two sessions. The repository has no license file, so the files are downloaded
into data/ (ignored by git) rather than committed.

The report calibrates each person on session 1 the paper's way (E_min from the
calm recording, E_max from concentrating) and scores their session 2 recordings,
which the calibration never saw.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import urllib.request

import numpy as np

from .engagement import Calibration
from .engagement import calibration_bound
from .engagement import CalibrationError
from .engagement import engagement_index
from .engagement import score_recording
from .recording import load_recording

SOURCE = "https://raw.githubusercontent.com/jordan-bird/eeg-feature-generation/master/dataset/original_data"
SUBJECTS = "abcd"
STATES = ("relaxed", "neutral", "concentrating")


def fetch(out: Path) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    files = []
    for s in SUBJECTS:
        for state in STATES:
            for session in (1, 2):
                path = out / f"subject{s}-{state}-{session}.csv"
                if not path.exists():
                    urllib.request.urlretrieve(f"{SOURCE}/{path.name}", path)
                files.append(path)
    return files


def report(folder: Path, baseline: str = "neutral") -> dict:
    """Per person: the raw index of each recording, and session 2 scored against
    a session 1 calibration whose floor is `baseline` (neutral or relaxed) and
    ceiling is concentrating.
    """
    rows = {}
    for s in SUBJECTS:
        rec = {
            (state, n): load_recording(folder / f"subject{s}-{state}-{n}.csv")
            for state in STATES
            for n in (1, 2)
        }
        raw = {k: engagement_index(r.eeg, r.srate) for k, r in rec.items()}
        row = {
            "raw": {
                f"{st}-{n}": None if v is None else round(v, 3)
                for (st, n), v in raw.items()
            },
            "held_out": {},
        }
        try:
            cal = Calibration(
                calibration_bound(
                    rec[(baseline, 1)].eeg, rec[(baseline, 1)].srate, "relax"
                ),
                calibration_bound(
                    rec[("concentrating", 1)].eeg,
                    rec[("concentrating", 1)].srate,
                    "task",
                ),
            )
            row["calibration"] = {
                "e_min": round(cal.e_min, 3),
                "e_max": round(cal.e_max, 3),
            }
            for state in STATES:
                r = rec[(state, 2)]
                result = score_recording(r.eeg, r.srate, cal)
                scores = [
                    x["score"]
                    for x in result["seconds"]
                    if x["score"] is not None
                ]
                row["held_out"][state] = (
                    None
                    if not scores
                    else {
                        "mean": round(float(np.mean(scores)), 2),
                        "seconds": result["buckets"],
                    }
                )
        except CalibrationError as e:
            row["calibration"] = str(e)
        rows[s] = row
    return rows


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(
        prog="python -m companion.realdata", description=__doc__.split("\n")[0]
    )
    p.add_argument("--out", default="data/bird")
    p.add_argument(
        "--baseline", choices=["neutral", "relaxed"], default="neutral"
    )
    args = p.parse_args(argv)
    folder = Path(args.out)
    fetch(folder)
    for s, row in report(folder, args.baseline).items():
        print(
            f"\nSubject {s}: raw index "
            + ", ".join(f"{k} {v}" for k, v in row["raw"].items())
        )
        print(
            f"  calibration on session 1 ({args.baseline} → concentrating): {row['calibration']}"
        )
        for state, r in row["held_out"].items():
            print(
                f"  session 2 {state:13}: "
                + (
                    "too short to score"
                    if r is None
                    else f"mean score {r['mean']:.2f}, seconds per band {r['seconds']}"
                )
            )


if __name__ == "__main__":
    main()
