import httpx
from bs4 import BeautifulSoup

_UA = "MainfrankenITEventsBot/0.1 (+https://www.it-mainfranken.org)"


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
