"""The end-to-end engagement check (companion/e2e.py): real server, sockets and timing, about a minute."""
from companion.e2e import run


def test_engagement_reaches_the_model_end_to_end():
    rows = run(None, "qwen3.5:4b", log=lambda *a: None)
    assert [r["expected"] for r in rows] == ["LOW", "HIGH", "MODERATE", None]
    assert all("Never mention the EEG" in r["prompt"] for r in rows)
