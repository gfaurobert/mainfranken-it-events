import httpx
from bs4 import BeautifulSoup

_UA = "MainfrankenITEventsBot/0.1 (+https://www.it-mainfranken.org)"


class FetchError(Exception):
    """Quelle konnte nicht geladen werden (Netzwerk, Render, fehlende Engine).

    Wird in collect_from_source als Soft-Skip behandelt (0 Events, kein Crash) –
    analog zu httpx.HTTPError beim statischen Fetch. So reißt eine einzelne nicht
    renderbare headless-Quelle nie den ganzen Lauf mit."""


def html_to_text(html: str) -> str:
    """Strip markup/scripts and return readable text, one item per line.

    Feeding cleaned text (instead of raw HTML) to the LLM extractor surfaces
    far more actual event content per token budget."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "head"]):
        tag.decompose()
    lines = [ln.strip() for ln in soup.get_text("\n").splitlines()]
    return "\n".join(ln for ln in lines if ln)


async def fetch_text(url: str, *, timeout: float = 20.0) -> str:
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(url, headers={"User-Agent": _UA})
        resp.raise_for_status()
        return resp.text


async def fetch_rendered(
    url: str, *, timeout: float = 30.0, wait_until: str = "networkidle"
) -> str:
    """Lädt eine Seite in einem headless-Chromium und gibt das gerenderte HTML zurück.

    Für Quellen, deren Event-Listing erst per JavaScript ins DOM kommt (statisches
    HTML zeigt nur ein Filter-Gerüst). Das Ergebnis durchläuft danach denselben
    html_to_text → LLM-Extractor-Pfad wie eine normale html-Quelle.

    Playwright ist eine optionale, schwere Dependency (Browser-Binaries). Fehlt sie
    oder schlägt das Rendern fehl (Timeout, Navigationsfehler), wird der Fehler in
    FetchError übersetzt, sodass die Quelle in der Pipeline sauber übersprungen wird
    statt den Lauf abzubrechen."""
    try:
        from playwright.async_api import Error as PlaywrightError
        from playwright.async_api import async_playwright
    except ImportError as e:
        raise FetchError(
            "playwright nicht installiert – `uv sync --extra headless` und "
            "`uv run playwright install chromium`"
        ) from e

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                page = await browser.new_page(user_agent=_UA)
                await page.goto(url, wait_until=wait_until,
                                timeout=int(timeout * 1000))
                return await page.content()
            finally:
                await browser.close()
    except PlaywrightError as e:
        raise FetchError(str(e)) from e
