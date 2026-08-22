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
  stats/              # pure computation: per-period ranking, rank delta, trending,
                      #   monthly histogram, text/category filtering
  map/                # loader.ts (script injection), naver-api.ts (hand-written API types),
                      #   place-map.ts (one marker for the selected place + §38 fallback)
  ui/                 # views, Korean strings
data/places.json      # published dataset (generated — see below); also Vite's publicDir
collector/            # Python; never imported by src/
  validate.py         # the publication gate (PRD §32)
  build_places.py     # approved rows + collected transactions -> data/places.json
  id_map.json         # canonical ID map, committed — it must survive every run
  aliases.json        # spelling merge map, committed — optional, absent means no merges
  out/                # raw_transactions.json, normalized_places.json (intermediate, gitignored)
.claude/skills/knue-expense-collect/
                      # the collection half: download, extract, normalize, classify, geocode.
                      # Steps 1–5 of the data-update cycle live here, not under collector/
review_candidates.csv # manual location approval queue (committed)
.github/workflows/    # validate → build → deploy to Pages
```

## Layer Rules

- `src/stats/` is pure: it takes places + a period and returns numbers. No DOM, no map, no fetch.
  Every statistic in PRD §10–§13, §19, §22–§24 is computed here so it stays unit-testable.
- `src/map/` reads a place record and nothing else; `src/stats/` must never import from `src/map/`
  or `src/ui/`. The map shows the place the detail dialog is about — it carries no ranking, so it
  has no reason to read stats output at all.
- The map script is the app's only third-party runtime input, and it is optional: `loadNaverMaps`
  rejects (never throws) when the client ID is unset or the script is blocked, offline or unusable,
  and `renderPlaceLocationMap` turns that — and any throw from the API while mounting — into the
  PRD §38 fallback message. The dialog mounts the map fire-and-forget after painting the figures,
  so the statistics never wait on it or fail with it. An origin missing from the key's allowed-URL
  list takes a second route: the v3 script serves its full bundle regardless, so the load succeeds,
  a map mounts, and the API signals the rejection afterwards through a `window.navermap_authFailure`
  global. `renderPlaceLocationMap` registers that hook after mounting and swaps the map for the same
  fallback, which is why the two degraded states are indistinguishable on screen.
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
JSON object, or a file carrying `NaN`/`Infinity` — Python's parser accepts those, RFC 8259 and the
browser's `Response.json()` do not). Both stop publication — a future CI step needs to tell the two
apart, nothing else does.

It also runs a tenth, `loader-parity` check, because the nine are not sufficient on their own:
`parsePlace` in `src/data/load.ts` rejects the *whole file* when `category` is empty, and when
`naverUrl` is anything other than an https URL on `naver.com`, one of its subdomains, or `naver.me`
— it is the only dataset string the page puts in an `href`, so the loader checks it rather than
leaving the scheme to the render site alone. A dataset passing only the nine could therefore still
leave every visitor on the load-error screen. A gate weaker than the loader it guards is not a
gate. On `naverUrl` the validator is deliberately *stricter*: it holds the host to plain ASCII
labels and rejects punycode outright, because no Python parser reproduces the browser's IDNA and
mirroring it approximately is what lets a divergence through. Stricter only ever stops publication,
which the operator sees; looser reaches a visitor.

An eleventh, `unique-name`, guards the same boundary from the other side: check 1 makes each `id`
unique, which one business published twice — under the composed and the decomposed spelling of its
name, or verbatim — satisfies with two ids for one restaurant. `build_places.py` refuses to emit
that (it keys every join on NFC), so the only remaining path to it is a hand edit of the generated
`data/places.json`, and this gate is the last thing between that edit and publication.

Two of the nine need a concrete value the invariant list does not carry:

- **In range** means the Korea bounding box — `lat` 33.0–39.0, `lng` 124.0–132.0 — not the global
  ±90/±180 that `src/data/load.ts` accepts. The loader is a wire-format parser and would wave a
  geocoding mis-hit in Tokyo straight through; the validator is the quality gate, so it uses the
  bounds that make `region_ok` in `review_candidates.csv` mean something. The constants live at the
  top of `collector/validate.py`.
- **The rolling window** is floored on the *calendar month*, not on `updatedAt`'s day: the oldest
  accepted date is the first day of the month 11 months before `updatedAt`'s own month. That is the
  span `src/stats/histogram.ts` renders and it sits inside the half-open window
  `src/stats/period.ts` -> `isWithinWindow` applies. A day-anchored floor would admit transactions
  that every 1y view then ignores, so the histogram bars would sum to fewer visits than the count
  printed beside them, with nothing reporting the gap.
- **Review status** is joined on the canonical ID, in two hops: the place's `id` names a
  `collector/id_map.json` entry (read in reverse, id → `canonical_name`), and that name names the
  `review_candidates.csv` row whose `status` decides it. `display_name` is display text and is not
  a join key — a business that changes its sign keeps the approval a human gave it, and renaming a
  rejected row cannot hand it an approval that belongs to another place. The join fails closed in
  four directions: an `id` in no map entry, a canonical name with no row in the queue (an
  unapproved place is exactly what Golden Principle 2 forbids), a matched row that is not
  `approved`, and a canonical name on two rows, which is reported as ambiguous rather than
  resolved. Both files are hand-edited and both sides are keyed in NFC (`normalize_name`): a macOS
  paste carries the decomposed spelling of a Korean name, code-point-unequal to Naver's composed
  one and the same business. A name approved in both forms is therefore one *ambiguous* key rather
  than two rows, and `build_places.py` normalizes the same way, so the build cannot file a place
  under a key the gate then fails to find. A missing, unreadable or self-contradicting `id_map.json`
  (one `id` reached from two canonical names) is exit 2 — the validator could not run — never a
  pass; `--id-map` defaults to `collector/id_map.json`, so the CI invocation carries no flag.

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
ID; a different branch of the same brand is a different place with a different ID. The ID map is
`collector/id_map.json`, keyed on the normalizer's canonical name in NFC and **committed** — it
survives across runs because losing it silently resets every rank history. Keys are normalized on
read, so a hand-edited decomposed entry still names its place instead of handing it a second ID,
and two keys that normalize to one stop the build. `build_places.py` only ever
appends to it, and mints the next number from the highest ever assigned rather than from the entry
count, so an entry deleted by hand cannot hand its number to a different business.
A spelling merged away by `collector/aliases.json` publishes no place, so it is minted no ID; an ID
already minted for one before the merge stays in the map, unused and unreusable.

**Build.** `collector/build_places.py` (`python -m collector.build_places`) is step 7 of the
`data-update` cycle — the only thing that writes `data/places.json`. It joins `review_candidates.csv`
rows with `status=approved` against the transactions in `collector/out/<month>/`, via the raw venue
spellings the normalizer merged, and imports `window_floor` from `validate.py` so the build and the
gate cannot disagree about the window. Three fields are derived rather than copied:

- `category` is the first segment of the CSV's Naver taxonomy path (`한식>육류,고기요리` → `한식`),
  falling back to `기타` — the loader rejects the whole file on an empty category.
- `address` prefers `road_address`, falling back to the parcel `address`.
- `naverUrl` is a `https://map.naver.com/p/search/…` link on the place name. The collector never
  learns Naver's internal place ID, so composing one would be a fabrication; a search link is a
  claim the data supports, and the host satisfies both `requireNaverUrl` and check 10.

**Spelling merges.** The disclosures spell one business several ways, and stage 3 merges only exact
normalised matches (see *Key Abstractions* below), so `신토불이교원대점` and `신토불이` arrive as two
approved rows and would publish as two places splitting one business's visits between them.
`collector/aliases.json` — `{alias canonical_name: representative canonical_name}`, NFC on both
sides, committed — is where the reviewer says they are one business; nothing merges that is not
written there, and an absent file means no merges. An aliased row publishes no place and is minted
no ID, and `collect_transactions` resolves the alias *before* testing approval, so the merged
spelling's visits land on the representative instead of being dropped as unapproved. The build fails
closed on a self-alias, on a chain (a target that is itself a key — resolving it would depend on
dict order), and on a target no approved row carries, which would silently discard every visit of
the merged spelling.

It fails closed with exit 2 — writing nothing — on a `canonical_name` or a `display_name` that
appears on more than one row **whatever the other row's status** (check 9 and check 11 count rows,
not approvals, so the build counts them the same way or it mints a permanent ID for a place the
gate then refuses), an approved row with no `display_name` or no address, coordinates that are
unparseable or non-finite, an `--out-dir` holding no month data at all, and a run where approved
rows *and* month data were both present yet no place survived. The last three are the ones worth
knowing about: `float("nan")` does not raise, so a bare parse would emit JSON no browser accepts,
and an empty `places` array passes the validator — it has no minimum-place check — so a gitignored
`collector/out/` on a fresh clone, or an upstream date-format change that drops every transaction,
would otherwise overwrite the dataset with `places: []`, exit 0, and publish an empty map with a
green gate. Zero approved rows is *not* one of these: an empty queue correctly builds an empty
dataset. A place with
no transaction inside the window is omitted rather than published empty; a transaction belonging to
an approved place that is dropped for a bad date or amount is counted and warned about on stderr,
because visits are the ranking signal and a silently absorbed one moves a place with nothing
saying so.

## Key Abstractions

1. **Transaction = visit.** One disclosed payment is one visit (PRD §22). Multiple payments in a
   single sitting are not merged.
2. **Period recomputation.** Every window is derived from `transactions` client-side, at render
   time. There are no precomputed per-period fields in the JSON. The page shows four windows at
   once — 최근 뜨는 곳 (fixed at the recent month) plus 1m / 6m / 1y — so `src/ui/place-columns.ts`
   runs one aggregation per column on load and none after: nothing on the page switches a window
   any more, and a place selected from a column is shown that column's figures.
3. **Rank comparison window.** The prior period is the immediately preceding window of the same
   length. When that window's data is incomplete, the rank delta is omitted — never guessed.
4. **Approval queue.** `review_candidates.csv` is the human gate between geocoding and publication;
   only `approved` rows reach `places.json`.
