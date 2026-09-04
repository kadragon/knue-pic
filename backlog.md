# Backlog

## Review Backlog

### PR #53 — the one selector split left on a live input (2026-09-04)

- [ ] [debt] `meaningCarryingPalettes`'s inner `elements()` still calls `selector.split(',')`
  directly. It is the last naive split in the suite and the only one whose input is *live*:
  `RULES`, parsed from `src/styles.css`, rather than a hand-written literal. A palette selector
  holding a comma inside `:is(…)` or an attribute value — `.top-place-distance:is(.a, .b) { color:
  … }` — splits into the keys `.top-place-distance:is(.a` and `.b)`, neither matching the
  `.top-place-distance` key, so that rule's `text` role is dropped and `meaningCarryingPalettes()`
  can lose `band` — which is what the `toEqual(['band', 'kind'])` guard and the `CLAIMS` counts
  rest on. Latent today (no such selector in the sheet). Route it through `selectorParts` and add
  a mutation probe (source: PR #53 review, `code-review` and Codex independently) —
  `src/ui/stylesheet-claims.test.ts`

### PR #53 — the escape the matcher does not honour (2026-09-04)

- [ ] [debt] `reaches` now splits with escape awareness but still *matches* with
  the pattern `\.<name>(?![\w-])`, which matches the `\.` of an escaped literal
  dot: `reaches('.badge', '.a\\.badge')` is `true` though that selector styles a single
  class named `a.badge` and never touches `.badge`. Same family as the `.a\,b` split PR #53
  fixed, opposite direction — a false red in an override guard rather than a false negative.
  Latent (no escaped selector in `src/styles.css`) (source: PR #53 review, `code-review`) —
  `src/ui/stylesheet-claims.test.ts`

### Map auth-failure hook (follow-up, 2026-08-19)

- [ ] [debt] The auth-failure hook is registered after the map mounts, which assumes the v3 API calls `navermap_authFailure` post-construction rather than during script init. No vendor doc or captured trace establishes that ordering in either direction — verify against a deliberately rejected origin in a real browser, and move the registration only if the check shows the hook firing earlier (source: contest round on PR #7, unverifiable-from-repo) — `src/map/place-map.ts` *(deferred: needs a real browser on an origin the Naver key rejects)*

### `fetch_disclosures.py` walk — sanctioned gaps left by the positional stop (2026-08-25)

- [ ] [debt] Three limits QA reproduced on PR #23 and the contract sanctioned, none of them
  data-corrupting but all undocumented. (a) A target-month cluster sitting below two legitimately
  older pages — a late-publishing department — is missed and the run still exits 0, because
  `PAGES_PAST_TARGET` is 2 and the year guard sees the first cluster's correct stamp. (b) The
  repeat-page guard compares only the immediately preceding page, so a board clamping an
  out-of-range `pageIndex` to a *cycle* rather than its last page still walks to `--max-pages`.
  (c) A month older than everything the board carries, or a board whose 업무추진비 titles are all
  undated, never arms the stop and costs the full 200-page cap on both traversals. (a) is the only
  one that can lose data; consider documenting it in SKILL.md rather than widening the rule
  — `.claude/skills/knue-expense-collect/scripts/fetch_disclosures.py`,
  `.claude/skills/knue-expense-collect/SKILL.md`

### UI label pass — review findings left out of PR #24 (2026-08-25)

- [x] [debt] `·` now separates both the fields of a metadata line (`' · '`) and the parts inside one
  category (`displayCategory`), so a card reads `카페·디저트 · 청주시…`. Only the spaces distinguish
  the two roles. Pick a different field separator, or render the category as its own element
  — `src/ui/place-labels.ts`, `src/ui/top-places.ts`, `src/ui/place-detail.ts`, `src/ui/search.ts`
  *(done: the category is its own element now — the 업종 badge — so the two roles no longer share a
  separator)*

### Naver taxonomy is truncated to one segment before it reaches the browser (2026-08-25)

- [ ] [feat] `places.json` carries `category` as the *first* segment of Naver's taxonomy path, and
  the roots are inconsistent — the same kind of restaurant arrives as `음식점>한식` or as
  `한식>육류,고기요리`, so `음식점` (216 places) and `한식` (138) are one class split in two. The
  full path survives only in `review_candidates.csv` (111 distinct approved values). Publishing the
  second segment as a `subcategory` field would let the 업종 badge say `육류·고기요리` instead of
  `한식`, and could support a finer filter than the four kinds. Needs a schema change, a validator
  rule and a full re-collect, so it was ruled out of the UI batch that introduced the badge
  — `collector/build_places.py`, `collector/validate.py`, `src/data/types.ts`

### `.claude/settings.json` lost its `Write` denies (2026-09-03)

- [ ] [fix] The permissions deny list carries `Edit(./.env)` and `Edit(./data/places.json)` but no
  longer the matching `Write(...)` entries, so the `Write` tool — which replaces a whole file —
  can create a `.env` holding a Naver secret or hand-write the generated dataset that AGENTS.md
  says only the collector may produce, both without a prompt. Flagged independently by two review
  engines on PR #50; the change predates that PR and rode in from the branch point, so it was
  recorded rather than reverted inside a `[FEAT]` PR. Restoring the two lines is the fix, but it is
  the operator's permission decision to make — `.claude/settings.json`

## Someday

- [ ] Precomputed monthly aggregates in the JSON if `transactions` growth threatens the 3s load budget
- [ ] Distance-from-me search, favourites, heatmap (PRD §44 V2 candidates)
