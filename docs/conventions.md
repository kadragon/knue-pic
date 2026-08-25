# Conventions

Only rules a linter does not already own. Formatting, import order, and unused-variable rules
belong to the lint config, not here.

## Framing Vocabulary (product constraint, PRD §45)

This is the rule most easily broken by a well-meaning edit, so it is written down and tested.

| Never write | Write instead |
|---|---|
| 추천 맛집, 교원이 인정한 맛집, 베스트 맛집 | 많이 이용한 곳, 자주 찾은 곳 |
| 업무추진비 추적, 지출 감시, 과다 사용 업체 | 최근 이용이 늘어난 곳, 새로 발견된 곳 |
| 평점, 별점, 순위가 높은 좋은 집 | 이용 횟수, 최근 이용 |

Every screen carries the source line ("데이터 기준: 한국교원대학교 업무추진비 공개자료") and the
PRD §21 disclaimer that usage count is not an endorsement. A banned-phrase unit test over every
shipped source — `src/ui/framing-vocabulary.test.ts` reads each non-test `src/` file plus
`index.html` — is what keeps this from decaying; add the phrase to its `BANNED` list whenever the
table grows.

## Statistics Rules

Getting these subtly wrong produces plausible, wrong numbers — no test catches "wrong but
reasonable", so the rules are stated once here and asserted in `src/stats/` tests.

- Ranking is **by visit count only**. Amount never influences rank.
- Ties break by: visit count → most recent visit date → total amount.
- `averageAmount = totalAmount / visitCount`, rounded to whole won.
- 최근 이용 변화 requires **≥2 visits in the recent month**; a prior-period count of 0
  shows `신규`, not a percentage — never divide by zero into `Infinity`.
- Rank delta is omitted, not zero, when the prior window's data is incomplete.
- 작년 같은 달 is the whole calendar month twelve months before the anchor's month, and it never
  shows a rank delta: the month before it is two years back, which no published file retains.
- Category defaults to `기타` when classification is uncertain — never guess a cuisine.

## Naming

| Element | Pattern | Example |
|---------|---------|---------|
| Place ID | `restaurant_%06d` | `restaurant_000134` |
| Source files | kebab-case | `rank-delta.ts` |
| Functions | camelCase, verb-first | `computeTopPlaces()` |
| Types | PascalCase | `PlaceRecord` |
| Env vars (web) | `VITE_` prefix, SCREAMING_SNAKE | `VITE_NAVER_MAP_CLIENT_ID` |
| Period values | `1m` \| `3m` \| `6m` \| `1y` | — |
| Column bases | a `Period`, or `lastYearMonth` | `StatBasis` |

## Accessibility & Responsive (PRD §36–§37)

- Importance is never conveyed by colour alone: a rank carries a number badge, a movement glyph
  carries an `aria-label`, and the active column tab carries weight and fill as well as colour.
- Layout must hold at 360px width; source order is search → the five discovery columns.
- The five columns — 작년 같은 달 / 최근 이용 변화 / 최근 3개월 / 최근 6개월 / 최근 1년 — are peers:
  same card, same heading tier, same row cap. Making one heavier states something about the data
  that the data does not say. They drop to three columns below 1200px, two below 900px and one
  below 600px, where a tab group (`.place-column-tabs`, hidden above that width so it takes no tab
  stops) switches between them. A column is never split across a reflow: the columns *are* the
  comparison.
- The 작년 같은 달 column names the month it covers (`2025년 8월`), not the relation: every label
  beside it reads 최근 N개월, so an unnamed month leaves the reader unable to check the figure by
  hand — which is the whole claim the page makes about its numbers.
- There is no ranked 최근 1개월 column. 최근 이용 변화 already reads that month, and a ranked list
  beside it stated the same window twice; `1m` survives as a `Period` because trending is computed
  over it and the detail dialog states it as the basis for a place picked from that column.
- The place detail is a modal dialog, not a section: it opens over the list the reader is in,
  traps Tab, closes on Escape or scrim click, and returns focus to the control that opened it.
  It was the last section on the page until a UI review found that selecting anything threw the
  reader three screens down with no way back — see `src/ui/detail-dialog.ts`. It carries the
  selected place's location map: the map exists to answer "where is *this* one?", which is a
  question only ever asked from inside the dialog. The figures render whether or not the map
  script arrives.
- Lists that can grow with the data are capped at a stated number: `COLUMN_LIMIT` for all five
  columns. A ranked column states the rendered count in its heading; the trending column prints
  `remainderLabel`. Search lists nothing until a query or a category is entered.
- The 업종 filter is page-wide: it narrows the five columns and the search results together, and
  the search's own 상세 분류 options are rebuilt from whatever it left. A control that narrowed one list
  while the other kept listing everything reads as a bug in the list it did not touch.
- A display transform applied to a stored value (`displayCategory` folds the dataset's comma into
  the UI's `·`) is also folded inside `filterPlaces`' `normalize`, so a reader can type back exactly
  what the row showed them. A transform that reaches the label but not the matcher returns nothing
  for the 92 places whose category carries a comma.
- Every interactive control has a visible label or an `aria-label`; search is keyboard-operable.

## Git Conventions

Commits: `[TYPE] description` — one logical change, checks green.

| Type | Meaning |
|------|---------|
| `[FEAT]` | New behavior |
| `[FIX]` | Bug fix — requires a reproducing test before the fix |
| `[REFACTOR]` | Structure only, no behavior change |
| `[TEST]` | Test-only change |
| `[CONSTRAINT]` | Structural guards (lint rule, CI check, validator) |
| `[DOCS]` | Documentation only |
| `[HARNESS]` | Skill / hook / agent instruction changes |
| `[DATA]` | Monthly `data/places.json` regeneration and its review CSV |

Branches: `<type>/<slug>` — `feat/top10-list`, `fix/rank-delta-empty-window`, `data/2026-08`.

**Never commit directly to `main`.** Merging to `main` publishes the site, so treat every merge as
a release: the validator must have passed and a human must have previewed the data.
