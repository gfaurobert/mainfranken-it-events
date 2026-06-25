import httpx

_UA = "MainfrankenITEventsBot/0.1 (+https://www.it-mainfranken.org)"


async def fetch_text(url: str, *, timeout: float = 20.0) -> str:
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(url, headers={"User-Agent": _UA})
        resp.raise_for_status()
        return resp.text
