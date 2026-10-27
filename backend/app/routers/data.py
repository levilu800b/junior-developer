import json
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from gliner2 import GLiNER2

from app.citations import link_citations
from app.dependencies import get_model
from app.favicons import get_favicons
from app.models import Data
from app.redaction import redact

router = APIRouter(tags=["data"])

DATA_FILE = Path(__file__).resolve().parents[2] / "data" / "mock.json"


@router.get("/data")
async def get_data(model: GLiNER2 = Depends(get_model)) -> list[Data]:
    items = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    items = [link_citations(Data.model_validate(item)) for item in items]

    for item in items:
        # The model is slow and blocking, so run it off the event loop
        item.question = await run_in_threadpool(redact, model, item.question)

    favicons = await get_favicons([source.source for item in items for source in item.sources])
    for item in items:
        for source in item.sources:
            source.favicon = favicons[source.source]

    return items
