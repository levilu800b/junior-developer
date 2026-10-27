# Notes

## Running my version

You don't need Docker. Follow SETUP.md as normal (`make install`, then `make dev`). I only used Docker because my own laptop is an Intel Mac, which PyTorch no longer supports (see [Setup](#setup)).

I checked `backend/uv.lock`, and PyTorch publishes builds for Apple Silicon Macs (macOS 14 or later), Windows on x64 and Linux, so the backend should install and run natively on any of those. It won't install on an Intel Mac or a Windows on ARM laptop, because PyTorch has no builds for them. None of my code is platform-specific.

My changes only add dependencies:

- **Backend:** `pytest` as a dev dependency.
- **Frontend:** `sanitize-html`, plus `cypress` as a dev dependency.

To run the tests:

- **Backend:** `cd backend && uv run pytest`
- **End-to-end:** `cd frontend && npm run test:e2e`, with the app running.

## Setup

### What failed

`make install` failed at `uv sync` on my machine, an Intel Mac (Core i9, macOS 26):

```
error: Distribution `torch==2.14.1` can't be installed because it doesn't have a
source distribution or wheel for the current platform
hint: You're on macOS (`macosx_26_0_x86_64`), but `torch` (v2.14.1) only has wheels for
`manylinux_2_28_aarch64`, `manylinux_2_28_x86_64`, `macosx_14_0_arm64`, `win_amd64`
```

PyTorch stopped publishing Intel macOS wheels after 2.2, and 2.2 doesn't support Python 3.14, so I couldn't run the backend natively on my Intel Mac. Downgrading Python and torch would have meant changing `pyproject.toml` and `uv.lock` for everyone, so I didn't do that.

### How I got round it

I ran the backend in a Linux container, where torch has wheels. I mounted the `backend/` folder into the container so hot reload still worked, and kept the packages and the model in Docker volumes so they only downloaded once. I ran the frontend natively as normal.

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

I set `UV_PROJECT_ENVIRONMENT` to keep the Linux virtual environment out of `backend/.venv`, so it didn't clash with my Mac's. I used `--host 0.0.0.0` so the port was reachable from outside the container.

The downside was speed. In the container, the model took about 3 minutes to load rather than the 10 seconds in SETUP.md, and it reloaded every time I saved a Python file. So I tested my citation and redaction logic on its own before wiring it into the endpoint.

## Linking the citations

I put the code in `backend/app/citations.py` and its tests in `backend/tests/test_citations.py`.

- **Links.** I replace each `<ref>id</ref>` with `<a href="..." title="...">[n]</a>`. I number the sources in the order the answer first cites them, so the first citation is always [1]. If the answer cites the same source twice, both links get the same number. I HTML-escape the source's URL and title before putting them in the link.
- **Cited and uncited sources.** I added a `citation` field to each source: its number, or `null` if the answer doesn't cite it. `GET /data` returns the cited sources first, in number order, then the uncited ones, so the list on the page matches the numbers in the answer.
- **A ref that doesn't match.** In the debt answer, the last ref is `dOQ-BJgBLViOYD1OzWM`, but the source is `dOQ-BJgBBLViOYD1OzWM`, one `B` short. I treat a ref with no exact match as a typo when it's at least 90% similar to one of that answer's own sources (`difflib`), and log a warning. If nothing is that close, I drop the ref rather than show a link to the wrong place or a broken one. The sources' ids are otherwise very different from each other, so 90% only catches a one- or two-character slip. A wrong guess is the risk. In a real system I'd rather fix the data where it's produced, or flag the citation to the adviser.
- **Testing found a bug.** My first version sorted the sources with `key=lambda s: s.citation or len(linked) + 1`. Python empties a list while sorting it, so `len(linked)` was 0 and uncited sources tied with [1]. The mock data happened to come out in the right order, so I only caught it with a test.

## Favicons

I put the code in `backend/app/favicons.py`. For each website (not each page), my code:

1. Fetches the home page and uses the first `<link rel="icon">` it declares.
2. If the page loads but doesn't declare an icon, tries `/favicon.ico` at the site root.
3. Otherwise, including when the home page can't be fetched, falls back to Google's favicon service (`https://www.google.com/s2/favicons?domain=...`), so the frontend always has an image to show.

I look up all the sites at the same time with `httpx.AsyncClient` and cache the icons I find in memory. I don't cache failures, so a site that's briefly down is tried again next time. I made `GET /data` `async` for this.

police.uk returns `403 Forbidden` to the home-page request, probably bot protection. I didn't try to get round that, for example by pretending to be a browser. At first I fell back to its `/favicon.ico`, which is served normally and returned a 200. But when I looked at the page, the icon was blank. I opened the `.ico` file and both of its frames (16px and 32px) are completely transparent: it's a placeholder, and the real icon is only declared on the home page. So now I only try `/favicon.ico` when the home page loads but doesn't declare an icon. If I can't read the home page, I don't know what the real icon is, so I go to Google's service, which shows the proper police.uk icon. I learned that a 200 response doesn't mean the image is useful, and that I have to look at the result.

Looking favicons up on every request is fine for four items. With more data I'd store each favicon URL alongside the source when it's added, instead of on each read.

## Redacting the question

I put the code in `backend/app/redaction.py` and its tests in `backend/tests/test_redaction.py`.

- **Finding the details.** I call `model.extract_entities(..., include_spans=True, include_confidence=True)` with the five labels from the task. I turn each find into a Presidio `RecognizerResult(entity_type, start, end, score)`, and use `AnonymizerEngine` with a `replace` operator per type to swap in `[NAME]`, `[EMAIL]` and `[PHONE]`.
- **One `[NAME]` per name.** For "Sarah Jones", the model returns three finds: the full name and each part. The parts score slightly *higher* than the full name (0.99999 for "Sarah" against 0.99980). I read Presidio's `_remove_conflicts_and_get_text_manipulation_data` to see how it handles that. It merges any overlapping finds **of the same entity type** into one span, then drops finds contained inside another, and `anonymize()` also merges same-type finds separated only by spaces. So I map `full_name`, `first_name` and `last_name` all to one entity type, `NAME`. "Sarah", "Jones" and "Sarah Jones" become one span whatever their scores. A first and last name found without the full name ("Alex" + "Smith") would also come out as a single `[NAME]`. I wrote tests for both cases using a fake model, so they run without loading the real one.
- **Results.** All four questions come out right, including possessives ("[NAME]'s ESA"), a first name used again on its own later ("reach [NAME]"), a landline and a `.co.uk` email address. I searched the whole `GET /data` response for every name, number and email and found none of them.
- **It fails closed.** If the model throws an error, the request fails with a 500 rather than returning the unredacted question. I never log the original question text.
- **Threshold.** I left the model's default threshold of 0.5. The lowest-scoring find in the data is "Reid" at 0.90, so I had no evidence to justify changing it. With real data I'd want to test a lower threshold, because in this domain missing a name is worse than over-redacting a word.
- **Speed.** The model runs on CPU, so I run `redact` in a thread pool with `run_in_threadpool` to keep the async endpoint from blocking the server. In my container, the first request took about 14 seconds, including the favicon lookups, so I cache each redacted question in memory with `lru_cache`. After the first request, `GET /data` took under 0.2 seconds. In a real system I'd redact each question once, when it's saved, and only ever store the redacted version.

## Frontend

I put the code in `frontend/app/page.tsx`, `frontend/components/Content.tsx` and `frontend/lib/data.ts`. The repo's `AGENTS.md` (written by `next dev`) points out that Next.js 16 differs from older versions, so I read the bundled docs on data fetching and caching first.

- **Fetching.** I made `ContentList` a Server Component that calls `getData()` inside the existing `<Suspense>`. With `cacheComponents` on, that streams fresh data on each request behind the "Loading..." fallback. I didn't add `"use cache"`, because the backend is the source of truth and already caches the slow part. I read the backend URL from `BACKEND_URL`, defaulting to `http://localhost:8000`. The fetch runs on the server, so it doesn't need a `NEXT_PUBLIC_` variable. I typed the data in `lib/data.ts` to match `backend/app/models.py`.
- **When the backend is down.** The page shows a message instead of crashing. I checked this by running the production build with `BACKEND_URL` pointing at a port with nothing on it. My first `npm run build` logged a `HANGING_PROMISE_REJECTION` error: during prerendering, Next.js deliberately interrupts the `fetch` to mark the data as dynamic, and my `.catch()` was catching that as if it were a real error. Following the `unstable_rethrow` docs, I made the catch pass Next.js's own errors back to it, and the build is now clean.
- **The answer's HTML.** The answer is HTML written by a model, so I don't pass it straight to `dangerouslySetInnerHTML`. I clean it with `sanitize-html` first, on the server, so none of it ships to the browser. I only allow formatting tags (`b`, `strong`, `em`, lists) and `a` with `href` and `title`, and only `https` links. I give every link `target="_blank" rel="noopener noreferrer"`. `npm audit` flagged XSS advisories against sanitize-html up to 2.17.7, so I used 2.18.1, which fixes them. I kept the `\n`s in the answers with `whitespace-pre-line` rather than turning them into `<br>`s.
- **Layout.** I show each item as a white card on the blue background, with its category, the question, the answer and the sources.
  - I show the question as a quote, and style each placeholder as a grey chip with a tooltip ("Name removed"), so it's obvious something was redacted rather than looking like odd text.
  - I made citations small superscript links: [1], [2] and so on.
  - I list the cited sources first, numbered to match the links in the answer, and put the uncited ones under "Also found, but not cited in the answer", so the adviser can tell what the answer actually relied on. Each source shows its favicon, title and site name.
  - I reduced the padding on narrow screens.
- **Favicons.** I used `next/image` with `unoptimized`. The icons are 16px and come from any number of sites, so Next's image optimiser gains nothing, and this way `next.config.ts` doesn't need a `remotePatterns` entry for every site a source might come from. I gave them `alt=""` because they're decorative, and show the site name as text next to them.
- **Checks.** `tsc --noEmit`, `npm run lint` and `npm run build` pass, and my Cypress tests cover the page (see [Testing](#testing)). I also checked the rendered page with headless Chrome screenshots, which is how I found the blank police.uk icon. The browser console shows a hydration warning, but it comes from my browser extensions (Grammarly and Scribe add attributes to `<body>`), not the app.

## Testing

I think testing is very important. It's how I confirm the software actually does what it should, rather than assuming it does because it looks right. It also lets anyone change the code later without breaking something by accident. Writing tests caught two real problems in this task that I'd otherwise have missed, both described below. So I added two layers of tests.

### Backend unit tests (pytest): 12 tests

Run them with `cd backend && uv run pytest`. I wrote these to test the logic on its own, quickly, without the server or the 1.2 GB model.

- **`tests/test_citations.py`** (7 tests). Refs become numbered links. A repeat citation reuses its number. Sources come back cited first, then uncited. A ref with a typo links to the closest source. A ref that matches nothing is removed. Other HTML is left alone. Source titles and URLs are escaped. *Why:* the citation logic has the most edge cases, and the mock data only covers some of them. This is the suite that found my sorting bug.
- **`tests/test_redaction.py`** (5 tests). Each kind of detail becomes the right placeholder. "Alex Smith", "Alex" and "Smith" become one `[NAME]`. "Alex" and "Smith" found separately become one `[NAME]`. A name part scored higher than the full name is still one `[NAME]`. Text with no details is unchanged. *Why:* the "one `[NAME]`, not `[NAME] [NAME]`" rule is the trickiest part of the task. I used a fake model that returns set finds, so the tests check my Presidio logic exactly and can't pass by luck because of what the real model happened to find.

### End-to-end tests (Cypress): 15 tests

Run them with `cd frontend && npm run test:e2e`, with the app running (`make dev`), or use `npm run cypress` to watch them in the Cypress app. I wrote these to test the real app from end to end: the real model, the real backend, the real page.

- **`cypress/e2e/api.cy.ts`** (6 tests) calls `GET /data` directly. It checks that none of the 16 personal details in `cypress/fixtures/personal-details.json` appear **anywhere** in the response, that every question has its placeholders, that every link points to one of that item's own sources, that citations are numbered from 1 with cited sources first, and that every source has a favicon. *Why:* the task says the real details must "never leave the backend", so hiding them on the page isn't enough. I had to check the API response itself.
- **`cypress/e2e/app.cy.ts`** (9 tests) checks the page as an adviser sees it. I grouped the tests under the three frontend requirements in TASK.md:
  1. *The redacted question.* No personal details anywhere on the page. One `[NAME]` per name. A placeholder for each kind of detail.
  2. *The answer with working citation links.* No raw `<ref>` tags. Each citation's number matches the number of the source it links to, and it opens safely in a new tab. The debt answer's typo'd ref links to the right source. The bold text is kept.
  3. *Every source with its favicon.* All four sources per item, cited ones numbered from [1]. Every favicon has actually loaded (`naturalWidth > 0`), not just been given a URL.

  *Why:* my unit tests prove the pieces work, and these prove they work together in a browser. I check that each image actually loaded on purpose: the blank police.uk favicon would have passed a test that only checked an `<img>` was there.

Cypress is a dev dependency, so the first `npm install` also downloads the Cypress app (a few hundred MB). Set `CYPRESS_INSTALL_BINARY=0` to skip that if you don't need to run the tests.

I added `data-testid` attributes to `Content.tsx` so my tests don't depend on Tailwind classes, which change whenever the design does.

Two things I learned getting Cypress to run:

- **`ELECTRON_RUN_AS_NODE=1` stops Cypress starting.** It fails with `bad option: --no-sandbox`. The terminal session I ran the tests from was started by a VS Code extension, which had set that variable. Running `env -u ELECTRON_RUN_AS_NODE npm run test:e2e` fixed it. A normal terminal shouldn't have the problem.
- **My favicon test failed on its first run.** `next/image` lazy-loads images, so favicons further down the page hadn't loaded yet. That was my test's mistake, not the app's, so I made the test scroll each favicon into view first, as an adviser would.

My results: **12/12 pytest, 15/15 Cypress.** `tsc --noEmit`, `npm run lint` and `npm run build` also pass.

## What I'd do with more time

- Add a unit test for the sanitiser, checking it strips `<script>`, `onclick` and `javascript:` links. My Cypress tests use the real data, which has none of those, so I've reviewed this protection but not tested it.
- Run the pytest and Cypress tests in CI (GitHub Actions) on every push.
- Make the citation links jump to the source in the list as well as opening the page, so the adviser can see the source's title before leaving the app.
- Redact and look up favicons once when the data is saved, instead of on each request with an in-memory cache.
