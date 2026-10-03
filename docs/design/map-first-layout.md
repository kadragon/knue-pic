# Map-First Layout

Pre-launch UI/UX overhaul, decided 2026-10-03 after a survey of comparable sites. Primary
reference: 공공밥 (https://gonggongbap.kr/) — same Naver Maps stack, neutral discovery wording.
Secondary: restaurant.coroke.net, ko.kookrator.xyz/map/food/, MICHELIN Guide mobile list/map toggle.
Those sites were read for layout only; their intensity encodings and "세금 감시"/"추천" framings are
explicitly not adopted (see Implementation Decisions).

## Problem Statement

The first screen is a centred single column — period tabs, a ranked list, search below it — and
the only map lives inside the detail dialog, one marker at a time. A reader cannot see where the
frequently visited places sit relative to each other or to campus without opening them one by one.
Comparable sites answer "what is around here?" on the first screen with a map plus a list panel.
The site is about to be published externally, so the first impression is the one to fix.

The page-level map was removed once before (PR #17, `src/map/place-map.ts` header) because it sat
three screens below the list, away from the moment the reader asks "where is this one?". A
map-first layout removes that distance instead of the map: the map *is* the first screen.

## Solution

Swap the page into two regions:

- **Desktop (≥ 768px):** full-bleed Naver map with a ~360px panel floating on the left.
- **Mobile (< 768px):** full-screen map with a bottom sheet snapping to peek / half / full,
  default half, with a grab handle.

The panel carries, in source order: a summary line · 업종 chips with counts · period tabs · the
ranked list · search. Selecting a place — from a row, a pin, a dot, or a search result — replaces
the list inside the panel with the detail card (`← 목록` returns), pans the map to the place, and
writes `#place=<id>` to the URL. The modal dialog and its single-marker map go away; the page map
replaces them.

If the map cannot load, the layout falls back to today's page: the panel expands to full width and
shows `지도를 불러오지 못했습니다.` once at the top. Everything the panel does still works.

## User Stories

- As a staff member opening the site, I want the places on a map near campus at first glance, so
  that I can see what is close without opening each one.
- As a reader scanning the list, I want the row I hover or select to highlight its pin, so that I
  can connect a name to a location.
- As a reader exploring the map, I want to tap any dot and see that place's figures, so that the
  map is a way into the data and not just a picture of it.
- As a reader sharing a place, I want a URL that opens straight to its detail, and the back button
  to return to the list.
- As a reader on a phone, I want the list in a sheet I can pull up or push down, so that I can
  trade map space for list space.
- As a reader whose browser blocks the map, I want the list, search and detail to work as they do
  today.

## Implementation Decisions

1. **Marker encoding — rank number, never intensity.** Each row currently visible in the list gets
   a pin printing its rank number (the same number the row prints), highlighted in sync with row
   hover/selection. Every other place that passes the period and 업종 filters is a small neutral
   dot. Marker size, shade and hue never vary with visit count: an intensity scale is the density
   map `docs/design/deferred-scope.md` → Heatmap rules out as surveillance framing. The number is a
   text channel already on the row, so colour is never the only carrier.
2. **Architecture invariant amended, not dropped.** `docs/architecture.md` → Layer Rules says the
   map "carries no ranking, so it has no reason to read stats output". It becomes: `src/map/` still
   computes no statistic and never imports `src/stats/`; the UI hands it a list of
   `{ place, label? }` where `label` is the rank string the row already printed. The
   `src/map/place-map.ts` header is rewritten to record why the page map returned.
3. **No clustering in this spec.** Only the filtered set is drawn (the 3-month window shows 162
   places on the current dataset; 525 total). Naver Maps v3 core is believed to have no built-in
   clusterer — unverified; the commonly cited `MarkerClustering.js` is example code that would have
   to be vendored. Revisit only if overlap is observed on the real map.
4. **Detail inside the panel, URL hash state.** `#place=<id>` uses the canonical place id; an id
   absent from the dataset falls back to the list silently (the place left the rolling window).
   Only the id enters the URL — never a position. `location.hash`/`history` are not in
   `src/ui/device-state.test.ts` → `DEVICE_STATE_APIS`, so no `ALLOWED` change is needed.
5. **Graceful degradation reuses today's layout.** Both failure routes `place-map.ts` already
   merges (load rejection, `navermap_authFailure`) switch the page into the full-width list state.
   The panel never waits on the map: list and figures paint first, the map mounts fire-and-forget,
   as the dialog does today.
6. **Summary line in `src/stats/`.** `{updatedAt} 기준 · N곳 · N회` — N곳 = places with at least one
   in-window transaction under the current filters, N회 = in-window transaction count. Pure function,
   unit-tested like every other statistic.
7. **업종 chip counts** = in-window places per kind, same function family as the summary.
8. **`학교로` control** recentres the map on `CAMPUS_ORIGIN` (`src/stats/distance.ts`). The UI
   passes the coordinate into `src/map/`, which still never imports `src/stats/` (Decision 2). No
   distance-from-me.
9. **Source order** stays ranked list → search inside the panel (`docs/conventions.md` →
   Accessibility & Responsive), so the 360px rule and its reasoning carry over unchanged.

## Testing Decisions

- Unit (vitest + jsdom, against `src/map/fake-naver-api.ts`): pins carry exactly the visible rows'
  labels; non-visible filtered places become unlabelled dots; marker options carry no
  size/colour derived from visit count; row hover ↔ pin highlight; dot click opens the panel detail;
  hash round-trip (`#place=<id>` opens detail; unknown id → list); auth-failure and load-rejection
  both produce the full-width list state.
- Unit (`src/stats/`): summary line and chip counts, hand-computable from a fixture.
- Existing guards stay green and are extended where they assert over files: banned-phrase test
  covers every new string; `stylesheet-claims.test.ts` covers new palette/tokens;
  `device-state.test.ts` unchanged.
- Manual, recorded in the PR: 360px and 1440px in a real browser with the map loaded, and with the
  Naver script blocked; Data Correctness spot-check per `docs/eval-criteria.md` § 1.
- Grading: all four `docs/eval-criteria.md` criteria.

## Out of Scope

- Marker clustering (follow-up ticket only on observed overlap).
- Distance-from-me, favourites, heatmap / density / intensity-scaled markers.
- i18n, link to the source disclosure record, new data fields in `places.json`.

## Further Notes

- **Dev verification origin — resolved.** The key accepts only `http://localhost:5173` locally
  (`:5179` and `vite preview`'s `:4173` got `401`); `vite.config.ts` pins the dev port, and
  `docs/runbook.md` → Verify the real map is the visual-acceptance route for every ticket.
- The detail card's sections (figures, monthly columns, links) move unchanged from the dialog into
  the panel; PR #63's chart rhythm is kept.
- The backlog debt on `navermap_authFailure` timing becomes more visible, not less: the page map is
  now on the first screen, so a rejected origin degrades the whole layout.
