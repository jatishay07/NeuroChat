"""Checks that nothing private is about to be published from this (public) repository.

    python scripts/public_safety.py

Looks at every file git tracks and fails on:
- recordings of people (EEG, gaze) and anything under data/: biometric data never goes in git;
- key files, .env files and Open WebUI's secret key;
- files over 10 MB (datasets and models are downloaded, not committed);
- personal home-folder paths (/Users/<name>/, /home/<name>/, C:\\Users\\<name>\\) and email addresses
  other than placeholders and GitHub/Anthropic noreply ones.

PUBLIC_SAFETY_DENYLIST (comma-separated, e.g. from a repository secret) adds words that must never
appear, such as a real name or a computer's user name, without writing them into the repo itself.
Secrets themselves (API keys, tokens) are gitleaks' job, in the same workflow.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

MAX_BYTES = 10 * 1024 * 1024
# Third-party files, checked by license review instead (their build paths are not ours).
THIRD_PARTY = ("portal/vendor/", "portal/web/")
# This checker and its test spell out the patterns they look for.
SELF = ("scripts/public_safety.py", "tests/test_public_safety.py")

FORBIDDEN_NAMES = re.compile(
    r"(^|/)(data/|\.env($|\.)|\.webui_secret_key$|id_(rsa|ed25519|ecdsa)|[^/]*\.(xdf|edf|bdf|pem|key|p12|pfx)$)",
    re.IGNORECASE)
HOME_PATH = re.compile(
    r"/Users/(?!Shared/|you/|me/|<)[A-Za-z0-9._-]+/|/home/(?!runner/|user/|you/|me/|<)[A-Za-z0-9._-]+/"
    r"|[A-Za-z]:\\+Users\\+(?!Public\\|you\\|<)[A-Za-z0-9._ -]+\\")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
OK_EMAIL = re.compile(r"(noreply|no-reply)@|@users\.noreply\.github\.com$|@example\.(com|org|net)$|^git@github\.com$",
                      re.IGNORECASE)


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], capture_output=True, check=True).stdout
    return [p for p in out.decode().split("\0") if p]


def check(paths: list[str], denylist: list[str]) -> list[str]:
    problems = []
    deny = [re.compile(rf"\b{re.escape(w)}\b", re.IGNORECASE) for w in denylist]
    for path in paths:
        f = Path(path)
        if not f.is_file():
            continue
        if FORBIDDEN_NAMES.search(path):
            problems.append(f"{path}: private or biometric file type; keep it out of git")
        if f.stat().st_size > MAX_BYTES:
            problems.append(f"{path}: over 10 MB; download large data and models instead of committing them")
        raw = f.read_bytes()
        if b"\0" in raw[:8192]:
            continue  # binary
        text = raw.decode("utf-8", errors="replace")
        for n, line in enumerate(text.splitlines(), 1):
            for d in deny:
                if d.search(line):
                    problems.append(f"{path}:{n}: contains a denylisted word")
            if path.startswith(THIRD_PARTY) or path in SELF:
                continue
            if m := HOME_PATH.search(line):
                problems.append(f"{path}:{n}: personal path {m.group(0)!r}; use ~ or a placeholder")
            for m in EMAIL.finditer(line):
                if not OK_EMAIL.search(m.group(0)):
                    problems.append(f"{path}:{n}: email address {m.group(0)!r}")
    return problems


def main() -> int:
    denylist = [w.strip() for w in os.environ.get("PUBLIC_SAFETY_DENYLIST", "").split(",") if w.strip()]
    problems = check(tracked_files(), denylist)
    for p in problems:
        print(p)
    print(f"{len(problems)} problem(s)" if problems else "Public-safety check passed.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
