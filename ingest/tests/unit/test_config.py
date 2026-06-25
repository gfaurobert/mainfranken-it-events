import os
from ingest.config import get_settings

def test_settings_read_from_env(monkeypatch):
    monkeypatch.setenv("OPENCODE_GO_KEY", "k")
    monkeypatch.setenv("OPENCODE_GO_BASE_URL", "https://api.example/v1")
    monkeypatch.setenv("OPENCODE_GO_MODEL", "deep-v4-flash")
    monkeypatch.setenv("SUPABASE_URL", "https://db.example")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "svc")
    monkeypatch.setenv("INGEST_SINK", "supabase")
    get_settings.cache_clear()
    s = get_settings()
    assert s.opencode_key == "k"
    assert s.opencode_model == "deep-v4-flash"
    assert s.sink == "supabase"
