# Backlog

## Review Backlog

### PR #48 — a construct that loses sync and is rebalanced later is not reported (2026-09-03)

- [ ] [debt] `SHEET.unterminated` reports a comment, string, block or paren left open at the end of
  the scan, which catches everything that ends the scan mid-way. It cannot catch a construct that
  loses sync and is brought back to a settled state by an unrelated one later in the file: a
  dropped `)` cancelled by a stray `)` in a later rule leaves the depth at zero, so every
  declaration between them is merged into one and lost with the suite green. Verified with
  `.probe { background: url(a; padding: 8px; }` followed by `.probe-b { margin: 8px); }` — two
  on-scale raw px disappear, nothing is reported. Malformed CSS that the build rejects
  so it cannot publish; recorded because the guard's own docstring now
  names it as out of reach and that claim should have somewhere to point. Tracking the offset of
  each unmatched `(` and requiring it to close inside its own block would cover it (source: contract
  QA pass 4 on PR #48) — `src/ui/stylesheet-claims.test.ts`

### PR #48 — an unquoted `url()` holding `/*` is read as a comment open (2026-09-03)

- [ ] [debt] The CSS tokenizer does not process comments inside an unquoted url token, so
  `background: url(http://example.com/*a.png)` is valid CSS whose `/*` `scan()` reads as opening a
  comment. It can come back out balanced — a later real `*/` closes it — so `SHEET.unterminated`
  stays empty and the declarations in between are merged and lost: an on-scale `padding: 8px` after
  such a url goes unreported with the suite green, and the sheet builds. Pre-existing in the same
  shape on the brace regex, and unreachable today (`grep 'url(' src/styles.css` finds nothing), so
  it is recorded rather than fixed. Closing it means treating `url(` as a token whose contents are
  opaque until the matching `)` (source: contract QA pass 3 on PR #48)
  — `src/ui/stylesheet-claims.test.ts`

### PR #48 — a rule nested inside a rule is attributed to its own prelude (2026-09-03)

- [ ] [debt] The scan that replaced the brace regex gives every block its own prelude as `selector`,
  never a resolved ancestor chain. For a rule nested in an `@media` at top level that is right, and
  it is what `reachingRules` has always assumed. For a rule nested inside *another rule* — the
  `&:hover` and inner-`@media` shapes the scan newly understands — it loses the element: a raw px
  there is reported as `@media (max-width: 600px) { margin: 8px }`, naming a rule the reader cannot
  find, and `reachingRules('.place-kind-badge')` does not match `.place-kind-badge { @media … {
  white-space: normal; } }`, so the nowrap guard cannot see an override written that way. Nothing
  goes *unseen* — the declarations are scanned and an unannotated raw px still goes red — so this
  is attribution, not a hole. Resolving the chain (`&` against the parent selector, an at-rule
  frame passing its parent through) would fix both, and it changes what `reachingRules` matches,
  which is why it was not folded into PR #48 (source: code-review + contract QA on PR #48)
  — `src/ui/stylesheet-claims.test.ts`

### PR #48 — `bodyEnd` backfill walks every declaration at every closing brace (2026-09-03)

- [ ] [debt] Three places walk every declaration for every rule, about 593 × 146 on today's sheet:
  `scan()` backfills each declaration's `bodyEnd` by looping over all declarations found so far at
  every closing brace; `RULES` filters the whole declaration list once per rule; and the annotation
  guard's adjacency test scans the whole sheet per raw-px declaration rather than the owning rule's
  range. All three run in milliseconds and no test is slow because of them, so this is tidiness
  rather than a defect: a frame recording the index of its first declaration would let all three
  address a range instead (source: contract QA passes 1 and 2 on PR #48)
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
