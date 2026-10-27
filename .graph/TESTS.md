# TESTS

Owner: Tester.

## How to run

- Unit + API + end-to-end with a stand-in tutor: `pip install -e ".[dev]" && pytest -q`
  (CI: `.github/workflows/tests.yml`).
- Real Qwen + Docker image smoke test: `.github/workflows/docker.yml` (on PRs; publishes on main).
- End-to-end engagement check: `python -m companion.e2e`.
- Browser: Playwright (preinstalled Chromium), fake camera via a face y4m; no pytest wrapper yet.

## Covered

| area | tests |
|---|---|
| HTTP + WebSocket API | tests/test_api.py |
| Device manager, signal quality | tests/test_device_manager.py, test_quality.py |
| Web Bluetooth headset decode | tests/test_browser_headset.py (fixture athena_p1041.txt) |
| Engagement kernel, real data, e2e | tests/test_engagement.py, test_realdata.py, test_e2e.py |
| Gaze visits | tests/test_gaze.py |
| Tutor prompts, Open WebUI | tests/test_tutor.py, test_webui.py |

## Not covered

- Portal and extension JavaScript (no automated JS or Playwright tests in CI).
- Real Muse S Athena hardware (never run on one).
- Webcam gaze accuracy (needs a person).
- Study mode (not built).

## Last run

2026-10-27, main `8c81218`, graph thread: `52 passed, 1 skipped in 71.31s`.
