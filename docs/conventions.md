# Conventions

Only rules a linter does not already own. Formatting, import order, and unused-variable rules
belong to the lint config, not here.

## Framing Vocabulary (product constraint, PRD §45)

This is the rule most easily broken by a well-meaning edit, so it is written down and tested.

| Never write | Write instead |
|---|---|
| 추천 맛집, 교원이 인정한 맛집, 베스트 맛집 | 많이 이용한 곳, 자주 찾은 곳 |
| 업무추진비 추적, 지출 감시, 과다 사용 업체 | 최근 이용이 늘어난 곳, 새로 발견된 곳 |
| 평점, 별점, 순위가 높은 좋은 집 | 이용횟수, 최근 이용 |

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
- Trending (요즘 많이 가는 곳) requires **≥2 visits in the recent month**; a prior-period count of 0
  shows `NEW`, not a percentage — never divide by zero into `Infinity`.
- Newly seen (새로 발견된 곳) = first visit within the last 2 months, judged over the full retained
  window, not the selected period.
- Rank delta is omitted, not zero, when the prior window's data is incomplete.
- Category defaults to `기타` when classification is uncertain — never guess a cuisine.

## Naming

| Element | Pattern | Example |
|---------|---------|---------|
| Place ID | `restaurant_%06d` | `restaurant_000134` |
| Source files | kebab-case | `rank-delta.ts` |
| Functions | camelCase, verb-first | `computeTopPlaces()` |
| Types | PascalCase | `PlaceRecord` |
| Env vars (web) | `VITE_` prefix, SCREAMING_SNAKE | `VITE_NAVER_MAP_CLIENT_ID` |
| Period values | `1m` \| `6m` \| `1y` | — |

## Accessibility & Responsive (PRD §36–§37)

- Marker importance is never conveyed by colour alone — TOP 10 carry a number badge.
- Layout must hold at 360px width; source order is TOP 10 → search → map → discovery.
- The place detail is a modal dialog, not a section: it opens over the list the reader is in,
  traps Tab, closes on Escape or scrim click, and returns focus to the control that opened it.
  It was the last section on the page until a UI review found that selecting anything threw the
  reader three screens down with no way back — see `src/ui/detail-dialog.ts`.
- Lists that can grow with the data are capped at a stated number: `TOP_PLACES_LIMIT` for the
  ranked list, `DISCOVERY_LIMIT` for both discovery sections, which print `remainderLabel` when
  they hold rows back. Search lists nothing until a query or a category is entered.
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
