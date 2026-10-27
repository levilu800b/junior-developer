# Notes

## Setup

### What failed

`make install` failed at `uv sync` on my machine, an Intel Mac (Core i9, macOS 26):

```
error: Distribution `torch==2.14.1` can't be installed because it doesn't have a
source distribution or wheel for the current platform
hint: You're on macOS (`macosx_26_0_x86_64`), but `torch` (v2.14.1) only has wheels for
`manylinux_2_28_aarch64`, `manylinux_2_28_x86_64`, `macosx_14_0_arm64`, `win_amd64`
```

PyTorch stopped publishing Intel macOS wheels after 2.2, and 2.2 doesn't support Python 3.14, so the backend can't run natively on an Intel Mac. Downgrading Python and torch would have meant changing `pyproject.toml` and `uv.lock` for everyone, so I didn't do that.

### How I got round it

I ran the backend in a Linux container, where torch has wheels. The `backend/` folder is mounted into the container, so hot reload still works. Packages and the model are kept in Docker volumes, so they only download once. The frontend runs natively as normal.

```bash
cd backend

# Once: install packages and download the model
docker run --rm -v "$PWD":/app -w /app \
  -v jd-venv:/opt/venv -v jd-hf:/root/.cache/huggingface -v jd-uv:/root/.cache/uv \
  -e UV_PROJECT_ENVIRONMENT=/opt/venv -e UV_LINK_MODE=copy \
  ghcr.io/astral-sh/uv:python3.14-bookworm-slim \
  sh -c 'uv sync --frozen && uv run --frozen python -c "from gliner2 import GLiNER2; from app.config import get_settings; GLiNER2.from_pretrained(get_settings().model_id); print(\"Model ready\")"'

# Run the backend on http://localhost:8000
docker run -d --name jd-backend -p 8000:8000 -v "$PWD":/app -w /app \
  -v jd-venv:/opt/venv -v jd-hf:/root/.cache/huggingface -v jd-uv:/root/.cache/uv \
  -e UV_PROJECT_ENVIRONMENT=/opt/venv -e UV_LINK_MODE=copy -e HF_HUB_OFFLINE=1 \
  ghcr.io/astral-sh/uv:python3.14-bookworm-slim \
  uv run --frozen fastapi dev --host 0.0.0.0 --port 8000
```

`UV_PROJECT_ENVIRONMENT` keeps the Linux virtual environment out of `backend/.venv`, so it doesn't clash with the host. `--host 0.0.0.0` is needed so the port is reachable from outside the container.

The downside is speed. Loading the model takes about 3 minutes in the container rather than the 10 seconds in SETUP.md, and it happens again on every reload. So I tested the citation and redaction logic on its own before wiring it into the endpoint.

## Linking the citations

The code is in `backend/app/citations.py`, with tests in `backend/tests/test_citations.py` (`uv run pytest`).

- **Links.** Each `<ref>id</ref>` becomes `<a href="..." title="...">[n]</a>`. The sources are numbered in the order the answer first cites them, so the first citation is always [1]. If the answer cites the same source twice, both links get the same number. The source's URL and title are HTML-escaped before they go into the link.
- **Cited and uncited sources.** Each source now has a `citation` field: its number, or `null` if the answer doesn't cite it. `GET /data` returns the cited sources first, in number order, then the uncited ones, so the list on the page matches the numbers in the answer.
- **A ref that doesn't match.** In the debt answer, the last ref is `dOQ-BJgBLViOYD1OzWM`, but the source is `dOQ-BJgBBLViOYD1OzWM`, one `B` short. I treat a ref with no exact match as a typo when it's at least 90% similar to one of that answer's own sources (`difflib`), and log a warning. If nothing is that close, I drop the ref rather than show a link to the wrong place or a broken one. The sources' ids are otherwise very different from each other, so 90% only catches a one- or two-character slip. A wrong guess is the risk. In a real system I'd rather fix the data where it's produced, or flag the citation to the adviser.
- **Testing found a bug.** My first version sorted the sources with `key=lambda s: s.citation or len(linked) + 1`. Python empties a list while sorting it, so `len(linked)` was 0 and uncited sources tied with [1]. The mock data happened to come out in the right order, so I only caught it with a test.

## Favicons

The code is in `backend/app/favicons.py`. For each website (not each page), the backend:

1. Fetches the home page and uses the first `<link rel="icon">` it declares.
2. If there isn't one, or the page can't be fetched, tries `/favicon.ico` at the site root.
3. If that fails too, falls back to Google's favicon service (`https://www.google.com/s2/favicons?domain=...`), so the frontend always has an image to show.

The sites are looked up at the same time with `httpx.AsyncClient`, and found icons are cached in memory. Failures aren't cached, so a site that's briefly down is tried again next time. `GET /data` became `async` for this.

police.uk returns `403 Forbidden` to the home-page request, probably bot protection. I didn't try to get round that, for example by pretending to be a browser. Its `/favicon.ico` is served normally, so step 2 handles it.

Looking favicons up on every request is fine for four items. With more data I'd store each favicon URL alongside the source when it's added, instead of on each read.

## Redacting the question

The code is in `backend/app/redaction.py`, with tests in `backend/tests/test_redaction.py`.

- **Finding the details.** `model.extract_entities(..., include_spans=True, include_confidence=True)` with the five labels from the task. Each find becomes a Presidio `RecognizerResult(entity_type, start, end, score)`, and `AnonymizerEngine` replaces it using a `replace` operator per type: `[NAME]`, `[EMAIL]` and `[PHONE]`.
- **One `[NAME]` per name.** For "Sarah Jones", the model returns three finds: the full name and each part. The parts score slightly *higher* than the full name (0.99999 for "Sarah" against 0.99980). I read Presidio's `_remove_conflicts_and_get_text_manipulation_data` to see how it handles that. It merges any overlapping finds **of the same entity type** into one span, then drops finds contained inside another, and `anonymize()` also merges same-type finds separated only by spaces. So I map `full_name`, `first_name` and `last_name` all to one entity type, `NAME`. "Sarah", "Jones" and "Sarah Jones" become one span whatever their scores. A first and last name found without the full name ("Alex" + "Smith") would also come out as a single `[NAME]`. The tests cover both cases using a fake model, so they run without loading the real one.
- **Results.** All four questions come out right, including possessives ("[NAME]'s ESA"), a first name used again on its own later ("reach [NAME]"), a landline and a `.co.uk` email address. A search of the whole `GET /data` response for any of the names, numbers or emails finds nothing.
- **It fails closed.** If the model throws an error, the request fails with a 500 rather than returning the unredacted question. The original question text is never logged.
- **Threshold.** I left the model's default threshold of 0.5. The lowest-scoring find in the data is "Reid" at 0.90, so there was no evidence to justify changing it. With real data I'd want to test a lower threshold, because in this domain missing a name is worse than over-redacting a word.
- **Speed.** The model runs on CPU, so `redact` runs in a thread pool with `run_in_threadpool`, which keeps the async endpoint from blocking the server. In my container, the first request takes about 14 seconds, including the favicon lookups, so each redacted question is cached in memory with `lru_cache`. After the first request, `GET /data` takes under 0.2 seconds. In a real system I'd redact each question once, when it's saved, and only ever store the redacted version.
