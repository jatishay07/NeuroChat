import pytest

import companion.app


@pytest.fixture(autouse=True)
def allow_test_client_host(monkeypatch):
    """FastAPI's TestClient calls itself "testserver"; let it through the localhost-only guard."""
    monkeypatch.setattr(companion.app, "ALLOWED_HOSTS", companion.app.ALLOWED_HOSTS | {"testserver"})
