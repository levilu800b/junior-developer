from pydantic import BaseModel


class Source(BaseModel):
    id: str
    title: str
    source: str
    favicon: str | None = None
    # The number the answer's links use for this source, or None if it isn't cited
    citation: int | None = None


class Data(BaseModel):
    category: str
    question: str
    sources: list[Source]
    content: str
