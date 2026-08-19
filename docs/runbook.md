# Runbook

The web-app commands below are verified against the scaffolded repo. Of the collector commands,
only `collector.validate` and its test run exist and are verified; `collector.run` and
`collector.build_places` are still the agreed target, so do not cite those two as fact.

## Quick Start

### Prerequisites

- Node.js — verified on v26.5.0; no `engines` floor is declared yet (`node -v`)
- npm (bundled with Node)
- Python 3.11+ for the collector only (`python3 -V`)
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
python -m collector.run --month YYYY-MM      # download + extract + normalize
# → writes collector/out/ and appends rows to review_candidates.csv
# review pending rows by hand: set status to approved / rejected
python -m collector.build_places             # emits data/places.json from approved rows
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
3. Confirm the footer's "최근 데이터 업데이트" date matches what you published.

Because merging to `main` publishes, treat merge as the release step.

## Environment Variables

There is no `.env.example` in this repo: the operator's global agent settings deny reads of any
`.env.*` path, so a committed sample file would be unreadable to every agent session. This table is
the sample.

| Variable | Required | Where | Description |
|----------|----------|-------|-------------|
| `VITE_NAVER_MAP_CLIENT_ID` | yes, for the map | `.env.local` (gitignored) | Naver Maps **browser** Client ID. Vite inlines it into the bundle — it is public by design, and it is protected by the key's allowed-URL list, not by secrecy. |

The collector's server/search credentials are never Vite variables and never live in this file.

## Naver API Keys

- **Browser Client ID** — the only key in the web app. Restrict its allowed Web Service URL to
  `https://kadragon.github.io` (and `http://localhost:*` for development).
- **Server / search secret** — used by the collector for geocoding. Lives in the operator's local
  environment only. It must never appear in `src/`, in a committed file, or in an Actions secret
  used by the web build.

## Common Failures

### Map fails to load, list still renders

**Symptom:** "지도를 불러오지 못했습니다." with a working TOP 10.
**Cause:** Client ID missing, or the current origin is not in the key's allowed URLs.
**Fix:** Check `VITE_NAVER_MAP_CLIENT_ID`, then the key's Web Service URL list. This degradation is
intended behaviour (PRD §38) — the fix is the key, never removing the fallback.

### Validator rejects `places.json`

**Symptom:** `collector.validate` exits non-zero; deploy stops.
**Cause:** usually a place with no approved coordinates, or a date outside the rolling window.
**Fix:** correct the offending row in `review_candidates.csv` (or the collector step that produced
it) and regenerate. Never edit `data/places.json` by hand to get past the gate.

### 404 on the deployed site, works locally

**Symptom:** blank page or missing assets on the Pages URL.
**Cause:** Vite `base` not set to the repo subpath.
**Fix:** `base: '/knue-pic/'` in the Vite config.

## Harness Maintenance

- Validate the harness: `bash <harness-init>/scripts/validate-harness.sh`
- Close a finished sprint block: `python <harness-init>/scripts/reconcile-harness.py`
- **Sweep trigger policy: manual.** `tools/sweep.sh` is not installed yet; install and run it on
  the first real drift signal (`harness-init` Step 5).
