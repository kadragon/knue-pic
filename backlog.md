# Backlog

## Review Backlog

### PR #47 — the stylesheet guards share a brace-regex parser with two blind spots (2026-09-02)

- [ ] [debt] `RULES` in `src/ui/stylesheet-claims.test.ts` matches innermost brace pairs, which is
  not a CSS parser. Two shapes make declarations invisible to **both** stylesheet guards — the
  on-scale `unconvertedSpacing` one merged in PR #46 and the `optical:` one from PR #47 — so a raw
  px in either shape ships unchecked, on scale or off. (a) A rule containing a nested block —
  native nesting `&:hover { … }` or a nested `@media` — has the declarations around that block
  swallowed into the inner selector and emitted by nothing; verified with
  `.probe { color: red; &:hover { color: blue; } margin: 8px; }`, which the merged on-scale guard
  passes green. (b) A `/*` inside a quoted value (`content: "/*";`) opens a comment the masker
  cannot distinguish from a real one, blanking through the next `*/` and eating the `;` terminators
  after it; the sheet already carries a quoted `content` value. Neither shape is in the sheet today
  and both predate PR #47 — `git log -S` dates the pattern to PR #43 — which is why they were
  declared in the `cssDeclarations` docblock rather than fixed there. A third member of the family
  fails *closed* and so is not a hole, but belongs to the same fix: a `{` or `}` inside a quoted
  value (`content: "{"`) breaks the match so the offender is reported under a corrupted selector,
  sending the reader after a rule that does not exist. Closing them means replacing the brace regex with a real parse for both guards
  at once (source: contract QA pass 4 on PR #47)
  — `src/ui/stylesheet-claims.test.ts`

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

## Someday

- [ ] Precomputed monthly aggregates in the JSON if `transactions` growth threatens the 3s load budget
- [ ] Distance-from-me search, favourites, heatmap (PRD §44 V2 candidates)
