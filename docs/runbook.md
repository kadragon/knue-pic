# Runbook

The web-app commands below are verified against the scaffolded repo. Of the collector commands,
only `collector.validate` and its test run exist and are verified; `collector.run` and
`collector.build_places` are still the agreed target, so do not cite those two as fact.

## Quick Start

### Prerequisites

- Node.js — verified on v26.5.0; no `engines` floor is declared yet (`node -v`)
- npm (bundled with Node)
- Python 3.11+ for the collector only (`python3 -V`)
- `pytest` for the collector tests — declared in `collector/requirements-dev.txt`
  (`python3 -m pip install -r collector/requirements-dev.txt`)
- A Naver Maps **browser Client ID** for local map rendering

### Setup

```bash
git clone git@github.com:kadragon/knue-pic.git
cd knue-pic
npm install
printf 'VITE_NAVER_MAP_CLIENT_ID=\n' > .env.local   # then fill in the ID
npm run dev
```

### Verify

- Open the dev URL Vite prints — expect the app shell with the source line and the §21 disclaimer.
- Without a client ID in `.env.local` the map slot shows `지도를 불러오지 못했습니다.` and everything
  else works — that is the PRD §38 path, not a broken setup.
- Block the Naver script in devtools — the list, search, and detail must still render (PRD §38).

Note the Pages subpath: `npm run preview` serves at `/knue-pic/`, not `/`.

### Verify the real map

The only local origin the key accepts is `http://localhost:5173` (see Naver API Keys), so visual
acceptance of any map change runs on `npm run dev`, or on `npm run preview` to check the production
bundle. `vite.config.ts` pins both to port 5173 with `strictPort`: if the port is taken — by the
other of the two, too — the command exits instead of sliding to a port the key rejects. Check that
the map mounted without relying on a screenshot:

- open `http://localhost:5173/knue-pic/` at 360px and 1440px and allow at least 2 s for
  delayed origin rejection (`src/map/loader.ts` module comment);
- `http://oapi.map.naver.com/v3/auth` answered `200` (a rejected origin gets `401`);
- `document.querySelector('.page-map-canvas').children.length > 0` and
  `window.naver?.maps != null` (a rejected origin leaves the global without it);
- no `.shell-map-note` failure status is present.

Check the page map at both widths on the same origin:

- dots + pins + the sum of the cluster counts matches the `{N}곳` in the summary line —
  `.page-map-dot` and `.page-map-pin` count one each, `.page-map-cluster` prints its own `{n}곳`;
  the markers are the places that pass both filters, and the two are computed from one predicate;
- no two `.page-map-cluster` boxes intersect, and clicking an uncovered one zooms in and regroups;
- `document.querySelector('.page-map-canvas')` exists and no `.shell-map-note` is present;
- pressing `학교로` re-centres on `CAMPUS_ORIGIN` (`src/stats/distance.ts`) — the map's centre after
  the press is `36.6084, 127.3582`;
- switching 기간 or 업종 changes that total, and narrowing never leaves a marker behind: the total
  only ever goes down by the places that left the window, never by a redraw.

To check the degraded layout, block the Naver script (or use an origin the key rejects) at both widths:
`.map-shell-map` disappears, exactly one `.shell-map-note` reading `지도를 불러오지 못했습니다.` is
above the summary line, and the list, the search and the responsive detail view all still work.

## Build & Test

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck, then production build into `dist/` |
| `npm run preview` | Serve the built output — the closest local match to Pages |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit tests (stat logic, framing-vocabulary check) |
| `npm run lint` | Lint check |
| `python3 -m pytest collector` | Collector unit tests (the PRD §32 validator) |

`src/stats/` is the part that must be tested: every number the UI shows comes from there.

## Data Update (monthly, local only)

Run by the operator; never in CI. Full cycle in `docs/workflows.md` → `data-update`.

```bash
# collection is the knue-expense-collect skill — its SKILL.md holds the five stage commands
# → writes collector/out/ and appends rows to review_candidates.csv
# review pending rows by hand; the reviewer's verdicts are written down with
#   python3 .claude/skills/knue-expense-collect/scripts/apply_review.py \
#     --approve NAME [NAME...] --reject NAME [NAME...]
#   (it writes only the rows named on the command line — never the rest)
# then `geocode_candidates.py --report` — approved rows only, so it must run AFTER that pass
# merge spellings of one business in collector/aliases.json (see docs/architecture.md → Build)
python -m collector.build_places             # emits data/places.json from approved rows
# → updatedAt = last day of the newest collected month; collect the month before building
# → also appends any new place to collector/id_map.json; commit that file with the dataset
python -m collector.validate data/places.json  # PRD §32 checks; non-zero exit = do not publish
npm run preview                              # eyeball the result before committing
```

Publication is never automatic: the validator passing is necessary, a human look is also required.

## Deploy

| Environment | URL | Branch | Method |
|-------------|-----|--------|--------|
| Production | https://kadragon.github.io/knue-pic/ | `main` | GitHub Actions → Pages |

1. Merge the PR into `main`.
2. Actions runs validate → build → deploy. A validator failure aborts before deploy.
3. Confirm the "데이터 기준일" date in the provenance band under the header matches what you
   published.

Because merging to `main` publishes, treat merge as the release step.

## Environment Variables

There is no `.env.example` in this repo: the operator's global agent settings deny reads of any
`.env.*` path, so a committed sample file would be unreadable to every agent session. This table is
the sample.

| Variable | Required | Where | Description |
|----------|----------|-------|-------------|
| `VITE_NAVER_MAP_CLIENT_ID` | yes, for the map | `.env.local` (gitignored) locally; a repository **variable** (`Settings → Secrets and variables → Actions → Variables`) for the Pages build | Naver Maps **browser** Client ID. Vite inlines it into the bundle — it is public by design, and it is protected by the key's allowed-URL list, not by secrecy. That is why CI reads it from `vars.`, never `secrets.`. Leave it unset and the deploy still succeeds, but the published site renders the PRD §38 map fallback; the `build` job logs a warning saying so. |

The collector's server/search credentials are never Vite variables and never live in this file.

## Naver API Keys

- **Browser Client ID** — the only key in the web app. Restrict its allowed Web Service URL to
  `https://kadragon.github.io` and `http://localhost:5173` for development. Observed 2026-10-03:
  `:5173` authenticates; `:5179` and `:4173` (`vite preview`'s default, now pinned away from) get `401` from `/v3/auth` and the map
  falls back — the list is per port, not a `localhost:*` wildcard. `npm run preview`, pinned to
  `:5173` since, authenticated the same way (2026-10-03, Chromium: `/v3/auth` `200`, map mounted,
  no fallback). The fallback comes from `window.navermap_authFailure`, called after the map has
  mounted (`src/map/loader.ts` module comment); the loader itself resolves.
- **Server / search secret** — used by the collector for geocoding. Lives in the operator's local
  environment only. It must never appear in `src/`, in a committed file, or in an Actions secret
  used by the web build.

## Common Failures

### Map fails to load, list still renders

**Symptom:** "지도를 불러오지 못했습니다." with the ranked place list still rendering. On the page
map this is the *whole* layout: at every width the content column takes the full width back, because
the map was the page and there is nothing to float beside.
**Cause:** Client ID missing, or the current origin is not in the key's allowed URLs — locally,
any port other than `5173`.
**Fix:** Check `VITE_NAVER_MAP_CLIENT_ID`, then the key's Web Service URL list. This degradation is
intended behaviour (PRD §38) — the fix is the key, never removing the fallback.

### Build refuses `--updated-at`

**Symptom:** `python -m collector.build_places` exits non-zero naming `--updated-at`.
**Cause:** the anchor is not the last day of a month, or it runs past the newest collected month.
Both are refused on purpose (`check_anchor`): the browser's period windows are whole calendar months,
so a mid-month anchor cuts one in half, and an anchor past the data reships the undisclosed-month
gap the anchor exists to close.
**Fix:** drop the flag and let the build derive the newest month end, or pass the month end itself —
`--updated-at 2026-08-31`, never the date the run happens to be on.

### Validator rejects `places.json`

**Symptom:** `collector.validate` exits non-zero; deploy stops.
**Cause:** usually a place with no approved coordinates, or a date outside the rolling window.
**Fix:** correct the offending row in `review_candidates.csv` (or the collector step that produced
it) and regenerate. Never edit `data/places.json` by hand to get past the gate.

Exit **2** is a different failure: the validator could not run at all. Besides an unreadable
dataset or queue, check 9 needs `collector/id_map.json` — it joins each place's `id` to the queue
through that map — so a missing or self-contradicting map stops the run before any check. Rebuild
it with `python -m collector.build_places` and commit it with the dataset.

### Stage 1 collected fewer departments than expected (known walk limits)

`fetch_disclosures.py` (stage 1 of the collection skill) stops walking the board by position, and
three shapes fall outside that rule. They were reproduced in review on PR #23 and accepted rather
than fixed — there is no board evidence that any of them occurs — and each is pinned as-is by a
`test_limit_*` case in `collector/tests/test_fetch_disclosures.py`, so a change to the walk that
alters one fails there and this section has to move with it.

- **(a) A late department below older pages is missed, and the run exits 0.** Two consecutive
  pages whose dated 업무추진비 titles are all older than the month arm the stop; `--quiet-pages`
  (default 3) pages without a match then end the walk. A target-month post further down than that
  is never read, and the year guard cannot object because the first cluster already carries the
  right stamp. **The only one of the three that can lose data.** Compare stage 1's post count
  with the roughly 20 departments that publish a month; if one you expect is absent, find it on the
  board and re-run with a wider `--quiet-pages` — each extra page reaches one page further past
  the point the stop armed.
- **(b) A board that clamps an out-of-range `pageIndex` to a cycle walks to `--max-pages`.** The
  repeat-page guard compares only the preceding page, so a board serving its last page forever
  stops at once, but one alternating between two pages never trips it. Costs time, not data.
- **(c) A walk that never arms costs the full cap on both traversals.** A month older than
  everything the board still carries (every dated page is newer), or a board whose 업무추진비 titles
  are all undated, never yields the all-older pages the stop needs — up to 2 × `--max-pages`
  listing requests. Costs time, not data; the run then ends in stage 1's exit 1 or 3.

### 404 on the deployed site, works locally

**Symptom:** blank page or missing assets on the Pages URL.
**Cause:** Vite `base` not set to the repo subpath.
**Fix:** `base: '/knue-pic/'` in the Vite config.

## Harness Maintenance

- Validate the harness: `bash <harness-init>/scripts/validate-harness.sh`
- Close a finished sprint block: `python <harness-init>/scripts/reconcile-harness.py`
- **Sweep trigger policy: manual.** `tools/sweep.sh` is not installed yet; install and run it on
  the first real drift signal (`harness-init` Step 5).

### Verify panel detail and shared URLs

At 1440px, select a row, pin, dot or search result: the panel shows `← 목록` and the existing
figures/chart/links, the URL becomes `#place=<canonical id>`, and the page map centres on it.
No modal or single-marker detail map exists at that width. `← 목록` and browser Back return
to the preserved list and restore focus; Forward or reloading the shared URL opens the detail.
An unknown or malformed id shows the list silently. At 360px the same selection stays inside the bottom sheet without a modal or second map.
Check peek / half / full using drag, arrow keys, Home / End, and tapping the handle. Scroll the
content independently; tabbing into peek content must reveal focus. Resize an open selection
across 768px and verify its card, focus and hash stay. Repeat selection at both widths with the Naver
script blocked: the panel expands and every figure and link remains usable.
