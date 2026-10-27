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
2. If the page loads but doesn't declare an icon, tries `/favicon.ico` at the site root.
3. Otherwise, including when the home page can't be fetched, falls back to Google's favicon service (`https://www.google.com/s2/favicons?domain=...`), so the frontend always has an image to show.

The sites are looked up at the same time with `httpx.AsyncClient`, and found icons are cached in memory. Failures aren't cached, so a site that's briefly down is tried again next time. `GET /data` became `async` for this.

police.uk returns `403 Forbidden` to the home-page request, probably bot protection. I didn't try to get round that, for example by pretending to be a browser. At first I fell back to its `/favicon.ico`, which is served normally and returned a 200. But when I looked at the page, the icon was blank. I opened the `.ico` file and both of its frames (16px and 32px) are completely transparent: it's a placeholder, and the real icon is only declared on the home page. So now `/favicon.ico` is only tried when the home page loads but doesn't declare an icon. If we can't read the home page, we don't know what the real icon is, so it goes to Google's service, which shows the proper police.uk icon. I learned that a 200 response doesn't mean the image is useful, and you have to look at the result.

Looking favicons up on every request is fine for four items. With more data I'd store each favicon URL alongside the source when it's added, instead of on each read.

## Redacting the question

The code is in `backend/app/redaction.py`, with tests in `backend/tests/test_redaction.py`.

- **Finding the details.** `model.extract_entities(..., include_spans=True, include_confidence=True)` with the five labels from the task. Each find becomes a Presidio `RecognizerResult(entity_type, start, end, score)`, and `AnonymizerEngine` replaces it using a `replace` operator per type: `[NAME]`, `[EMAIL]` and `[PHONE]`.
- **One `[NAME]` per name.** For "Sarah Jones", the model returns three finds: the full name and each part. The parts score slightly *higher* than the full name (0.99999 for "Sarah" against 0.99980). I read Presidio's `_remove_conflicts_and_get_text_manipulation_data` to see how it handles that. It merges any overlapping finds **of the same entity type** into one span, then drops finds contained inside another, and `anonymize()` also merges same-type finds separated only by spaces. So I map `full_name`, `first_name` and `last_name` all to one entity type, `NAME`. "Sarah", "Jones" and "Sarah Jones" become one span whatever their scores. A first and last name found without the full name ("Alex" + "Smith") would also come out as a single `[NAME]`. The tests cover both cases using a fake model, so they run without loading the real one.
- **Results.** All four questions come out right, including possessives ("[NAME]'s ESA"), a first name used again on its own later ("reach [NAME]"), a landline and a `.co.uk` email address. A search of the whole `GET /data` response for any of the names, numbers or emails finds nothing.
- **It fails closed.** If the model throws an error, the request fails with a 500 rather than returning the unredacted question. The original question text is never logged.
- **Threshold.** I left the model's default threshold of 0.5. The lowest-scoring find in the data is "Reid" at 0.90, so there was no evidence to justify changing it. With real data I'd want to test a lower threshold, because in this domain missing a name is worse than over-redacting a word.
- **Speed.** The model runs on CPU, so `redact` runs in a thread pool with `run_in_threadpool`, which keeps the async endpoint from blocking the server. In my container, the first request takes about 14 seconds, including the favicon lookups, so each redacted question is cached in memory with `lru_cache`. After the first request, `GET /data` takes under 0.2 seconds. In a real system I'd redact each question once, when it's saved, and only ever store the redacted version.

## Frontend

The code is in `frontend/app/page.tsx`, `frontend/components/Content.tsx` and `frontend/lib/data.ts`. The repo's `AGENTS.md` (written by `next dev`) points out that Next.js 16 differs from older versions, so I read the bundled docs on data fetching and caching first.

- **Fetching.** `ContentList` is a Server Component that calls `getData()` inside the existing `<Suspense>`. With `cacheComponents` on, that streams fresh data on each request behind the "Loading..." fallback. I didn't add `"use cache"`, because the backend is the source of truth and already caches the slow part. The backend URL comes from `BACKEND_URL` and defaults to `http://localhost:8000`. The fetch runs on the server, so it doesn't need a `NEXT_PUBLIC_` variable. If the backend is down, the page shows a message instead of crashing. I checked this by running the production build with `BACKEND_URL` pointing at a port with nothing on it. The first `npm run build` logged a `HANGING_PROMISE_REJECTION` error: during prerendering, Next.js deliberately interrupts the `fetch` to mark the data as dynamic, and my `.catch()` was catching that as if it were a real error. Following the `unstable_rethrow` docs, the catch now passes Next.js's own errors back to it, and the build is clean. The types in `lib/data.ts` mirror `backend/app/models.py`.
- **The answer's HTML.** The answer is HTML written by a model, so I don't pass it straight to `dangerouslySetInnerHTML`. It's cleaned with `sanitize-html` first, on the server, so none of it ships to the browser. Only formatting tags (`b`, `strong`, `em`, lists) and `a` with `href` and `title` are allowed, and only `https` links. Every link gets `target="_blank" rel="noopener noreferrer"`. `npm audit` flagged XSS advisories against sanitize-html up to 2.17.7, so I used 2.18.1, which fixes them. The `\n`s in the answers are kept with `whitespace-pre-line` rather than turned into `<br>`s.
- **Layout.** Each item is a white card on the blue background, with its category, the question, the answer and the sources.
  - The question is shown as a quote. Each placeholder is styled as a grey chip with a tooltip ("Name removed"), so it's obvious something was redacted rather than looking like odd text.
  - Citations are small superscript links: [1], [2] and so on.
  - The sources list puts the cited ones first, numbered to match the links in the answer. The uncited ones go under "Also found, but not cited in the answer", so the adviser can tell what the answer actually relied on. Each source shows its favicon, title and site name.
  - The padding gets smaller on narrow screens.
- **Favicons.** I used `next/image` with `unoptimized`. The icons are 16px and come from any number of sites, so Next's image optimiser gains nothing, and this way `next.config.ts` doesn't need a `remotePatterns` entry for every site a source might come from. They have `alt=""` because they're decorative, and the site name is shown as text next to them.
- **Checks.** `tsc --noEmit` and `npm run lint` pass, and the Cypress tests cover the page (see [Testing](#testing)). I checked the rendered page with headless Chrome screenshots, which is how I found the blank police.uk icon. The browser console shows a hydration warning, but it comes from my browser extensions (Grammarly and Scribe add attributes to `<body>`), not the app.

## Testing

I think testing is very important. It's how I confirm the software actually does what it should, rather than assuming it does because it looks right. It also lets anyone change the code later without breaking something by accident. Writing tests caught two real problems in this task that I'd otherwise have missed, both described below. So I added two layers of tests.

### Backend unit tests (pytest): 12 tests

Run them with `cd backend && uv run pytest`. These test the logic on its own, quickly, without the server or the 1.2 GB model.

- **`tests/test_citations.py`** (7 tests). Refs become numbered links. A repeat citation reuses its number. Sources come back cited first, then uncited. A ref with a typo links to the closest source. A ref that matches nothing is removed. Other HTML is left alone. Source titles and URLs are escaped. *Why:* the citation logic has the most edge cases, and the mock data only covers some of them. This is the suite that found the sorting bug.
- **`tests/test_redaction.py`** (5 tests). Each kind of detail becomes the right placeholder. "Alex Smith", "Alex" and "Smith" become one `[NAME]`. "Alex" and "Smith" found separately become one `[NAME]`. A name part scored higher than the full name is still one `[NAME]`. Text with no details is unchanged. *Why:* the "one `[NAME]`, not `[NAME] [NAME]`" rule is the trickiest part of the task. These tests use a fake model that returns set finds, so they check my Presidio logic exactly and can't pass by luck because of what the real model happened to find.

### End-to-end tests (Cypress): 15 tests

Run them with `cd frontend && npm run test:e2e`, with the app running (`make dev`), or use `npm run cypress` to watch them in the Cypress app. These test the real app from end to end: the real model, the real backend, the real page.

- **`cypress/e2e/api.cy.ts`** (6 tests) calls `GET /data` directly. It checks that none of the 16 personal details in `cypress/fixtures/personal-details.json` appear **anywhere** in the response, that every question has its placeholders, that every link points to one of that item's own sources, that citations are numbered from 1 with cited sources first, and that every source has a favicon. *Why:* the task says the real details must "never leave the backend", so hiding them on the page isn't enough. The API response itself has to be checked.
- **`cypress/e2e/app.cy.ts`** (9 tests) checks the page as an adviser sees it, grouped under the three frontend requirements in TASK.md:
  1. *The redacted question.* No personal details anywhere on the page. One `[NAME]` per name. A placeholder for each kind of detail.
  2. *The answer with working citation links.* No raw `<ref>` tags. Each citation's number matches the number of the source it links to, and it opens safely in a new tab. The debt answer's typo'd ref links to the right source. The bold text is kept.
  3. *Every source with its favicon.* All four sources per item, cited ones numbered from [1]. Every favicon has actually loaded (`naturalWidth > 0`), not just been given a URL.

  *Why:* the unit tests prove the pieces work, and these prove they work together in a browser. Checking that the image loaded is deliberate: the blank police.uk favicon would have passed a test that only checked an `<img>` was there.

Cypress is a dev dependency, so the first `npm install` also downloads the Cypress app (a few hundred MB). Set `CYPRESS_INSTALL_BINARY=0` to skip that if you don't need to run the tests.

I added `data-testid` attributes to `Content.tsx` so the tests don't depend on Tailwind classes, which change whenever the design does.

Two things I learned getting Cypress to run:

- **VS Code's terminal sets `ELECTRON_RUN_AS_NODE=1`**, so Cypress fails with `bad option: --no-sandbox`. Running `env -u ELECTRON_RUN_AS_NODE npm run test:e2e` fixes it. A normal terminal doesn't have the problem.
- **The favicon test failed on its first run.** `next/image` lazy-loads images, so favicons further down the page hadn't loaded yet. That was the test's mistake, not the app's, so the test now scrolls each favicon into view first, as an adviser would.

Results: **12/12 pytest, 15/15 Cypress.** `tsc --noEmit` and `npm run lint` also pass.

## What I'd do with more time

- A unit test for the sanitiser, checking it strips `<script>`, `onclick` and `javascript:` links. The Cypress tests use the real data, which has none of those, so this protection is reviewed but not tested.
- Run the pytest and Cypress tests in CI (GitHub Actions) on every push.
- Make the citation links jump to the source in the list as well as opening the page, so the adviser can see the source's title before leaving the app.
- Redact and look up favicons once when the data is saved, instead of on each request with an in-memory cache.
