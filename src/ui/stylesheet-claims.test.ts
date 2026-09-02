import { describe, expect, it } from 'vitest';
import { DISTANCE_BANDS } from '../stats/distance';

/**
 * Three guards over `src/styles.css`, all for things nothing else in the suite can see.
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
 * 3. **The `--space-*` scale.** PR #24 added the scale and converted about half the sheet, which
 *    left a raw px sitting on a step indistinguishable from one chosen against a control's own box.
 *    Every spacing value that equals a step now has to go through its token.
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
 * Every rule in the sheet whose selector reaches `element`, `@media` blocks included: `RULES` is
 * built from the innermost braces, so a rule nested in a media prelude arrives here as a plain
 * selector, indistinguishable from a top-level one. That is what this guard wants — an override is
 * an override whichever block it sits in.
 *
 * Matched against the *last* compound of each comma-separated part, on a class-name boundary. Last
 * compound, because that is the one the rule actually styles: `.top-place-meta .top-place-distance`
 * and `.top-place-distance[data-band='far']` are overrides of this element and count, while
 * `.top-place-delta .delta-icon` styles a child that merely sits inside it and does not. A
 * substring test over the whole selector reads all four as overrides and turns legitimate CSS into
 * a red build naming the wrong element. `:not(…)` is stripped first for the same reason:
 * `.foo:not(.top-place-distance)` is the one form that names the class in order to exclude it.
 *
 * **What this cannot see.** A selector reaching one of these elements without naming its class —
 * `.top-place-meta > span` — is invisible here, and nothing in the suite catches it: matching that
 * form means resolving selectors against a rendered tree, and jsdom applies no stylesheet. This is
 * a guard over the rules that name the token, which is where every override in this sheet has been
 * written so far. The unnamed-selector case stays open by design, not by oversight.
 */
const reachingRules = (element: string): string[] => {
  const name = element.replace(/^\./, '');
  const reaches = new RegExp(String.raw`\.${name}(?![\w-])`);
  const target = (part: string): string =>
    (part.replaceAll(/:not\([^)]*\)/g, '').split(/[\s>+~]+/).filter(Boolean).pop() ?? '');
  return RULES.filter(([selector]) =>
    selector.split(',').some((part) => reaches.test(target(part))),
  ).map(([, block]) => block);
};

/**
 * The properties that decide whether a token may break, as `white-space` and the two longhand
 * spellings that supersede it. `white-space-collapse` is the shorthand's *other* half and governs
 * runs of whitespace, not wrapping, so it stays out — `overflow-wrap` and `word-break` likewise
 * act on where a break lands, never on whether one is allowed.
 */
const WRAPPING_PROPERTIES = /(?:white-space|text-wrap|text-wrap-mode)\s*:\s*([^;]+)/g;

/**
 * Every value a wrapping property is given on `element`, across all the rules above.
 *
 * The declared-value guard below reads one named rule set; this reads the whole sheet, because
 * `white-space: nowrap` in the base rule is worth nothing if a later, more specific rule — or the
 * same selector inside a `@media` block — hands the element `normal` back at some viewport. That
 * is the gap the declared-value guard leaves open, one cascade level up.
 *
 * A conflicting override is rejected rather than resolved: deciding which of two rules actually
 * wins means computing specificity and source order, and a guard that got that arithmetic subtly
 * wrong would be worse than one that simply refuses to let both exist. If a future rule genuinely
 * needs one of these tokens to wrap, this test is where that decision gets argued.
 *
 * Lower-cased and stripped of `!important` before comparison: CSS is case-insensitive in both
 * halves of a declaration, so an exact-string test misses `WHITE-SPACE: normal` while failing on
 * `nowrap !important` — a rule that *strengthens* the very invariant this guards.
 */
const whiteSpaceValues = (element: string): string[] =>
  reachingRules(element).flatMap((block) =>
    // Collapsed before `!important` is stripped, not after: the captured value carries the
    // whitespace that separated it from the closing brace, and an end-anchored strip finds
    // nothing behind it.
    [...block.toLowerCase().matchAll(WRAPPING_PROPERTIES)].map(([, value]) =>
      collapse(value ?? '').replace(/\s*!important$/, ''),
    ),
  );

/** Whether one declaration fills an element, letters it, or redefines a token that does. */
function paintedBy(property: string): 'fill' | 'text' | null {
  if (property === 'background' || property === 'background-color') return 'fill';
  if (property === 'color') return 'text';
  // A palette can also be stamped by redefining its own tokens — `[data-x] { --thing-bg: … }` —
  // and the literal properties then sit on a shared base rule the attribute never appears in.
  if (property.startsWith('--') && property.endsWith('-bg')) return 'fill';
  if (property.startsWith('--') && property.endsWith('-fg')) return 'text';
  return null;
}

/**
 * The `data-*` attributes that end up carrying BOTH a fill and a foreground — the mechanical
 * reading of "a palette that carries meaning": the element is filled and lettered off one stamped
 * attribute, so the colour says something the view did not choose.
 *
 * Accumulated per *element*, not per rule. The 거리 ramp is already written the way a per-rule test
 * cannot see — the base rule fills and letters, and the `[data-band]` rules override the fill only
 * — so the two halves of a palette are collected across every rule reaching the same element and
 * then tested together. The element key is the selector with its attribute brackets stripped, one
 * comma-separated part at a time, so `.top-place-distance[data-band='close']` lands on the same
 * key as the `.top-place-distance` rule that gives it its text colour.
 *
 * `data-direction` stays out on the merits, not by exemption: every rule reaching
 * `.top-place-delta` sets `color` and none sets a fill. `docs/conventions.md` counts rank movement
 * as a third cue on top of a glyph and a spoken label, not as a palette, and a predicate that
 * swept it in would put the registered claims permanently out of date.
 */
function meaningCarryingPalettes(): string[] {
  // `[=\]]` so a presence selector (`[data-flagged]`) counts too, and digits are in the name
  // class: `[data-tier2=…]` is as much an attribute as `[data-tier]`.
  const ATTRIBUTE = /\[data-([a-z0-9-]+)\s*[=\]]/g;
  const elements = (selector: string): string[] =>
    selector
      .split(',')
      .map((part) => collapse(part.replaceAll(/\[[^\]]*\]/g, '')))
      .filter(Boolean);

  const rolesByElement = new Map<string, Set<'fill' | 'text'>>();
  for (const [selector, block] of RULES) {
    const painted = block
      .split(';')
      .map((declaration) => paintedBy(declaration.split(':')[0]?.trim() ?? ''))
      .filter((role): role is 'fill' | 'text' => role !== null);
    if (painted.length === 0) continue;

    for (const element of elements(selector)) {
      const roles = rolesByElement.get(element) ?? new Set<'fill' | 'text'>();
      for (const role of painted) roles.add(role);
      rolesByElement.set(element, roles);
    }
  }

  const found = new Set<string>();
  for (const [selector] of RULES) {
    const attributes = [...selector.matchAll(ATTRIBUTE)].map(([, name]) => name as string);
    if (attributes.length === 0) continue;

    const paints = elements(selector).some((element) => {
      const roles = rolesByElement.get(element);
      return roles?.has('fill') === true && roles.has('text');
    });
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

/**
 * The same three tokens as individual elements: a cascade override targets one selector, not the
 * comma-separated group the base rule happens to be written as.
 */
const WRAPPING_ELEMENTS = [
  ...new Set(WRAPPING_TOKENS.flatMap((token) => token.split(',').map(collapse))),
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

    // Both guards below are `it.each` over these arrays, and vitest reports an emptied one as a
    // suite with fewer green cases rather than as a failure — the guard would go quiet exactly
    // the way the claims it watches went stale.
    expect(CLAIMS).toHaveLength(3);
    expect(WRAPPING_TOKENS).toHaveLength(3);
    expect(WRAPPING_ELEMENTS).toHaveLength(4);
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
  it.each(WRAPPING_TOKENS)('%s never breaks mid-token', (selector) => {
    // First, because `declarations` returns '' for a selector it cannot find and '' contains
    // nothing: without this line a renamed selector passes the assertion under it.
    expect(declarations(selector), `${selector} is no longer a rule in the stylesheet`).not.toBe('');

    expect(declarations(selector)).toContain('white-space: nowrap');
  });

  it.each(WRAPPING_ELEMENTS)('%s is not handed back its wrapping by another rule', (element) => {
    // Same reason as above, one level out: a scan that reaches no rule at all reports no
    // conflicting value either, and the assertion under it would agree with a deleted element.
    expect(
      reachingRules(element).length,
      `${element} is reached by no rule in the stylesheet`,
    ).toBeGreaterThan(0);

    // Reported as the offending values rather than as a boolean, so the failure names what the
    // overriding rule actually said.
    expect(
      whiteSpaceValues(element).filter((value) => value !== 'nowrap'),
      `${element} is handed a wrapping value other than nowrap by some rule reaching it`,
    ).toEqual([]);
  });
});

/**
 * The `--space-1..--space-9` scale, read out of the stylesheet rather than written down here, so
 * the scan compares against whatever the sheet actually defines. `:root` is the only definition
 * site today and the pattern is not anchored to it — a second one would be picked up too, which is
 * the behaviour this wants.
 *
 * This is a derivation, not a promise of adaptability: the non-vacuity `it` below pins the nine
 * numbers literally, so *editing* the scale still fails the suite until someone updates that list.
 * The pin is what makes a stubbed-empty CSS module fail instead of passing vacuously, and a scale
 * edit is exactly the moment a human should have to look at this guard.
 */
const SPACE_SCALE = new Map<number, string>(
  [...CSS.matchAll(/(--space-\d+)\s*:\s*(\d+)px/g)].map(([, token, px]) => [
    Number(px),
    token as string,
  ]),
);

/**
 * The properties whose values are spacing. Deliberately not "every property with a px in it":
 * a border width, a font size, a fixed `height` and a shadow offset all land on scale numbers
 * routinely and mean nothing by it, and a guard that swept them in would be turned off within a
 * week. `scroll-margin`/`scroll-padding` are in because they are the scroll box's version of the
 * same inset; `letter-spacing` is out despite the name — it spaces glyphs, not layout.
 */
const SPACING_PROPERTY =
  /^(?:(?:scroll-)?(?:margin|padding)(?:-[a-z]+)*|inset(?:-[a-z]+)*|(?:row-|column-)?gap|top|right|bottom|left)$/;

/** Signed, so `margin: 0 -8px` is read as the 8px step it cancels rather than skipped. */
const PX_VALUE = /-?\d+(?:\.\d+)?px/g;

/**
 * Every spacing declaration still holding a raw px that equals a scale step, as
 * `.selector { property: value }`.
 *
 * Off-scale values are not reported: after the conversion every raw px left in a spacing
 * declaration is deliberately off the scale and says so in an `optical:` comment beside it, so the
 * numeric test needs no exemption list. That is the property worth keeping — an exemption list
 * would have to be edited in step with the sheet, and nothing would fail when it was not.
 */
const unconvertedSpacing = (): string[] => {
  const offenders: string[] = [];
  for (const [selector, block] of RULES) {
    for (const declaration of block.split(';')) {
      const [property, ...rest] = declaration.split(':');
      const name = collapse(property ?? '').toLowerCase();
      const value = collapse(rest.join(':'));
      if (!SPACING_PROPERTY.test(name) || value === '') continue;

      for (const px of value.match(PX_VALUE) ?? []) {
        const token = SPACE_SCALE.get(Math.abs(Number.parseFloat(px)));
        if (token === undefined) continue;
        offenders.push(`${selector} { ${name}: ${value} } — ${px} is var(${token})`);
      }
    }
  }
  return offenders;
};

describe('spacing scale adoption', () => {
  it('reads the scale off the stylesheet, so the guard below is not comparing against nothing', () => {
    // Without this the whole block passes on a stubbed CSS module: an empty sheet has no rules to
    // scan and an empty scale matches no value, so `unconvertedSpacing()` returns `[]` either way.
    expect(SPACE_SCALE.size).toBe(9);
    expect([...SPACE_SCALE.keys()].sort((a, b) => a - b)).toEqual([4, 8, 12, 16, 20, 24, 32, 48, 64]);

    // And that the scan reaches real declarations — a `RULES` regex that stopped matching would
    // report no offenders as convincingly as a fully converted sheet.
    expect(RULES.length).toBeGreaterThan(100);
    expect(CSS).toContain('padding: var(--space-6)');
  });

  it('routes the spacing-bearing custom property through the scale too', () => {
    // `SPACING_PROPERTY` tests property names, so a custom property holding a spacing value is
    // invisible to it — `--column-inset` feeds the header, content and footer inline padding and
    // would carry a raw 24px back into all three with the scan still green. Asserted by name
    // rather than by widening the scan: `--radius-sm: 8px` and `--radius-lg: 20px` are on scale
    // numbers that mean nothing by it, and a predicate over every `--*: Npx` would fail on them.
    const inset = [...CSS.matchAll(/--column-inset\s*:\s*([^;]+)/g)].map(([, value]) =>
      collapse(value ?? ''),
    );
    expect(inset.length, '--column-inset is no longer defined in the stylesheet').toBeGreaterThan(0);
    // `match`, not `PX_VALUE.test`: the shared pattern is /g, and `test` on a /g regex advances
    // its own `lastIndex`, so consecutive calls would skip values and pass on a real raw px.
    expect(inset.filter((value) => (value.match(PX_VALUE) ?? []).length > 0)).toEqual([]);
  });

  it('routes every on-scale spacing value through its token', () => {
    // Reported as the offending declarations rather than as a count, so the failure names the
    // rule and the token it should have used instead of sending the reader back to grep.
    expect(unconvertedSpacing()).toEqual([]);
  });
});
