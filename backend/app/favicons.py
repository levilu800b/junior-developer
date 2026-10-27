import asyncio
import logging
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx

logger = logging.getLogger(__name__)

# Favicon URL for each site, so each site is only looked up once
_cache: dict[str, str] = {}


class IconLinkParser(HTMLParser):
    """Collects the href of every <link rel="icon"> (or "shortcut icon") in a page."""

    def __init__(self) -> None:
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "link":
            return
        attributes = dict(attrs)
        rel = (attributes.get("rel") or "").lower().split()
        if "icon" in rel and attributes.get("href"):
            self.hrefs.append(attributes["href"])


async def find_favicon(client: httpx.AsyncClient, site: str) -> str | None:
    """The favicon a site's home page declares, falling back to /favicon.ico.

    If the home page can't be read we don't know what the real favicon is, and
    /favicon.ico isn't safe to guess (police.uk's is blank), so this returns None.
    """
    try:
        response = await client.get(site)
        if not response.is_success:
            logger.warning("Couldn't get the favicon for %s: %s", site, response.status_code)
            return None

        parser = IconLinkParser()
        parser.feed(response.text)
        if parser.hrefs:
            return urljoin(str(response.url), parser.hrefs[0])

        fallback = urljoin(str(response.url), "/favicon.ico")
        response = await client.get(fallback)
        if response.is_success and response.headers.get("content-type", "").startswith("image/"):
            return fallback
        logger.warning("Couldn't get the favicon for %s: %s", site, response.status_code)
    except httpx.HTTPError as error:
        logger.warning("Couldn't get the favicon for %s: %s", site, error)
    return None


def google_favicon(site: str) -> str:
    """Google's favicon service, for sites that block us from looking ourselves."""
    return f"https://www.google.com/s2/favicons?domain={urlsplit(site).netloc}&sz=64"


async def get_favicons(urls: list[str]) -> dict[str, str]:
    """The favicon for each URL's website."""
    sites = {url: f"{urlsplit(url).scheme}://{urlsplit(url).netloc}" for url in urls}
    missing = {site for site in sites.values() if site not in _cache}

    if missing:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=5,
            headers={"User-Agent": "Mozilla/5.0 (compatible; CASORT junior developer practical)"},
        ) as client:
            missing = list(missing)
            found = await asyncio.gather(*(find_favicon(client, site) for site in missing))
        # Only cache successes, so a site that's briefly down is tried again next time
        _cache.update({site: icon for site, icon in zip(missing, found) if icon})

    return {url: _cache.get(site) or google_favicon(site) for url, site in sites.items()}
