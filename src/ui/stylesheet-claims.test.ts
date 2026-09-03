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

/** A comment block, located in the file. */
type ScannedComment = { start: number; end: number; text: string };

/** A declaration, located in the file, with the selector of the rule that owns it. */
type ScannedDeclaration = {
  selector: string;
  property: string;
  value: string;
  /** Offset of the property name, and of the `;` or `}` that closes the declaration. */
  start: number;
  end: number;
  /** The owning rule's braces, so a comment can be tested for being inside them. */
  bodyStart: number;
  bodyEnd: number;
};

type ScannedRule = { selector: string; bodyStart: number; bodyEnd: number };

/**
 * One left-to-right scan of the stylesheet — the single place this suite decides what a *rule* and
 * a *declaration* are. Every guard that reasons about rules or declarations reads its output.
 *
 * `CSS` above survives alongside it for the `toContain` landmarks and the `--space-N` table, which
 * ask only whether a string is present and go red when it is not. It is not a parse and must not be
 * used as one: anything that has to decide a value is *absent* belongs on the scan. The
 * `--column-inset` guard was written against `CSS` and had exactly that bug — the property is
 * declared twice, so hiding one definition behind a quoted `/*` still satisfied a "declared at
 * least once" floor and the raw px it hid went unreported.
 *
 * It replaces a `/([^{}]*)\{([^{}]*)\}/g` match that four guards used to share. That pattern is
 * not a parser and had three blind spots, each of which let a raw px reach the sheet unseen or be
 * reported against a rule that does not exist:
 *
 * - a rule *containing* another block — native nesting (`&:hover { … }`) or a nested `@media` —
 *   had the declarations around that block swallowed into the inner selector and emitted by
 *   nothing;
 * - a `/*` inside a quoted value opened a comment nothing could tell from a real one, blanking
 *   through the next close and eating the `;` terminators after it;
 * - a `{` or `}` inside a quoted value broke the match, so the offender was named under a
 *   corrupted selector.
 *
 * The scan is stateful precisely where the regex could not be: it knows whether it is inside a
 * comment, inside a `'`/`"` string (backslash escapes honoured), and how deep it is in parens. The
 * paren depth is what stops `url(data:image/svg+xml;utf8,…)` from splitting a declaration in two,
 * and the string state is what stops `content: "a;b"` from doing the same.
 *
 * A block's `selector` is its own prelude, never a resolved ancestor chain. That is deliberate and
 * preserves `reachingRules`'s existing reading: a rule nested in an `@media` has always arrived
 * there as a plain selector, because an override is an override whichever block it sits in.
 *
 * **The residue that choice leaves.** A rule nested inside *another rule* — `.badge { @media … {
 * … } }`, or an `&`-prefixed selector — is reported under its own prelude, which for an at-rule is
 * not an element at all. `reachingRules` cannot match such a rule, and an offender inside one is
 * named `@media (…) { margin: 8px }`, a rule the reader cannot find. Its declarations *are*
 * scanned, so nothing goes unseen; only the attribution is coarse. Resolving ancestor chains is
 * the fix and it is recorded in `backlog.md`, not done here: it changes what `reachingRules`
 * matches, which is a different guard's decision rule and a different contract.
 */
const scan = (
  css: string,
): {
  comments: ScannedComment[];
  rules: ScannedRule[];
  declarations: ScannedDeclaration[];
  /**
   * What the scan ran off the end of — an unclosed comment, string, block or paren.
   *
   * This catches the whole class that ends the scan mid-way, which is what silently blinded every
   * guard before it existed. Empty is weaker than "the sheet is well formed": a construct can lose
   * sync and come back out balanced, and two such cases are known and recorded in `backlog.md`.
   * They are not equally contained, so do not read them as one:
   *
   * - a dropped `)` cancelled by a stray one later in the file is malformed CSS, and the build
   *   rejects it, so it cannot publish;
   * - an unquoted `url(…` holding a comment-open sequence is **valid CSS that builds**. The `/*`
   *   inside the url token is not a comment to a real parser, is one to this scan, and a later
   *   comment close ends it — swallowing the declarations in between. Nothing downstream stops it.
   *   The only reason it cannot reach the sheet today is that the sheet contains no `url(` at all.
   */
  unterminated: string[];
} => {
  const comments: ScannedComment[] = [];
  const rules: ScannedRule[] = [];
  const declarations: ScannedDeclaration[] = [];
  const unterminated: string[] = [];
  /** The open blocks, innermost last. `end` is filled in when the block closes. */
  const open: { selector: string; bodyStart: number; rule: number }[] = [];

  let index = 0;
  /** Where the current selector prelude or declaration began. */
  let pieceStart = 0;
  let parens = 0;
  /** Where the depth last left zero, so an unclosed `(` can be reported at a place, not a count. */
  let parenOpenedAt = -1;

  /**
   * The source between two offsets with any comment inside it removed.
   *
   * A comment can sit anywhere — above a selector, between a property and its value, after a
   * value — and every one of those slices is read as text. Cutting them here rather than blanking
   * the whole sheet first is what lets the offsets stay true to the file.
   */
  const between = (from: number, to: number): string => {
    let text = '';
    let at = from;
    for (const comment of comments) {
      if (comment.end <= from || comment.start >= to) continue;
      text += css.slice(at, Math.max(at, comment.start));
      at = Math.max(at, comment.end);
    }
    return text + css.slice(Math.min(at, to), to);
  };

  /**
   * The offset of the first character of real content in a range — whitespace and whole comments
   * skipped. Derived from the source rather than from the comment-stripped slice, because the
   * annotation guard compares this against comment offsets and a length arrived at by subtraction
   * would land inside whatever comment preceded the property.
   */
  const contentStart = (from: number, to: number): number => {
    let at = from;
    while (at < to) {
      const comment = comments.find((candidate) => candidate.start <= at && at < candidate.end);
      if (comment !== undefined) {
        at = comment.end;
        continue;
      }
      if (!/\s/.test(css[at] ?? '')) return at;
      at += 1;
    }
    return from;
  };

  /** Flush the text since the last boundary as a declaration of the innermost open block. */
  const flush = (end: number): void => {
    const frame = open.at(-1);
    const piece = between(pieceStart, end);
    const pieceOffset = pieceStart;
    pieceStart = end + 1;
    // `@import`/`@charset` end in `;` at top level and are preludes, not declarations. Testing the
    // first non-space character rather than the whole piece keeps a value containing `@` out of it.
    if (frame === undefined || piece.trimStart().startsWith('@')) return;

    // The FIRST colon outside parens and strings: `background: url(a:b)` splits once, at `background`.
    let colon = -1;
    let depth = 0;
    let quote = '';
    for (let at = 0; at < piece.length; at += 1) {
      const char = piece[at];
      if (quote !== '') {
        if (char === '\\') at += 1;
        else if (char === quote) quote = '';
      } else if (char === "'" || char === '"') quote = char;
      else if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      else if (char === ':' && depth === 0) {
        colon = at;
        break;
      }
    }
    if (colon === -1) return;

    const property = collapse(piece.slice(0, colon));
    if (property === '') return;
    declarations.push({
      selector: frame.selector,
      property,
      value: collapse(piece.slice(colon + 1)),
      start: contentStart(pieceOffset, end),
      end,
      bodyStart: frame.bodyStart,
      // Filled in below; a declaration cannot know where its rule ends until the rule closes.
      bodyEnd: -1,
    });
  };

  while (index < css.length) {
    const char = css[index];

    if (char === '/' && css[index + 1] === '*') {
      const close = css.indexOf('*/', index + 2);
      const end = close === -1 ? css.length : close + 2;
      if (close === -1) unterminated.push(`comment opened at ${index}`);
      comments.push({ start: index, end, text: css.slice(index, end) });
      index = end;
      continue;
    }

    if (char === "'" || char === '"') {
      const opened = index;
      index += 1;
      // A CSS string cannot span a raw newline, so a run that reaches one is not a string at all —
      // it is a typo. Stopping there keeps a stray quote from eating the rest of the file, which is
      // what an unbounded run did: every later brace and semicolon vanished and the guards went
      // quiet on a sheet they could no longer read.
      while (index < css.length && css[index] !== char && css[index] !== '\n') {
        index += css[index] === '\\' ? 2 : 1;
      }
      if (index >= css.length || css[index] === '\n') unterminated.push(`string opened at ${opened}`);
      index += 1;
      continue;
    }

    // A backslash escapes the next character anywhere, not only inside a string: `--x: \(;` is a
    // literal paren and must not open one, or the `;` and `}` after it are read as still inside it.
    if (char === '\\') {
      index += 2;
      continue;
    }

    if (char === '(') {
      if (parens === 0) parenOpenedAt = index;
      parens += 1;
    } else if (char === ')') parens = Math.max(0, parens - 1);

    // No resynchronising here. Forcing the paren depth back to zero at a brace was tried and
    // removed: it manufactured a closed block out of a sheet the scan could not follow, taking the
    // report's own block arm out with it. What replaces it is not the block stack but the depth
    // check at the end of the scan — a `(` that never closes is reported as itself.
    if (parens === 0 && char === '{') {
      const selector = collapse(between(pieceStart, index));
      open.push({ selector, bodyStart: index + 1, rule: rules.length });
      rules.push({ selector, bodyStart: index + 1, bodyEnd: -1 });
      pieceStart = index + 1;
    } else if (parens === 0 && char === '}') {
      flush(index);
      const frame = open.pop();
      if (frame !== undefined) {
        // The frame carries its own index rather than taking the most recent rule: with nesting,
        // `rules.at(-1)` is the *inner* rule at the moment the outer one closes.
        const rule = rules[frame.rule];
        if (rule !== undefined) rule.bodyEnd = index;
        for (const declaration of declarations) {
          if (declaration.bodyEnd === -1 && declaration.bodyStart === frame.bodyStart) {
            declaration.bodyEnd = index;
          }
        }
      }
      pieceStart = index + 1;
    } else if (parens === 0 && char === ';') {
      flush(index);
    }

    index += 1;
  }
  for (const frame of open) {
    unterminated.push(`block opened at ${frame.bodyStart - 1} (${frame.selector || '?'})`);
  }
  // The paren axis, reported in its own right rather than through the block stack. Two earlier
  // attempts each covered half of it: resetting the depth at a brace hid an unclosed *block*, and
  // removing that reset hid an unbalanced `(` in a prelude, where no block is open to go unclosed
  // — `@media (min-width: 40rem {` is the likeliest typo in the family and had no arm at all.
  if (parens !== 0) unterminated.push(`( opened at ${parenOpenedAt}, depth ${parens} at end`);
  return { comments, rules, declarations, unterminated };
};

const SHEET = scan(source(STYLESHEET_PATH));

/**
 * Every rule in the sheet as `[selector, declarations]`, the declarations rejoined from the scan.
 *
 * Rebuilt rather than sliced out of the source so the consumers below keep reading one normalised
 * shape — `prop: value; prop: value` — whatever the layout in the file. A rule that contains a
 * nested block now carries its own declarations here; under the brace regex they belonged to
 * nothing.
 */
const RULES: [string, string][] = SHEET.rules
  .map((rule): [string, string] => [
    rule.selector,
    SHEET.declarations
      .filter((declaration) => declaration.bodyStart === rule.bodyStart)
      .map(({ property, value }) => `${property}: ${value}`)
      .join('; '),
  ])
  // An at-rule that owns no declarations is a container — `@media`, `@supports` — and holds rules
  // rather than being one. The brace regex never emitted these, because their braces are not the
  // innermost pair, and the three guards reading `RULES` were written against that shape. An
  // at-rule that *does* own declarations (`@font-face`) is a rule and stays.
  .filter(([selector, block]) => !selector.startsWith('@') || block !== '');

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
 * Every rule in the sheet whose selector reaches `element`, `@media` blocks included: a rule's
 * selector is its own prelude and never a resolved ancestor chain, so one nested in a media block
 * arrives here as a plain selector, indistinguishable from a top-level one. That is what this
 * guard wants — an override is an override whichever block it sits in.
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
  for (const { selector, property, value } of SHEET.declarations) {
    const name = property.toLowerCase();
    if (!SPACING_PROPERTY.test(name) || value === '') continue;

    for (const px of value.match(PX_VALUE) ?? []) {
      const token = SPACE_SCALE.get(Math.abs(Number.parseFloat(px)));
      if (token === undefined) continue;
      offenders.push(`${selector} { ${name}: ${value} } — ${px} is var(${token})`);
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
    // invisible to it — `--column-inset` feeds the header, content and provenance inline padding and
    // would carry a raw 24px back into all three with the scan still green. Asserted by name
    // rather than by widening the scan: `--radius-sm: 8px` and `--radius-lg: 20px` are on scale
    // numbers that mean nothing by it, and a predicate over every `--*: Npx` would fail on them.
    // Read off the scan, not off `CSS`: the naive masker behind `CSS` cannot tell a `/*` inside a
    // quoted value from a real comment, and this property is defined twice — so a hidden definition
    // left the other one satisfying a `length > 0` floor and the guard passed on a raw px it could
    // no longer see. The scan knows what a string is; the exact count is pinned for the same reason
    // a floor was not enough.
    const inset = SHEET.declarations.filter(({ property }) => property === '--column-inset');
    expect(inset.length, '--column-inset is defined a different number of times now').toBe(2);
    // `match`, not `PX_VALUE.test`: the shared pattern is /g, and `test` on a /g regex advances
    // its own `lastIndex`, so consecutive calls would skip values and pass on a real raw px.
    expect(
      inset.filter(({ value }) => (value.match(PX_VALUE) ?? []).length > 0).map(({ value }) => value),
    ).toEqual([]);
  });

  it('routes every on-scale spacing value through its token', () => {
    // Reported as the offending declarations rather than as a count, so the failure names the
    // rule and the token it should have used instead of sending the reader back to grep.
    expect(unconvertedSpacing()).toEqual([]);
  });
});
/**
 * The marker has to *open* the comment or one of its lines.
 *
 * A bare `includes('optical:')` reads any prose that mentions the convention as an annotation — the
 * `--space-*` docblock in `:root` says the words "carries an `optical:` comment", and counting it
 * would let the rule's own statement license the next violation of it. Opening a line is the
 * weakest test that separates "this comment is the annotation" from "this comment is about
 * annotations", and it still admits one written under a sentence that explains something else.
 */
const OPTICAL_MARKER = /(?:^\/\*|\n)[ \t*]*optical:/;

/** The scan's comments, tagged with whether each is an annotation. */
const COMMENTS = SHEET.comments.map(({ start, end, text }) => ({
  start,
  end,
  optical: OPTICAL_MARKER.test(text),
}));

/** Every spacing declaration holding a raw px, as the scan found it. */
const rawSpacingDeclarations = SHEET.declarations.filter(
  ({ property, value }) =>
    SPACING_PROPERTY.test(property.toLowerCase()) && (value.match(PX_VALUE) ?? []).length > 0,
);

/**
 * Every raw-px spacing declaration, split by whether it is annotated.
 *
 * One rule, and it is deliberately the strictest one available: a declaration is annotated when
 * the comment **immediately** before it — inside the same rule body, with no other declaration in
 * between — opens with the marker. Nothing else counts.
 *
 * Three looser readings were tried first and each was broken by adversarial review, always the
 * same way: they asked where a comment *sits* rather than what it *covers*, and proximity is
 * forgeable. Letting a comment on the declaration's own line count meant a new value could steal
 * a real annotation written for the declaration below it by joining its line. Letting one comment
 * cover a run of raw-px declarations meant a new value inserted directly under an annotated one —
 * the most natural place to add spacing — was covered by a sentence about a different value. Both
 * turned all fifteen of the sheet's existing annotations into reusable licences.
 *
 * The cost is that a shared comment no longer covers a pair: `padding: 6px 0` and the
 * `scroll-padding: 6px 0` under it each carry their own. That is the right trade — a guard whose
 * job is to catch the value nobody explained cannot also decide that some values need no
 * explanation of their own.
 *
 * Strict in one direction worth naming: *any* other comment between the annotation and its
 * declaration breaks the adjacency, so a `TODO` slipped in there turns the rule red. That is the
 * cost of the rule being decidable, and it is the safe direction to be wrong in.
 *
 * What it still cannot catch: a comment that opens with the marker and then explains nothing, or
 * explains the wrong thing. No test can read a sentence. This checks that an explanation was
 * written where one was owed, which is the part a machine can own.
 *
 * Any raw px, not only an off-scale one: an on-scale value already fails the guard above, and
 * making this one scale-aware would let a value stay unexplained for as long as it sat on a step.
 * The two guards answer one question each — *is it a token*, and *does the reader learn why not*.
 */
const rawSpacingByAnnotation = (): { annotated: string[]; bare: string[] } => {
  const annotated: string[] = [];
  const bare: string[] = [];

  for (const declaration of rawSpacingDeclarations) {
    /**
     * The blocks nested inside this declaration's own rule. A comment in one of them belongs to
     * that block, not here — an `optical:` note at the tail of an `&:hover` would otherwise become
     * the `preceding` comment for the parent's next value, and license it. Only reachable at all
     * because the scan understands nesting; the brace regex emitted the parent declaration from
     * nothing, so the shape could not arise.
     */
    // `bodyEnd` is -1 for a block the scan never saw close. Treating that as "ends after
    // everything" keeps an unclosed parent from making its nested blocks unrecognisable, which
    // would let their comments license the parent again. The suite already fails on such a sheet
    // (`SHEET.unterminated`), so this is the second lock on the same door, not the only one.
    const bodyEnd = declaration.bodyEnd === -1 ? Number.MAX_SAFE_INTEGER : declaration.bodyEnd;
    const nested = SHEET.rules.filter(
      (rule) => rule.bodyStart > declaration.bodyStart && rule.bodyEnd <= bodyEnd,
    );
    const preceding = COMMENTS.filter(
      ({ start, end }) =>
        start >= declaration.bodyStart &&
        end <= declaration.start &&
        !nested.some((rule) => start >= rule.bodyStart && end <= rule.bodyEnd),
    ).at(-1);
    const covered =
      preceding?.optical === true &&
      // Nothing declared between the comment and this declaration — otherwise the comment is the
      // previous one's, and this value is riding an explanation written about something else.
      // Compared on the earlier declaration's *end*: one written with no gap after the comment
      // starts exactly at `preceding.end`, and a `start >` test would not see it as intervening.
      !SHEET.declarations.some(
        ({ start, end }) => end > preceding.end && start < declaration.start,
      );

    (covered ? annotated : bare).push(
      `${declaration.selector} { ${declaration.property}: ${declaration.value} }`,
    );
  }
  return { annotated, bare };
};

describe('optical spacing annotations', () => {
  it('parsed the whole sheet, so no guard is reasoning about a file it stopped reading', () => {
    // The one assertion that makes every other guard in this file trustworthy. A hand-written scan
    // meets malformed input by losing sync — a quote, comment, block or paren that never closes —
    // and each of those used to end with the scan silently reading nothing for the rest of the file
    // while every guard reported green. Rather than patching the shapes one at a time, the scan now
    // says how it ended, and that is checked here. It does not catch a construct that loses sync
    // and is rebalanced later by an unrelated one; `backlog.md` carries those.
    expect(SHEET.unterminated).toEqual([]);
  });

  it('scanned the sheet, so the guard below is not answering about an empty file', () => {
    // A stubbed-empty CSS module would give the guard nothing to find and no annotation to miss,
    // so it would pass on nothing. Each of these fails on that sheet.
    expect(COMMENTS.filter(({ optical }) => optical).length).toBeGreaterThan(5);
    expect(rawSpacingDeclarations.length).toBeGreaterThan(10);
    expect(rawSpacingByAnnotation().annotated.length).toBeGreaterThan(10);
  });

  it('does not read a comment about the convention as an annotation', () => {
    // The `--space-*` docblock states the rule and sits in `:root`, which has declarations under
    // it. Counted, the statement of the rule would license the next breach of it.
    const scale =
      SHEET.comments.find(({ text }) =>
        text.includes('Off-scale values are legal but never silent'),
      )?.text ?? '';
    expect(scale, 'the scale docblock no longer states the rule').toContain('optical:');
    expect(OPTICAL_MARKER.test(scale)).toBe(false);
  });

  it('explains every raw px left in a spacing declaration', () => {
    // The other half of the rule the `--space-*` scale states. A raw px that survives conversion is
    // off the scale on purpose, and the only place that intent can live is a comment beside it —
    // without this the sentence in `:root` claiming so is an assertion nothing checks, and it was
    // already false once, in the commit that introduced it.
    expect(rawSpacingByAnnotation().bare).toEqual([]);
  });
});
