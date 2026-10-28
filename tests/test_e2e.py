"""The end-to-end engagement check (companion/e2e.py): real server, sockets and
timing, about a minute.
"""

from companion.e2e import run


def test_engagement_reaches_the_model_end_to_end():
    rows = run(None, "qwen3.5:4b", log=lambda *a: None)
    assert [r["expected"] for r in rows] == ["LOW", "HIGH", None, None]
    assert rows[0]["score"] < rows[2]["score"] < rows[1]["score"]
    assert all("Never mention or hint at them" in r["prompt"] for r in rows)
