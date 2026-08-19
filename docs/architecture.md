# Architecture

Source of truth for the boundaries that the directory tree does not show. The repo is currently
empty apart from the harness — everything below is the agreed target shape, and the first
implementation commits must match it or update this doc in the same change.

## Stack

| Layer | Technology |
|-------|-----------|
| Web app | TypeScript + Vite, static SPA (no framework mandated; add one only with a stated reason) |
| Map | Naver Maps JavaScript API (browser Client ID) |
| Data store | `data/places.json`, a committed static file — no DB, no server |
| Collector | Python, run locally by the operator once a month |
| Hosting | GitHub Pages, repo `kadragon/knue-pic`, published from `main` via GitHub Actions |
| CI | GitHub Actions: validate → build → deploy |

**No Backend. No Database. Static First.** This is a product constraint, not a current limitation —
see `AGENTS.md` → Golden Principles 1.

## Two Halves, One Repo

```
public disclosures ──▶ collector (Python, local only) ──▶ data/places.json ──▶ web app (browser)
                       secrets live here                  the only interface   no secrets here
```

The two halves share **nothing but `data/places.json`**. The collector never runs in CI or in the
browser; the web app never learns where the data came from. Any change that couples them (a shared
config the web app imports, a build step that calls the collector) breaks the constraint.

## Source Layout (target)

```
index.html
src/                  # web app; browser-only code
  data/               # places.json loading + schema types
  stats/              # pure computation: top-10, rank delta, trending, newly seen,
                      #   monthly histogram, text/category filtering
  map/                # loader.ts (script injection), naver-api.ts (hand-written API types),
                      #   place-map.ts (markers + TOP 10 badges + §38 fallback);
                      #   bounds re-search still to come
  ui/                 # views, Korean strings
data/places.json      # published dataset (generated — see below); also Vite's publicDir
collector/            # Python collector skill; never imported by src/
  out/                # raw_transactions.json, normalized_places.json (intermediate, gitignored)
review_candidates.csv # manual location approval queue (committed)
.github/workflows/    # validate → build → deploy to Pages
```

## Layer Rules

- `src/stats/` is pure: it takes places + a period and returns numbers. No DOM, no map, no fetch.
  Every statistic in PRD §10–§13, §19, §22–§24 is computed here so it stays unit-testable.
- `src/map/` may read stats output; `src/stats/` must never import from `src/map/` or `src/ui/`.
- The map script is the app's only third-party runtime input, and it is optional: `loadNaverMaps`
  rejects (never throws) when the client ID is unset or the script is blocked, offline or unusable,
  and `renderPlaceMap` turns that — and any throw from the API while mounting — into the PRD §38
  fallback message. `bootstrap` renders the map fire-and-forget, so no other view waits on it or
  fails with it. An origin missing from the key's allowed-URL list takes a second route: the v3
  script serves its full bundle regardless, so the load succeeds, a map mounts, and the API signals
  the rejection afterwards through a `window.navermap_authFailure` global. `renderPlaceMap`
  registers that hook after mounting and swaps the map for the same fallback, which is why the two
  degraded states are indistinguishable on screen.
- `src/data/` is the only module that knows the `places.json` wire format. Everything else uses its
  exported types.
- `collector/` is never imported by `src/`, and `src/` is never imported by `collector/`.

## Data Contract

`data/places.json` is the entire API of this product. Shape per PRD §29:

```json
{ "updatedAt": "2026-08-01",
  "places": [ { "id": "restaurant_000134", "name": "...", "category": "한식",
                "address": "...", "lat": 36.6, "lng": 127.3, "naverUrl": "...",
                "transactions": [ { "date": "2026-07-18", "amount": 230000 } ] } ] }
```

Invariants the validator enforces before any deploy (PRD §32): unique `id`; `lat`/`lng` present and
in range; `amount >= 0`; ISO `date`; dates within the rolling window; non-empty `name` and
`address`; no place whose review status is anything other than `approved`.

`collector/validate.py` implements those nine as numbered checks and reports **every** violation in
one pass, so the operator fixes the month's data once instead of re-running per defect. Exit 1 means
the data is bad; exit 2 means the validator could not run (missing file, unreadable CSV, root not a
JSON object). Both stop publication — a future CI step needs to tell the two apart, nothing else
does. Two of the nine need a concrete value the invariant list does not carry:

- **In range** means the Korea bounding box — `lat` 33.0–39.0, `lng` 124.0–132.0 — not the global
  ±90/±180 that `src/data/load.ts` accepts. The loader is a wire-format parser and would wave a
  geocoding mis-hit in Tokyo straight through; the validator is the quality gate, so it uses the
  bounds that make `region_ok` in `review_candidates.csv` mean something. The constants live at the
  top of `collector/validate.py`.
- **Review status** is joined on the place `name` against the CSV's `display_name`, because
  `review_candidates.csv` has no `id` column and the canonical ID map is not built yet. The join
  fails closed in three directions: a matched row that is not `approved`, *no* matched row at all
  (an unapproved place is exactly what Golden Principle 2 forbids), and a `display_name` on two
  rows, which is reported as ambiguous rather than resolved. This is a stopgap — see `backlog.md`
  for the follow-up that moves the join onto the canonical ID.

**Serving.** `data/` is Vite's `publicDir` (`vite.config.ts`), so the file is copied verbatim into
`dist/` and the browser fetches it at `${BASE_URL}places.json` — `/knue-pic/places.json` in
production. The repo path stays `data/places.json`; only the URL drops the directory. Any other
static asset the site needs (favicon, `robots.txt`) therefore also belongs in `data/` — and the
converse is the constraint that matters: **everything in `data/` is published verbatim, unreviewed**.
A collector intermediate, a backup, or a CSV dropped there ships to the public site, which is how
the "unapproved places never publish" invariant would be lost without a single bad row ever entering
`places.json`. Collector intermediates belong in `collector/out/` (gitignored); `data/` holds the
published dataset and nothing else.
`src/data/load.ts` is the only module that fetches it, and it rejects the whole file rather than
dropping a row: `src/stats/` throws on a malformed transaction date, so validation has to happen
before places reach it.

**Rolling window.** The published file keeps the most recent 12 months. The collector may retain up
to 13 months internally so that the 12-month trend and the previous-period rank comparison have a
complete prior period to compare against.

**Canonical ID.** `restaurant_%06d`, assigned once and never reused. A renamed business keeps its
ID; a different branch of the same brand is a different place with a different ID. The ID map
survives across runs — losing it silently resets every rank history.

## Key Abstractions

1. **Transaction = visit.** One disclosed payment is one visit (PRD §22). Multiple payments in a
   single sitting are not merged.
2. **Period recomputation.** Changing the 1m/6m/1y selector re-derives *everything* from
   `transactions` client-side. There are no precomputed per-period fields in the JSON.
3. **Rank comparison window.** The prior period is the immediately preceding window of the same
   length. When that window's data is incomplete, the rank delta is omitted — never guessed.
4. **Approval queue.** `review_candidates.csv` is the human gate between geocoding and publication;
   only `approved` rows reach `places.json`.
