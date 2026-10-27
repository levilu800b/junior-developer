from app.citations import link_citations
from app.models import Data, Source


def make_item(content: str) -> Data:
    return Data(
        category="test",
        question="A question",
        sources=[
            Source(id="aaaaaaaaaaaaaaaaaaaa", title="Source A", source="https://a.example/page"),
            Source(id="bbbbbbbbbbbbbbbbbbbb", title="Source B", source="https://b.example/page"),
            Source(id="cccccccccccccccccccc", title="Source C", source="https://c.example/page"),
        ],
        content=content,
    )


def test_replaces_refs_with_numbered_links():
    item = link_citations(make_item("One <ref>bbbbbbbbbbbbbbbbbbbb</ref>. Two<ref>aaaaaaaaaaaaaaaaaaaa</ref>"))

    assert item.content == (
        'One <a href="https://b.example/page" title="Source B">[1]</a>. '
        'Two<a href="https://a.example/page" title="Source A">[2]</a>'
    )


def test_repeat_citations_reuse_the_same_number():
    item = link_citations(make_item("<ref>aaaaaaaaaaaaaaaaaaaa</ref> <ref>aaaaaaaaaaaaaaaaaaaa</ref>"))

    assert item.content.count(">[1]</a>") == 2
    assert ">[2]</a>" not in item.content


def test_sources_are_numbered_cited_first_then_uncited():
    item = link_citations(make_item("<ref>cccccccccccccccccccc</ref> <ref>aaaaaaaaaaaaaaaaaaaa</ref>"))

    assert [(source.title, source.citation) for source in item.sources] == [
        ("Source C", 1),
        ("Source A", 2),
        ("Source B", None),
    ]


def test_ref_with_a_typo_links_to_the_closest_source():
    item = link_citations(make_item("<ref>bbbbbbbbbbbbbbbbbbb</ref>"))

    assert item.content == '<a href="https://b.example/page" title="Source B">[1]</a>'


def test_ref_matching_no_source_is_removed():
    item = link_citations(make_item("Text<ref>zzzzzzzzzzzzzzzzzzzz</ref>."))

    assert item.content == "Text."
    assert all(source.citation is None for source in item.sources)


def test_leaves_other_html_alone():
    item = link_citations(make_item("<b>Bold</b>\n<ref>aaaaaaaaaaaaaaaaaaaa</ref>"))

    assert item.content.startswith("<b>Bold</b>\n<a ")


def test_escapes_source_details_in_the_link():
    item = make_item("<ref>aaaaaaaaaaaaaaaaaaaa</ref>")
    item.sources[0].title = 'Say "hi" <script>'

    assert 'title="Say &quot;hi&quot; &lt;script&gt;"' in link_citations(item).content
