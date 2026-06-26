import pytest
from ingest.connectors.fetch import fetch_text, html_to_text


def test_html_to_text_strips_markup_and_scripts():
    html = (
        "<html><head><title>X</title></head><body>"
        "<script>var a=1;</script><style>.c{}</style>"
        "<h1>Event A</h1><p>am 1. Juli in Würzburg</p></body></html>"
    )
    text = html_to_text(html)
    assert "Event A" in text
    assert "am 1. Juli in Würzburg" in text
    assert "var a" not in text
    assert "<h1>" not in text
    assert ".c{}" not in text


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
