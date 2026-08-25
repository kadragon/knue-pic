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
- Rank delta is omitted, not zero, when the prior window's data is incomplete. In practice 최근 1년
  is the one window whose prior period is never retained, so its rows carry no movement glyph.
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
| List basis | a `Period` — the selector *is* the four periods | `Period` |

## Accessibility & Responsive (PRD §36–§37)

- Importance is never conveyed by colour alone: a rank carries a number badge, a movement glyph
  carries an `aria-label`, a row's trend chart carries the whole series in its `aria-label`, and
  the pressed period tab carries weight and fill as well as colour.
- The 업종 palette is the one place colour carries meaning. Each of the four kinds owns a
  `--kind-*-bg`/`--kind-*-fg` pair in `src/styles.css`, and the same pair colours the filter chip
  and every badge on a place of that kind. Two rules hold it honest: the badge always spells the
  place's Naver category out as text, so colour is never the only carrier; and each `-fg` clears
  4.5:1 both on its own `-bg` and on white, so it is legible as badge text, as chip text and as
  white-on-fill when the chip is pressed. A view never picks a colour — it stamps `data-kind` and
  the stylesheet decides (`src/ui/place-labels.ts` → `renderKindBadge`).
- Layout must hold at 360px width; source order is search → the ranked list.
- One ranked list at a time, over the window the reader selected. The four windows — 최근 1개월 /
  3개월 / 6개월 / 1년 — are peers in the selector (`.period-tabs`, on screen at every width): same
  pill, same heading tier, same page size once chosen. Making one heavier states something about
  the data that the data does not say. The page opens on `DEFAULT_PERIOD`; pressing a tab rebuilds
  the list below it and never the selector, so the button the reader pressed keeps focus.
  Comparison across time lives inside the row instead of across columns — the rank-movement glyph,
  and a twelve-bar monthly trend chart whose series is spelled out in its `aria-label`.
- The place detail is a modal dialog, not a section: it opens over the list the reader is in,
  traps Tab, closes on Escape or scrim click, and returns focus to the control that opened it.
  It was the last section on the page until a UI review found that selecting anything threw the
  reader three screens down with no way back — see `src/ui/detail-dialog.ts`. It carries the
  selected place's location map: the map exists to answer "where is *this* one?", which is a
  question only ever asked from inside the dialog. The figures render whether or not the map
  script arrives.
- The list opens on `LIST_PAGE_SIZE` rows and grows by that many at a time, never truncating:
  the counter under the list states both halves (`47곳 중 10곳 표시`, then `47곳 모두 표시`), so
  what is held back is on screen as a number. The heading names the window only — a count there
  would be stale the moment the list grew. Paging is driven by an `IntersectionObserver` on the
  `더 보기` button, and that button is a real control rather than an empty sentinel: a reader who
  cannot generate a scroll must still be able to reach the rest. Search lists nothing until a query
  or a category is entered.
- The 업종 filter is page-wide: it narrows the ranked list and the search results together, and
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
