import { describe, expect, it } from 'vitest';
import { DISTANCE_BANDS } from '../stats/distance';

/**
 * Two guards over `src/styles.css`, both for things nothing else in the suite can see.
 *
 * The stylesheet's test home is this `?raw` import plus `test.css: true` in `vite.config.ts`
 * (`docs/conventions.md` → Test Files). Vitest's default stubs a CSS module to `''`, and every
 * assertion below would then pass vacuously, so the first `it` in each block asserts a string the
 * file certainly contains before anything else runs.
 *
 * 1. **Superlative claims.** A sentence saying "this is the ONE place X happens" goes stale the
 *    moment a second place appears, and no reader of the diff that adds the second one is looking
 *    at the sentence. Adding the 거리 밴드 palette falsified two such sentences at once. The claims
 *    are worth keeping — they are what makes the rule legible — so this registers each one against
 *    a count recomputed from the stylesheet rather than banning the phrasing. A word ban would
 *    fire on prose it should not; a count cannot.
 * 2. **`white-space: nowrap`.** Three rule sets keep `거리 1.2km`, a 업종 badge and a `▲ 3` from
 *    breaking mid-token. Deleting any of them left the whole suite green.
 */

/**
 * Vite resolves these at transform time, so the scan needs no filesystem access — a test under
 * `src/` cannot import `node:fs` (`docs/conventions.md` → Test Files). Written as literal paths
 * rather than a wildcard: this suite makes claims about these three files by name, and a glob that
 * silently stopped matching one of them would take its claim's guard with it.
 */
const SOURCES: Record<string, string> = import.meta.glob(
  ['/src/styles.css', '/docs/conventions.md', '/src/stats/distance.ts'],
  { query: '?raw', import: 'default', eager: true },
);

const STYLESHEET_PATH = '/src/styles.css';

const source = (path: string): string => SOURCES[path] ?? '';

/** Comments hold example selectors and quoted rules; counting those would inflate every tally. */
const withoutComments = (css: string): string => css.replaceAll(/\/\*[\s\S]*?\*\//g, ' ');

/**
 * Selectors here span lines (`.top-place-distance,\n.place-detail-distance {`) and docblock prose
 * wraps mid-sentence, so both are matched against a single-spaced form. A regular expression over
 * the raw text would need to escape every `.`, `[` and `'` in a dense selector, and one missed
 * escape reads as a passing test.
 */
const collapse = (text: string): string => text.replaceAll(/\s+/g, ' ').trim();

/** Docblock continuation markers (` * `), so a claim can be registered as one flat sentence. */
const prose = (path: string): string =>
  collapse(source(path).replaceAll(/^[ \t]*\*[ \t]/gm, ' '));

const CSS = collapse(withoutComments(source(STYLESHEET_PATH)));

/**
 * Every rule in the sheet as `[selector, declarations]`, innermost first — the inner pattern skips
 * an `@media` prelude rather than swallowing the rules inside it.
 */
const RULES: [string, string][] = [...CSS.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(
  ([, selector, block]) => [collapse(selector ?? ''), block ?? ''],
);

/**
 * The declaration block of one rule, or `''` when the selector is not in the sheet.
 *
 * Matched on the whole selector, not as a substring: `.top-place-delta` occurs inside
 * `.top-place-meta .top-place-delta`, and an `indexOf` handed back that rule's declarations
 * instead — a guard reading the wrong rule while looking like it works.
 *
 * Every matching rule, not the first: CSS lets one selector be declared more than once, and a
 * property split into a second block is as present as one in the first. Taking the first block
 * would report the property missing and send whoever reads the failure looking for a deletion
 * that never happened.
 */
const declarations = (selector: string): string =>
  RULES.filter(([candidate]) => candidate === selector)
    .map(([, block]) => block)
    .join(' ');

/**
 * The `data-*` attributes whose rules set BOTH a background and a foreground — the mechanical
 * reading of "a palette that carries meaning": the element is filled and lettered off one stamped
 * attribute, so the colour says something the view did not choose.
 *
 * `data-direction` sets `color` alone and is deliberately excluded. `docs/conventions.md` counts
 * rank movement as a third cue on top of a glyph and a spoken label, not as a palette, and a
 * predicate that swept it in would put the registered claims permanently out of date.
 */
function meaningCarryingPalettes(): string[] {
  const found = new Set<string>();

  for (const [selector, block] of RULES) {
    const attributes = [...selector.matchAll(/\[data-([a-z-]+)\s*=/g)].map(([, name]) => name as string);
    if (attributes.length === 0) continue;

    const properties = new Set(
      block
        .split(';')
        .map((declaration) => declaration.split(':')[0]?.trim() ?? '')
        .filter(Boolean),
    );
    const paints =
      (properties.has('background') || properties.has('background-color')) && properties.has('color');
    if (!paints) continue;

    for (const attribute of attributes) found.add(attribute);
  }

  return [...found].sort();
}

/**
 * Each entry is one sentence in the repo that asserts how many of something there are.
 *
 * `sentence` is verbatim (whitespace-collapsed): rewriting or deleting the claim fails this suite
 * until whoever rewrote it registers the replacement, which is the point — PR #42 replaced one
 * stale justification with a fresh false one. `count` is recomputed from the stylesheet, so the
 * third palette to land fails the assertion without anyone touching the prose.
 */
const CLAIMS: { path: string; sentence: string; expected: number; count: () => number }[] = [
  {
    path: '/docs/conventions.md',
    sentence:
      'Two palettes carry meaning rather than decoration — 업종 and 거리 밴드 — and both are held to the same two rules',
    expected: 2,
    count: () => meaningCarryingPalettes().length,
  },
  {
    path: STYLESHEET_PATH,
    sentence:
      'The 업종 palette is the first of the two places colour carries meaning rather than decoration (the 거리 밴드 ramp in note 6 is the other)',
    expected: 2,
    count: () => meaningCarryingPalettes().length,
  },
  {
    path: '/src/stats/distance.ts',
    sentence: 'A *new* band is not — its name also needs a fill in `src/styles.css`',
    expected: DISTANCE_BANDS.length,
    // The token pair, not a `[data-band='<name>']` rule: `near` is the default fill and lives in
    // the base rule with no attribute selector of its own, so a rule count would report 3 of 4 and
    // read as the claim being false when it is the predicate that is wrong.
    count: () =>
      DISTANCE_BANDS.filter(
        ({ band }) => CSS.includes(`var(--dist-${band}-bg)`) && CSS.includes(`var(--dist-${band}-fg)`),
      ).length,
  },
];

describe('superlative claims', () => {
  it('reads all three files, so no claim is guarded by an empty string', () => {
    // Every assertion below is an equality or a `toContain` over text read at transform time. A
    // stubbed-out CSS module or a glob that stopped matching would make them agree with anything.
    expect(Object.keys(SOURCES).sort()).toEqual([
      '/docs/conventions.md',
      '/src/stats/distance.ts',
      STYLESHEET_PATH,
    ]);
    expect(CSS).toContain(':root {');
    expect(prose('/docs/conventions.md')).toContain('## Accessibility');
    expect(prose('/src/stats/distance.ts')).toContain('DISTANCE_BANDS');
  });

  it('finds exactly the 업종 and 거리 palettes, so the count the claims rest on is real', () => {
    // Named rather than only counted: a predicate that found two *different* attributes would
    // satisfy every `expected: 2` below while measuring something else entirely.
    expect(meaningCarryingPalettes()).toEqual(['band', 'kind']);
  });

  it.each(CLAIMS)('$path still says it, and it is still true', ({ path, sentence, expected, count }) => {
    expect(prose(path), `${path} no longer carries the registered claim`).toContain(sentence);
    expect(count(), `${path} claims ${expected}, the stylesheet says otherwise`).toBe(expected);
  });
});

describe('white-space: nowrap', () => {
  /**
   * `거리` above its own `1.2km`, a category split across two lines, a `▲` orphaned from its `3`:
   * each is a figure a reader would have to reassemble. jsdom applies no stylesheet, so a rendered
   * assertion cannot see any of this — the rule text is the only evidence there is.
   */
  const WRAPPING_TOKENS = [
    '.place-kind-badge',
    '.top-place-distance, .place-detail-distance',
    '.top-place-delta',
  ];

  it.each(WRAPPING_TOKENS)('%s never breaks mid-token', (selector) => {
    // First, because `declarations` returns '' for a selector it cannot find and '' contains
    // nothing: without this line a renamed selector passes the assertion under it.
    expect(declarations(selector), `${selector} is no longer a rule in the stylesheet`).not.toBe('');

    expect(declarations(selector)).toContain('white-space: nowrap');
  });
});
