from google.adk.models.lite_llm import LiteLlm

from ingest.config import get_model, get_settings


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
    assert s.opencode_base_url == "https://api.example/v1"
    assert s.opencode_model == "deep-v4-flash"
    assert s.supabase_url == "https://db.example"
    assert s.supabase_service_key == "svc"
    assert s.sink == "supabase"


def test_default_model_is_endpoint_supported(monkeypatch):
    # Ohne gesetztes OPENCODE_GO_MODEL muss der Default ein Modell sein, das der
    # OpenCode-Go-Endpoint akzeptiert. "deep-v4-flash" wird abgelehnt
    # ("Model ... is not supported") — korrekt ist "deepseek-v4-flash".
    monkeypatch.delenv("OPENCODE_GO_MODEL", raising=False)
    get_settings.cache_clear()
    assert get_settings().opencode_model == "deepseek-v4-flash"


def test_get_model_returns_lite_llm(monkeypatch):
    monkeypatch.setenv("OPENCODE_GO_KEY", "test-key")
    monkeypatch.setenv("OPENCODE_GO_BASE_URL", "https://api.example/v1")
    monkeypatch.setenv("OPENCODE_GO_MODEL", "deep-v4-flash")
    monkeypatch.setenv("SUPABASE_URL", "https://db.example")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "svc")
    monkeypatch.setenv("INGEST_SINK", "supabase")
    get_settings.cache_clear()
    m = get_model()
    assert isinstance(m, LiteLlm)
    assert m.model == "openai/deep-v4-flash"
