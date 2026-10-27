import difflib
import html
import logging
import re

from app.models import Data, Source

logger = logging.getLogger(__name__)

REF_PATTERN = re.compile(r"<ref>(.*?)</ref>")

# How similar an unknown ref must be to a source id to count as a typo of it
TYPO_CUTOFF = 0.9


def find_source(ref_id: str, sources: dict[str, Source]) -> Source | None:
    """The source a ref points to, allowing for a small typo in the id."""
    if ref_id in sources:
        return sources[ref_id]
    matches = difflib.get_close_matches(ref_id, sources, n=1, cutoff=TYPO_CUTOFF)
    if matches:
        logger.warning("Ref %r matched to source %r", ref_id, matches[0])
        return sources[matches[0]]
    logger.warning("Ref %r doesn't match any source, removing it", ref_id)
    return None


def link_citations(item: Data) -> Data:
    """Replace each <ref>id</ref> with a numbered link, and number the cited sources.

    Sources are numbered in the order they're first cited, and come back cited
    first (in that order) then uncited.
    """
    sources = {source.id: source for source in item.sources}
    numbers: dict[str, int] = {}

    def replace(match: re.Match[str]) -> str:
        source = find_source(match.group(1).strip(), sources)
        if source is None:
            return ""
        number = numbers.setdefault(source.id, len(numbers) + 1)
        return (
            f'<a href="{html.escape(source.source)}" title="{html.escape(source.title)}">'
            f"[{number}]</a>"
        )

    content = REF_PATTERN.sub(replace, item.content)

    linked = [
        source.model_copy(update={"citation": numbers.get(source.id)})
        for source in item.sources
    ]
    linked.sort(key=lambda source: (source.citation is None, source.citation))

    return item.model_copy(update={"content": content, "sources": linked})
