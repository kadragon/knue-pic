---
name: knue-expense-collect
description: Collect one month of KNUE 업무추진비 (business expense) disclosures from the university's 청렴정보 board, extract every venue visit, and append new venues to review_candidates.csv as pending. Use this whenever the user names a month and wants the dataset refreshed — "2026년 7월 업무추진비 수집", "지난달 데이터 갱신", "places.json 업데이트 준비", "collector 돌려줘", "새 달 데이터 넣어줘" — and also when they ask what venues appeared in a given month, why a place is missing from the map, or how many visits a restaurant got. Reach for it even when they only say "데이터 업데이트" without naming the board, since this is the only data source the product has.
---

# KNUE 업무추진비 collection

Turn one month of the university's published expense disclosures into pending rows in
`review_candidates.csv`. This is steps 1–5 of `docs/workflows.md` → `data-update`.

**Where this stops.** The skill produces *candidates*, never published data. Step 6 (a human sets
each row to `approved` / `rejected`) and the `places.json` build are deliberately outside it —
`AGENTS.md` Golden Principle 2 makes the review queue the gate, and a gate an agent can walk
through is not a gate.

## Run it

Work on a branch (`git checkout -b data/YYYY-MM`), never on `main`.

```bash
SKILL=.claude/skills/knue-expense-collect/scripts

python3 $SKILL/geocode_candidates.py --selftest              # 0. credentials + coordinate scale
python3 $SKILL/fetch_disclosures.py  --month 2026-07         # 1. posts + attachments
python3 $SKILL/parse_disclosures.py  --month 2026-07         # 2. transaction rows
python3 $SKILL/normalize_places.py   --month 2026-07         # 3. merge spellings
python3 $SKILL/geocode_candidates.py --month 2026-07         # 4. append to the review queue
python3 $SKILL/geocode_candidates.py --report                # +  propose alias merges
```

Intermediate output lands in `collector/out/<month>/` (gitignored). Only
`review_candidates.csv` is committed.

Re-running a month is safe. A venue already in the queue keeps its `status`, its notes, and any
column a reviewer added by hand; only its visit count and month list grow. The file is written
via a temp file and renamed, so an interrupted run cannot leave the queue truncated.

Stage 4 needs `NAVER_SEARCH_CLIENT_ID` and `NAVER_SEARCH_CLIENT_SECRET` in the environment —
검색 API keys, not the Maps browser Client ID the web app uses.

Naver has moved the 검색 API from the old NAVER Developers console to **NAVER API HUB** on NAVER
Cloud Platform, and the two gateways do not share credentials:

| | NAVER API HUB (current) | NAVER Developers (legacy) |
|---|---|---|
| Register | `console.ncloud.com` → NAVER API HUB | `developers.naver.com` |
| Host | `naverapihub.apigw.ntruss.com/search/v1/local` | `openapi.naver.com/v1/search/local.json` |
| Headers | `X-NCP-APIGW-API-KEY-ID` / `X-NCP-APIGW-API-KEY` | `X-Naver-Client-Id` / `X-Naver-Client-Secret` |

The script tries API HUB first and falls back to the legacy gateway, so the same two environment
variables work either way — `--selftest` prints which backend answered. Both paths cap at
25,000 calls a day with `display` ≤ 5, far above a month of ~90 venues, and `mapx`/`mapy` are
documented as WGS84.
These are the collector's server credentials: they must never appear in `src/`, in a committed
file, or in an Actions secret used by the web build. Run `--selftest` first — it confirms the key
works *and* that the API's `mapx`/`mapy` convention still maps onto the campus, which is the one
thing a wrong assumption would corrupt silently.

## Read the output, don't just run the commands

Each stage prints what it *didn't* do. That output is the deliverable as much as the files are —
a sheet that yields zero rows looks identical to a sheet that doesn't exist unless someone reads
the log. After each run, check and report:

- **Stage 1** — how many posts, which were `superseded` (a re-post is a correction; the highest
  `nttNo` per department wins) and which departments were skipped.
- **Stage 2** — every `no rows for target month` line. Old-month sheets bundled in the same file
  are expected; a *current* department reporting zero is not, and means the layout changed.
- **Stage 3** — the multi-venue rows it dropped. Each one is a real visit the dataset loses.
  If a month has many, raise it rather than absorbing it.
- **Stage 4** — the `no geocoding hit`, `outside 청주/세종/공주/대전`, and `non-food category`
  counts. These are not failures; they are the reviewer's worklist.

Then summarise for the user in Korean: how many transactions, how many new venues queued, and
what needs their judgement. Do not report success while a stage's skip list is unexplained.

## Judgement the scripts deliberately leave to you

The scripts do the mechanical work and stop where the data stops being conclusive.

**Never set `status` yourself.** Every row is written `pending`. Filling in `approved` is the
human's step, and the value of the queue is that an agent didn't decide it.

**Non-food venues.** Stage 4 flags `category_ok=no` from the geocoder's own taxonomy rather than
guessing from names — a name-substring rule once excluded `우공뭉티기(수서점)` because "수서점"
contains "서점". If a venue is obviously a supplier or a shop and wastes a lookup every month
(`금관유통`, `이마트청주점`), add it to `assets/exclusions.json` → `excludeExact` so next month is
cheaper. Add substring keywords only when the word cannot occur inside a shop or branch name.

**Same shop, different spelling.** Stage 3 merges only exact normalised matches, so
`본도시락` and `본도시락 오송점` stay separate on purpose: `docs/architecture.md` treats a branch as
its own place, and nothing in the data proves the bare name means that branch. If you believe two
rows are one place, say so in the summary and let the reviewer merge — don't pre-merge them. The
reviewer merges in `collector/aliases.json`, not by editing the queue: the canonical name is what
the transactions join on, so deleting a row drops its visits instead of merging them.

`--report` finds the candidates instead of making you look: it groups the **approved** rows on
identical `lat`/`lng` and prints every group holding more than one spelling, loudest by visits
first. Clusters whose spellings are already in `aliases.json` collapse to a trailing count, so what
prints is the month's new work. It reads the committed queue only — no month, no credentials, no
network — and it never writes: merging stays the reviewer's call, because one coordinate really can
hold two businesses.

**Out-of-region venues.** Business trips produce Seoul and Gangneung entries. They are flagged,
not deleted, because the flag is based on a geocoder guess. The agreed scope is 청주 · 세종 ·
공주 · 대전 (증평 is a separate 충북 county and is *not* 청주).

## What the source actually looks like

Measured against 2026-07 — 19 posts, 20 attachments, 155 transactions, 94 distinct venues, and
89 geocoded into 68 clean in-region food venues plus 21 needing judgement — so that a future run
can tell "the site changed" apart from "my code is wrong". Stage 4 took about 40 seconds.

- Board: `selectBbsNttList.do?bbsNo=18&key=786`, ~191 pages, no auth. Detail links from page 2 on
  carry a trailing `&pageIndex=N`, so a regex anchored on the closing quote silently drops them.
- Roughly 20 departments publish per month, each as its own post, over several weeks. A month is
  not complete until well into the following month.
- Attachments are `.xlsx`, `.xls`, and `.pdf`. The canonical columns are
  `연번 | 사용일자 | 사용내역 | 참석대상 | 금액 | 사용처 | 집행방법`, but the header row sits
  anywhere from row 2 to row 8 and three departments rename columns.
- **`소재지` is published by one department out of twenty.** Addresses effectively do not exist,
  which is why geocoding runs on the shop name and why its result must be reviewed.
- Files bundle unrelated sheets (`상품권 구매 내역`, `수의계약`) and past months — one file carries
  twelve sheets from 2023–24. The target month is decided by the **date cells**, never the sheet
  name or the post title: 2026-07's 교육연구원 post is titled "2025년 7월".
- Dates appear in twelve-plus spellings including Excel serials (`46212`), `20260701` as a number,
  and `7.13.` with no year. A blank 사용일자 under a filled row is a merged cell, and stage 2
  carries the previous date forward — dropping those rows loses real visits.
- 비서실 (총장 업무추진비) publishes no `사용처` column at all, so no place can be derived from it.
  Stage 1 skips it by name and says so.

## When something breaks

| Symptom | Likely cause | What to do |
|---|---|---|
| Stage 1 finds 0 posts | Month not published yet, or the board markup changed | Check the board in a browser; widen `--max-pages` |
| A department yields 0 rows | Its header row moved or a column was renamed | Add the new spelling to the synonym tuples at the top of `parse_disclosures.py` |
| `unsupported spreadsheet` | A new attachment type (e.g. `.hwp`) | Report it; do not hand-transcribe silently |
| openpyxl `IndexError` on load | A department's export has broken styles | Already handled via `read_only=True`; if it recurs elsewhere, keep that flag |
| `--selftest` says coordinates are wrong | The API's `mapx`/`mapy` convention changed | Fix `to_degrees()` before running stage 4 — a silent scale error puts every marker in the sea |

## Files

```
scripts/knue_board.py          board URLs, HTML row parsing, title month parsing
scripts/fetch_disclosures.py   stage 1 — posts + attachments -> posts.json
scripts/parse_disclosures.py   stage 2 — spreadsheets/PDF -> raw_transactions.json
scripts/normalize_places.py    stage 3 — spelling merge -> normalized_places.json
scripts/geocode_candidates.py  stage 4 — Naver local search -> review_candidates.csv
                               --report — same-coordinate spelling clusters to merge
assets/exclusions.json         venue names not worth a lookup; grows as you learn
```
