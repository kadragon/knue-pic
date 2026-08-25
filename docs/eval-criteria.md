# Evaluation Criteria

How a finished feature is graded. This repo has no separate evaluator agent, so the written
criteria are what keep a self-grade honest: list evidence per item first, assign the score second.

## Criteria

### 1. Data Correctness (weight: 40%)

Do the displayed numbers follow from `data/places.json`?

| Score | Description |
|-------|-------------|
| 5 | Every statistic reproducible by hand from the JSON for a sampled place, across all three periods |
| 4 | Correct, with one cosmetic formatting deviation (rounding display, thousands separator) |
| 3 | Correct on the default 1-year period; an edge case (empty prior window, single transaction) untested |
| 2 | A statistic is wrong, or a divide-by-zero surfaces as `Infinity`/`NaN` |
| 1 | Ranking uses amount, or unapproved/unlocated places appear |

**How to test:** pick one place, compute visit count, total, average, most recent visit, and the
monthly histogram by hand from the JSON; compare against the UI for 3m, 6m, 1y, and the 작년 같은
달 column (the whole calendar month twelve months before `updatedAt`'s own month). The chart is
twelve bars everywhere except a card opened from that column, which draws thirteen so the month
its figures name is the oldest bar (`src/stats/histogram.ts` -> `histogramMonthsFor`). 1m has no ranked
column of its own — check it through the detail card opened from 최근 이용 변화.

### 2. Framing Compliance (weight: 20%)

Does the UI stay a discovery tool rather than a ranking or an audit?

| Score | Description |
|-------|-------------|
| 5 | No banned phrase anywhere; source line and PRD §21 disclaimer visible; the banned-phrase test covers the new strings |
| 3 | Compliant strings, but the new module is not covered by the test |
| 1 | Any recommendation or surveillance framing ships |

**How to test:** run the banned-phrase test; read every new user-facing string against
`docs/conventions.md` → Framing Vocabulary.

### 3. Graceful Degradation & Responsiveness (weight: 20%)

| Score | Description |
|-------|-------------|
| 5 | Works at 360px; with the map script blocked the list, search, and detail still work with the PRD §38 message; empty results show the reset control |
| 3 | Works at 360px, but a failure path shows a raw error or an empty screen |
| 1 | Map failure breaks the page, or the layout breaks below 400px |

**How to test:** devtools at 360px; block the Naver script; search a term with no matches.

### 4. Static-First Integrity (weight: 20%)

| Score | Description |
|-------|-------------|
| 5 | No new runtime dependency beyond `places.json` + the map API; no secret in `src/`; the build still deploys from a plain `dist/` |
| 3 | Compliant, but a new build-time input was added without documenting it in `docs/architecture.md` |
| 1 | A server call, a database, or a secret key entered the web app |

**How to test:** grep `src/` for network calls and key-shaped strings; confirm `npm run preview`
serves the feature with no process other than a static file server.

## Pass Threshold

All criteria ≥3 **and** weighted average ≥3.5. A failed Sprint Contract item fails the feature
outright — strength elsewhere does not average it away.

## Sprint Contract

Written into `tasks.md` before implementation, deleted at sprint close.

```markdown
### Sprint Contract: {Feature}

- Commit tag: {[FEAT] | [FIX] | ...}
- I will build: {specific scope}
- Success looks like: {concrete, testable criteria}
- Out of scope: {explicit exclusions}

**Agreed contract:**
- [ ] {Criterion 1 — specific and testable}
- [ ] {Criterion 2}
```

A `[FIX]` contract must include a criterion naming the test that fails before the fix and passes
after (`docs/conventions.md` → Git Conventions).

## Grading Discipline

The common failure is finding a defect and then talking yourself out of it ("the trend chart is off
by one month, but overall it's solid — 4"). Countermeasures:

1. List pass/fail evidence per contract item **before** scoring anything.
2. Grade each criterion on its own; a strong criterion never lifts a weak one.
3. Any failed contract item = feature fails, regardless of the average.
