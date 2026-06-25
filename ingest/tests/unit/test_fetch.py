import pytest
from ingest.connectors.fetch import fetch_text


@pytest.mark.asyncio
async def test_fetch_text(monkeypatch):
    class FakeResp:
        text = "<html>ok</html>"
        def raise_for_status(self): pass
    class FakeClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        async def get(self, url, headers=None): return FakeResp()
    import ingest.connectors.fetch as f
    monkeypatch.setattr(f.httpx, "AsyncClient", FakeClient)
    out = await fetch_text("https://x")
    assert out == "<html>ok</html>"
