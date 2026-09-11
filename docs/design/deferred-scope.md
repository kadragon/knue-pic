# Deferred Scope: Monthly Aggregates and the PRD §44 V2 Candidates

Decision record for the two `backlog.md` → Someday items, written 2026-09-11. Neither is built.
This file says why, what would reopen each, and which test holds the line in the meantime.

**Source limits.** The PRD is cited throughout the repo by section number but is not committed, so
§44's own wording and acceptance criteria were not readable for this decision. What was read: the
backlog lines, `docs/architecture.md`, `docs/conventions.md`, `AGENTS.md`, and the committed
dataset. A decision below that turns out to contradict §44 is reopened by §44, not defended.

## 1. Precomputed monthly aggregates — not warranted

Backlog: "Precomputed monthly aggregates in the JSON if `transactions` growth threatens the 3s
load budget."

**Evidence (committed `data/places.json`, `updatedAt` 2026-08-25):** 412,342 bytes, 504 places,
2,584 transactions, pretty-printed with two-space indentation.

**Why not.** The growth the item is conditional on cannot happen at the current disclosure volume:
the file holds a rolling window of `ROLLING_WINDOW_MONTHS` = 15 months, the backfill already filled
it (`RETAINED_MONTHS` = 15), so from here each month added is a month dropped. Aggregates would also
be a second source of truth beside `transactions` — `docs/architecture.md` → Key Abstractions 2
says there are no precomputed per-period fields, and every window in the UI is anchored to
`updatedAt` by day, which a calendar-month aggregate cannot reproduce anyway. Nothing in the repo
measures the 3s budget itself; no evidence says the current file threatens it.

**Cheaper lever first, if it ever does.** The file is indented; serialising it compactly shrinks it
without changing the schema or any consumer. Measure that before any schema change.

**Held by:** `src/data/published-dataset.test.ts` — the committed file carries no key outside the
typed wire format (so an aggregate cannot slip in unreviewed), and it stays under a 1,000,000-byte
review trigger. The trigger is roughly 2.4× today's size, chosen so crossing it means the
disclosures themselves grew; it is a prompt to measure load, not a measured budget.

## 2. V2 candidates — none built now

Backlog: "Distance-from-me search, favourites, heatmap (PRD §44 V2 candidates)." Filed as V2 —
outside the MVP — with no Sprint Contract, and each needs product decisions (new copy, device
state) that are not the implementer's to make. What the repo does fix is the conditions each must
meet, so the eventual contract starts from them.

### Distance-from-me search

- Geolocation API, requested only from an explicit control, never on load.
- The position never leaves the tab: no fetch, no URL parameter, no storage, not logged. Golden
  Principle 1 already forbids anywhere to send it; this also forbids keeping it.
- Distance stays arithmetic in `src/stats/distance.ts` beside `CAMPUS_ORIGIN`, rendered with the
  same lightness ramp, never a green-to-red scale (`docs/conventions.md` → 거리 밴드).
- Denied or unavailable permission falls back to the campus distance the rows already print —
  the same graceful-degradation rule the map follows.

### Favourites

- `localStorage` holding canonical place ids and nothing else. Ids are stable and never reused
  (`docs/architecture.md` → Canonical ID), so a stored id cannot come to name another business.
- An id missing from the current dataset is ignored silently, not shown as an error — the place left
  the rolling window.
- Copy is a personal bookmark (`즐겨찾기`), never an endorsement; the framing-vocabulary test covers
  it like any other string.

### Heatmap

The weakest candidate, recorded as **not to be built in its obvious form**. A density layer of
where staff spent is expense-location mapping — exactly the surveillance framing Golden Principle 4
rules out — and the page-level map it would sit on was removed on purpose (`src/map/place-map.ts`
header). The per-place monthly histogram already answers "when". Reopen only with a framing that
passes `docs/conventions.md` → Framing Vocabulary, stated in the Sprint Contract.

**Held by:** `src/ui/device-state.test.ts` — no shipped source touches geolocation, storage,
cookies, or a service worker. Landing distance-from-me or favourites means adding the file to its
`ALLOWED` map, which is where the conditions above get checked.
