"""Tests für den Headless-Connector (Playwright-Rendering) und die
headless-Verzweigung in collect_from_source – ohne echten Browser."""
import sys
import types

import pytest

import ingest.pipeline as pipe
from ingest.connectors.fetch import FetchError, fetch_rendered
from ingest.models import SourceConfig


# --- Fakes für die Playwright-async-API (kein echter Browser im Unit-Test) ---
class _FakePage:
    def __init__(self, store):
        self._store = store

    async def goto(self, url, **kwargs):
        self._store["goto"] = (url, kwargs)

    async def content(self):
        return "<html>rendered</html>"


class _FakeBrowser:
    def __init__(self, store):
        self._store = store

    async def new_page(self, **kwargs):
        self._store["new_page"] = kwargs
        return _FakePage(self._store)

    async def close(self):
        self._store["closed"] = True


class _FakeChromium:
    def __init__(self, store):
        self._store = store

    async def launch(self, **kwargs):
        self._store["launch"] = kwargs
        return _FakeBrowser(self._store)


class _FakePlaywright:
    def __init__(self, store):
        self._store = store
        self.chromium = _FakeChromium(store)


class _FakePlaywrightCM:
    def __init__(self, store):
        self._store = store

    async def __aenter__(self):
        return _FakePlaywright(self._store)

    async def __aexit__(self, *a):
        self._store["exited"] = True
        return False


def _install_fake_playwright(monkeypatch, store, *, launch_raises=None):
    mod = types.ModuleType("playwright.async_api")
    mod.Error = type("Error", (Exception,), {})

    def _factory():
        if launch_raises is not None:
            raise launch_raises
        return _FakePlaywrightCM(store)

    mod.async_playwright = _factory
    monkeypatch.setitem(sys.modules, "playwright", types.ModuleType("playwright"))
    monkeypatch.setitem(sys.modules, "playwright.async_api", mod)
    return mod


# --- fetch_rendered ---
@pytest.mark.asyncio
async def test_fetch_rendered_returns_page_content(monkeypatch):
    store = {}
    _install_fake_playwright(monkeypatch, store)
    out = await fetch_rendered("https://x")
    assert out == "<html>rendered</html>"
    assert store["goto"][0] == "https://x"


@pytest.mark.asyncio
async def test_fetch_rendered_closes_browser(monkeypatch):
    store = {}
    _install_fake_playwright(monkeypatch, store)
    await fetch_rendered("https://x")
    assert store.get("closed") is True


@pytest.mark.asyncio
async def test_fetch_rendered_sets_bot_user_agent(monkeypatch):
    store = {}
    _install_fake_playwright(monkeypatch, store)
    await fetch_rendered("https://x")
    assert "MainfrankenITEventsBot" in store["new_page"]["user_agent"]


@pytest.mark.asyncio
async def test_fetch_rendered_raises_fetcherror_when_playwright_missing(monkeypatch):
    # Import von playwright schlägt fehl → soft-skipbare FetchError, kein ImportError.
    monkeypatch.setitem(sys.modules, "playwright", None)
    monkeypatch.setitem(sys.modules, "playwright.async_api", None)
    with pytest.raises(FetchError):
        await fetch_rendered("https://x")


@pytest.mark.asyncio
async def test_fetch_rendered_wraps_playwright_error_as_fetcherror(monkeypatch):
    store = {}
    mod = _install_fake_playwright(monkeypatch, store)
    # Render-Laufzeitfehler (z.B. Timeout) wird zu FetchError übersetzt.
    err = mod.Error("Timeout 30000ms exceeded")
    mod.async_playwright = lambda: (_ for _ in ()).throw(err)
    with pytest.raises(FetchError):
        await fetch_rendered("https://x")


# --- collect_from_source Verzweigung ---
def _html_src(headless: bool) -> SourceConfig:
    return SourceConfig(name="AI Week Mainfranken",
                        url="https://www.ai-week.de/programm.php",
                        type="html", region="Mainfranken", headless=headless)


@pytest.mark.asyncio
async def test_collect_uses_rendered_fetch_for_headless_source(monkeypatch):
    used = {}

    async def fake_rendered(url, **kwargs):
        used["rendered"] = url
        return "<html><body>egal</body></html>"

    async def fake_text(url, **kwargs):
        used["text"] = url
        return "<html><body>egal</body></html>"

    async def fake_run(agent, text):
        return {"events": []}

    monkeypatch.setattr(pipe, "fetch_rendered", fake_rendered)
    monkeypatch.setattr(pipe, "fetch_text", fake_text)
    monkeypatch.setattr(pipe, "run_structured", fake_run)
    await pipe.collect_from_source(_html_src(headless=True))
    assert used.get("rendered") == "https://www.ai-week.de/programm.php"
    assert "text" not in used


@pytest.mark.asyncio
async def test_collect_uses_plain_fetch_for_non_headless_source(monkeypatch):
    used = {}

    async def fake_rendered(url, **kwargs):
        used["rendered"] = url
        return "<html></html>"

    async def fake_text(url, **kwargs):
        used["text"] = url
        return "<html></html>"

    async def fake_run(agent, text):
        return {"events": []}

    monkeypatch.setattr(pipe, "fetch_rendered", fake_rendered)
    monkeypatch.setattr(pipe, "fetch_text", fake_text)
    monkeypatch.setattr(pipe, "run_structured", fake_run)
    await pipe.collect_from_source(_html_src(headless=False))
    assert used.get("text") == "https://www.ai-week.de/programm.php"
    assert "rendered" not in used


@pytest.mark.asyncio
async def test_collect_soft_skips_headless_render_error(monkeypatch):
    """Ein Render-Fehler (FetchError) ist kein harter Pipeline-Fehler:
    die Quelle liefert 0 Events, der Lauf bleibt fehlerfrei."""
    async def boom(url, **kwargs):
        raise FetchError("playwright nicht installiert")

    monkeypatch.setattr(pipe, "fetch_rendered", boom)
    events, status = await pipe.collect_from_source(_html_src(headless=True))
    assert events == [] and status == "auto"
