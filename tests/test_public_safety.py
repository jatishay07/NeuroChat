import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "public_safety",
    Path(__file__).parent.parent / "scripts" / "public_safety.py",
)
public_safety = importlib.util.module_from_spec(spec)
spec.loader.exec_module(public_safety)


def test_flags_private_files_paths_emails_and_denylisted_words(
    tmp_path, monkeypatch
):
    monkeypatch.chdir(tmp_path)
    files = {
        "notes.md": "clone into /Users/alice/Work/NeuroChat\nmail me at alice@gmail.com\nmy mac is called Wombat\n",
        "ok.md": "run from ~/NeuroChat; noreply@anthropic.com; 1+me@users.noreply.github.com; /Users/you/x/\n",
        "data/session.csv": "TP9,AF7\n",
        "rec.xdf": "x",
        ".env": "KEY=1",
        "portal/vendor/lib.js": "built in /home/someone/build/",
    }
    for name, text in files.items():
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / name).write_text(text)
    problems = "\n".join(public_safety.check(list(files), ["wombat"]))
    assert "notes.md:1: personal path '/Users/alice/'" in problems
    assert (
        "alice@gmail.com" in problems
        and "notes.md:3: contains a denylisted word" in problems
    )
    assert (
        "data/session.csv" in problems
        and "rec.xdf" in problems
        and ".env" in problems
    )
    assert "ok.md" not in problems and "portal/vendor" not in problems
