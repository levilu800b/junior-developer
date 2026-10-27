import json
from pathlib import Path

from fastapi import APIRouter

from app.citations import link_citations
from app.favicons import get_favicons
from app.models import Data

router = APIRouter(tags=["data"])

DATA_FILE = Path(__file__).resolve().parents[2] / "data" / "mock.json"


@router.get("/data")
async def get_data() -> list[Data]:
    items = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    items = [link_citations(Data.model_validate(item)) for item in items]

    favicons = await get_favicons([source.source for item in items for source in item.sources])
    for item in items:
        for source in item.sources:
            source.favicon = favicons[source.source]

    return items
