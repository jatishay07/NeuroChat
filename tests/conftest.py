import pytest

import neurochat.app


@pytest.fixture(autouse=True)
def allow_test_client_host(monkeypatch):
    """FastAPI's TestClient calls itself "testserver"; let it through the
    localhost-only guard.
    """
    monkeypatch.setattr(
        neurochat.app,
        "ALLOWED_HOSTS",
        neurochat.app.ALLOWED_HOSTS | {"testserver"},
    )
