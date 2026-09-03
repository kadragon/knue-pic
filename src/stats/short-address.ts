/**
 * The shortened address a ranked row displays.
 *
 * Lives in `src/stats/` rather than beside the other display transforms in `src/ui/`, because
 * `src/stats/search.ts` matches against it — a reader must be able to search back the district a
 * row showed them (`docs/conventions.md` -> Accessibility) — and Layer Rules forbid `src/stats/`
 * from importing `src/ui/`. `src/ui/place-labels.ts` re-exports it, so the views still reach every
 * display transform through one module.
 */
/**
 * `충청북도 청주시 흥덕구 가로수로1164번길 38` → `청주 흥덕구`.
 *
 * The list row has one metadata line and the full address does not fit in it beside the figures.
 * What a reader wants from an address at a glance is the district, not the door number — the exact
 * street is one tap away in the detail dialog, which keeps the address whole.
 *
 * Tokens are consumed in administrative order and the walk stops at the first token that is not an
 * administrative unit — the road name, or in four rows a 동/리 the short form deliberately does not
 * carry. A `…도` is dropped outright (410 of the 414 rows that
 * carry a province are in 충청북도, so naming it distinguishes nothing) while `…특별시`/`…광역시`/`…특별자치시` keeps
 * its stem — 대전 and 세종 are exactly the places the district alone would not distinguish.
 *
 * An address matching no rule is returned **whole**. Truncating it to a fixed token count would
 * invent a district for an address shaped differently than every one in today's dataset; showing
 * the long form is a legible fallback, a wrong short form is not.
 */
export function shortAddress(address: string): string {
  return adminUnits(address)?.join(' ') ?? address;
}

/**
 * Where an address is, as a Naver Maps search prefix: the city, then the narrowest unit under it —
 * `청주 강내면`, `대전 서구`, `괴산군 괴산읍`, and `세종` where the city is all the address names.
 *
 * It exists because searching a bare trade name finds the wrong branch: `신토불이` is a name many
 * unrelated places carry nationwide, and the one the dataset means is identified by where it is.
 *
 * **Two tokens, and the city is not one of the droppable ones.** The narrowest unit alone was the
 * first shape of this function, and it reproduced the bug it was written to fix: in 12 of the 504
 * published rows the narrowest unit is a bare `서구`/`중구`/`동구` — names five or six cities each
 * share — so `커피빈 코리아` in 대전 searched as `서구 커피빈 코리아`. A
 * district name is not national, a city name is; the pair narrows where either alone does not. The
 * middle units are dropped rather than kept because a search query is matched, not parsed, and
 * `청주 흥덕구 강내면 신토불이` spends two more tokens a listing may not spell the way the address
 * does.
 *
 * `null` when no rule matches, which is the caller's signal to fall back rather than to prefix an
 * address fragment — the same refusal `shortAddress` makes by returning the address whole.
 */
export function addressRegion(address: string): string | null {
  const parts = adminUnits(address);
  if (parts === null) return null;
  const city = parts[0] as string;
  const narrowest = parts[parts.length - 1] as string;
  return city === narrowest ? city : `${city} ${narrowest}`;
}

/** The administrative units of an address, outermost first, or `null` if it names none. */
function adminUnits(address: string): string[] | null {
  const tokens = address.trim().split(/\s+/);
  // One retry from the second token, because a province is written both ways in practice:
  // `충청북도` matches the rule below, `충북` matches nothing and would otherwise stop the walk
  // before it began. The retry is confined to that abbreviation list rather than skipping any
  // unmatched leading token: `대전 중구 …` — a metropolitan city written without its 광역시 — would
  // otherwise walk to `중구`, a district name six cities share, which is exactly the ambiguity the
  // 광역시 branch below exists to prevent.
  const [first] = tokens;
  const retryable = first !== undefined && PROVINCE_ABBREVIATIONS.has(first);
  return (
    collectAdminUnits(tokens) ?? (retryable ? collectAdminUnits(tokens.slice(1)) : null)
  );
}

/**
 * The 2-character province spellings, listed rather than pattern-matched.
 *
 * No shape distinguishes `충북` from `대전`: both are two syllables ending in no administrative
 * suffix, and only one of them is a province safe to drop. Guessing from the shape is what would
 * discard a city name, so the nine provinces are written out and everything else falls through
 * to the whole-address fallback.
 */
const PROVINCE_ABBREVIATIONS = new Set([
  '충북',
  '충남',
  '전북',
  '전남',
  '경북',
  '경남',
  '강원',
  '경기',
  '제주',
]);

function collectAdminUnits(tokens: string[]): string[] | null {
  const parts: string[] = [];

  for (const token of tokens) {
    // Dropped rather than kept: 충청북도 covers all but a handful of the dataset, so naming it
    // distinguishes nothing. It is the one unit that never reaches `parts`.
    if (parts.length === 0 && /^..+도$/.test(token)) continue;

    const wide = /^(.+?)(?:특별시|광역시|특별자치시)$/.exec(token);
    if (parts.length === 0 && wide) {
      parts.push(wide[1] as string);
      continue;
    }

    // Only `시` is stripped. A `군` keeps its suffix like `구`/`읍`/`면` do, because `괴산 괴산읍`
    // reads as a city and `괴산군 괴산읍` reads as what it is.
    const city = /^(.+?)시$/.exec(token);
    if (city) {
      parts.push(city[1] as string);
      continue;
    }
    // One syllable before the suffix, not two: `서구`, `중구`, `동구` are real districts — 12 of
    // the 504 published rows carry one — and a two-character minimum dropped every one of them
    // while `유성구` beside them shortened fine.
    if (/^.+[군구읍면]$/.test(token)) {
      parts.push(token);
      continue;
    }
    break;
  }

  return parts.length === 0 ? null : parts;
}
