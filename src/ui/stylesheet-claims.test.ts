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
  /** Index into `rules` of the block this declaration was written in. */
  rule: number;
  /** Offset of the property name, and of the `;` or `}` that closes the declaration. */
  start: number;
  end: number;
  /** The owning rule's braces, so a comment can be tested for being inside them. */
  bodyStart: number;
  bodyEnd: number;
};

type ScannedRule = {
  /** The block's own prelude, as written — `@media (…)` for an at-rule, `&:hover` for a nested rule. */
  prelude: string;
  /**
   * Whether this block, or any block enclosing it, is an at-rule — so its declarations apply only
   * when that condition holds.
   *
   * Carried down the open stack rather than read off the prelude, because both nesting directions
   * produce a plain selector on the block that owns the declarations: `@media (…) { .x { … } }`
   * and `.x { @media (…) { … } }` alike. A reader asking "is this declared unconditionally" cannot
   * answer it from one block's own prelude.
   */
  conditional: boolean;
  /** The prelude resolved against the ancestor chain: the element this block actually styles. */
  selector: string;
  bodyStart: number;
  bodyEnd: number;
  /**
   * Half-open index ranges into the scan's own arrays, recorded as the block opens and closes:
   * `[firstDeclaration, endDeclaration)` covers every declaration written inside this block —
   * its own and its nested blocks' — and `[index + 1, endRule)` covers every block nested in it.
   *
   * Both are what let a reader address this rule instead of the sheet. Three readers used to walk
   * every declaration for every rule: the `bodyEnd` backfill below, `RULES`, and the annotation
   * guard's adjacency test. Nothing was slow because of it, but each of the three asks a question
   * about one rule, and a scan of the whole sheet is not that question — it happens to give the
   * same answer only because the discriminating field is unique per block.
   *
   * `-1` on either end means the block never closed, which only a malformed sheet produces. The
   * readers treat it as "runs to the end", so an unclosed block cannot hide its own contents.
   */
  firstDeclaration: number;
  endDeclaration: number;
  endRule: number;
};

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
 * and the string state is what stops `content: "a;b"` from doing the same. An *unquoted* url token
 * needs more than depth — its contents are opaque to a real parser, so a `/*` or a `;` in there
 * means nothing — and it is skipped whole, to its matching `)`.
 *
 * A block carries both its own `prelude` and the `selector` that prelude resolves to against the
 * blocks enclosing it — see `resolveSelector`. The distinction is what lets two readers ask
 * different questions of the same block: `RULES` asks the prelude whether a block is an at-rule
 * *container*, while `reachingRules` and every offender message ask the selector which element the
 * block styles.
 *
 * Resolution leaves the top-level reading untouched, which is the constraint it had to meet: a
 * rule inside a top-level `@media` still arrives as its plain selector, and a top-level at-rule
 * still carries its own `@…` prelude as its selector. What it fixes is the rule nested inside
 * *another rule* — `.badge { @media … { … } }`, or an `&`-prefixed selector. That block used to be
 * reported under its own prelude, which for an at-rule is not an element at all: an offender in it
 * was named `@media (…) { margin: 8px }`, a rule the reader cannot find, and `reachingRules` could
 * not see the override at all. Nothing went *unseen* even then — the declarations were scanned —
 * but the attribution named nothing.
 */
/** The code points a url token may not hold unescaped, per the url-token grammar. */
const nonPrintable = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return code <= 8 || code === 11 || (code >= 14 && code <= 31) || code === 127;
};

/**
 * The unquoted url token starting at `start`, or `null` when this is not one.
 *
 * `null` means a quoted `url("…")`, which is an ordinary function token: its string must be read
 * normally, so a `)` inside the quotes ends nothing. Everything else is a url token, whose
 * contents are one opaque blob to a real parser — a `/*`, a `;` and a `{` in there are all just
 * characters. Reading them as syntax is what let a url swallow the declarations after it with
 * nothing reported, so the scan skips the whole token to the `)` this returns.
 *
 * `problem` is non-null when the token is malformed — a *bad url* (whitespace or a quote inside
 * it) or one that runs to the end of the file. A real parser also consumes a bad url to its `)`
 * and then throws the declaration away, so skipping it keeps the scan in step with the build
 * while still naming the sheet as unreadable. The alternative, falling through to the paren
 * handling, was worse in both directions: it reported the `(` of a *valid* url holding a `{`, and
 * it left a real bad url unnamed.
 *
 * Follows CSS Syntax Level 3 §4.3.6 (consume a url token) and §4.3.14 (consume the remnants of a
 * bad url), which is what makes the set of characters a url may hold a rule rather than a guess:
 * only whitespace not immediately before the `)`, a quote, a `(`, a non-printable, and an invalid
 * escape end it early. `;`, `{` and `}` are ordinary content.
 */
const urlToken = (
  css: string,
  start: number,
): { end: number; problem: string | null } | null => {
  /** §4.3.14: everything up to the first unescaped `)`, which is where the parser resumes too. */
  const bad = (from: number): { end: number; problem: string } => {
    let at = from;
    while (at < css.length) {
      if (css[at] === '\\') {
        at += 2;
        continue;
      }
      if (css[at] === ')') return { end: at, problem: `bad url( opened at ${start}` };
      at += 1;
    }
    return { end: css.length, problem: `url( opened at ${start}` };
  };

  let at = start + 4;
  while (at < css.length && /\s/.test(css[at] ?? '')) at += 1;
  if (css[at] === '"' || css[at] === "'") return null;

  while (at < css.length) {
    const char = css[at] ?? '';
    if (char === ')') return { end: at, problem: null };
    if (/\s/.test(char)) {
      // Whitespace is allowed only as padding before the close.
      while (at < css.length && /\s/.test(css[at] ?? '')) at += 1;
      return css[at] === ')' ? { end: at, problem: null } : bad(at);
    }
    if (char === '\\') {
      // A backslash at the end of the file or before a newline is not a valid escape.
      if (at + 1 >= css.length || css[at + 1] === '\n') return bad(at + 1);
      at += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === '(' || nonPrintable(char)) return bad(at + 1);
    at += 1;
  }
  return { end: css.length, problem: `url( opened at ${start}` };
};

/**
 * A selector split at the **top-level** characters `separates` accepts — the ones outside every
 * `(…)`, `[…]`, quoted string and backslash escape.
 *
 * One scan, two separators. `selectorParts` wants top-level commas; `target` wants top-level
 * combinators, and it used a bare `.split(/[\\s>+~]+/)` that ended a compound at the first
 * combinator inside `:is(…)`. Spelling the depth-and-quote state a second time is how the two
 * readers drifted apart in the first place, so the state lives here and the callers differ only
 * in which character ends a piece.
 */
const splitTopLevel = (selector: string, separates: (char: string) => boolean): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let at = 0; at < selector.length; at += 1) {
    const char = selector[at] ?? '';
    if (char === '\\') {
      // A backslash escapes the next character wherever it stands, not only inside a quote:
      // `.a\\,b` is one class whose name contains a comma, and splitting it yields two selectors
      // that match nothing. CSS gives the escape the same meaning in both places, so does this.
      at += 1;
    } else if (quote !== '') {
      if (char === quote) quote = '';
    } else if (char === "'" || char === '"') quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (depth === 0 && separates(char)) {
      parts.push(selector.slice(start, at));
      start = at + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== '');
};

/**
 * A selector list split at its **top-level** commas — the ones that separate selectors, not the
 * ones inside `:is(…)`, `:not(…)`, `:where(…)`, `:nth-child(…)` or a quoted attribute value.
 *
 * A bare `.split(',')` reads `:not(.b, .c) .d` as two selectors and every reader of a selector
 * here made that mistake. It is the same depth-and-quote state `flush` already tracks to find a
 * declaration's first top-level colon, and it is spelled out once rather than a third time.
 */
const selectorParts = (selector: string): string[] =>
  splitTopLevel(selector, (char) => char === ',');

/** The index just past the `)`/`]` that closes the run opened at `open`. */
const closeAt = (text: string, open: number): number => {
  let depth = 0;
  let quote = '';
  for (let at = open; at < text.length; at += 1) {
    const char = text[at] ?? '';
    if (char === '\\') at += 1;
    else if (quote !== '') {
      if (char === quote) quote = '';
    } else if (char === "'" || char === '"') quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') {
      depth -= 1;
      if (depth === 0) return at + 1;
    }
  }
  return text.length;
};

const COMBINATOR = /[\s>+~]/;

/**
 * The compound a selector part actually styles — its **subject** — with everything that names
 * some *other* element removed.
 *
 * Taking the last top-level compound is only half of it. `.x:is(.badge .y)` styles a `.y` that
 * has a `.badge` ancestor; the compound holds the token `.badge` and names it about an ancestor,
 * so a guard that stopped at the compound would report a rule as an override of `.badge` that
 * never touches one. Inside a functional pseudo-class only each argument's own subject applies
 * to the element, which is this same reduction one level down — hence the recursion.
 *
 * Three kinds of run are dropped rather than reduced:
 *
 * - `:not(…)` states what the subject is *not*. `.foo:not(.badge)` is the one form that names a
 *   class in order to exclude it, and dropping the run is the behaviour this helper has always
 *   had.
 * - `:has(…)` states what the subject *contains*, so `.foo:has(.badge)` styles `.foo`.
 * - `[…]` holds an attribute name and an arbitrary quoted value. `[data-x=".badge"]` names a
 *   class only as text.
 */
const reduceCompound = (compound: string): string => {
  let out = '';
  let at = 0;
  while (at < compound.length) {
    const char = compound[at] ?? '';
    if (char === '\\') {
      out += compound.slice(at, at + 2);
      at += 2;
      continue;
    }
    if (char === '[') {
      at = closeAt(compound, at);
      continue;
    }
    const functional = char === ':' ? /^::?(-{0,2}[\w-]+)\(/.exec(compound.slice(at)) : null;
    if (functional) {
      const open = at + functional[0].length - 1;
      const end = closeAt(compound, open);
      const name = (functional[1] ?? '').toLowerCase();
      if (name !== 'not' && name !== 'has') {
        const inner = selectorParts(compound.slice(open + 1, end - 1)).map(subjectOf);
        out += `${functional[0]}${inner.join(', ')})`;
      }
      at = end;
      continue;
    }
    out += char;
    at += 1;
  }
  return out;
};

/** `reduceCompound` of the last top-level compound of `part`. */
function subjectOf(part: string): string {
  return reduceCompound(splitTopLevel(part, (char) => COMBINATOR.test(char)).pop() ?? '');
}

/**
 * A block's prelude resolved against the block it is written in — the element it actually styles.
 *
 * Three cases, and the first is the one that had to be preserved rather than invented:
 *
 * - **No enclosing rule** (top level, or inside an at-rule that is itself at top level): the
 *   prelude stands as written. A rule inside a top-level `@media` has always arrived at
 *   `reachingRules` as a plain selector, because an override is an override whichever viewport it
 *   applies at, and a top-level at-rule keeps its own `@…` prelude so `RULES` can still tell a
 *   container from a rule.
 * - **An at-rule inside a rule** — `.badge { @media (…) { … } }`: the at-rule styles nothing of its
 *   own, so the enclosing rule's resolved selector passes straight through. Its declarations then
 *   belong to `.badge`, which is what CSS nesting means by them and what a reader can go and find.
 * - **A rule inside a rule**: every parent part crossed with every prelude part — `&` substituted
 *   where written, a bare compound made a descendant of it.
 *
 * **Distributed, not wrapped in `:is(…)`.** Wrapping was the first spelling and it was wrong in a
 * way the sheet would never have shown: `.a, .b { & .c { … } }` became `:is(.a, .b) .c`, one string
 * holding a comma that is *not* a selector separator. Every reader downstream then split it into
 * `:is(.a` and `.b) .c`, and `reaches('.a', …)` matched the fragment — a rule that styles `.c`
 * reported as an override of `.a`. Distribution emits `.a .c, .b .c`, which matches the same
 * elements with no comma that means anything else. Equivalent for *matching*, which is all any
 * guard here asks: the two forms differ in specificity, and nothing in this suite reads that.
 */
const resolveSelector = (prelude: string, parent: string | undefined): string => {
  if (parent === undefined || parent.startsWith('@')) return prelude;
  if (prelude.startsWith('@')) return parent;
  return selectorParts(parent)
    .flatMap((reference) =>
      selectorParts(prelude).map((part) =>
        part.includes('&') ? part.replaceAll('&', reference) : `${reference} ${part}`,
      ),
    )
    .join(', ');
};

const scan = (
  css: string,
): {
  comments: ScannedComment[];
  rules: ScannedRule[];
  declarations: ScannedDeclaration[];
  /**
   * What the scan lost sync on — an unclosed comment, string, block or paren, and a `(` that
   * outlived the block it opened in.
   *
   * The end-of-scan checks catch the whole class that ends the scan mid-way, which is what
   * silently blinded every guard before they existed. On their own they were weaker than "the
   * sheet is well formed", because a construct can lose sync and be brought back to a settled
   * state by an unrelated one later in the file — the depth reads zero at the end and every
   * declaration in between has been merged into one and dropped. Two such shapes were known:
   *
   * - a dropped `)` cancelled by a stray one in a later rule. Now reported where it happens: a
   *   `(` still open at a `{` or `}` never closed inside its own block, and no valid CSS does
   *   that.
   * - an unquoted `url(…` holding a comment-open sequence, which is **valid CSS that builds** —
   *   the `/*` inside the url token is not a comment to a real parser, and a later real comment
   *   close ended the one this scan opened, swallowing the declarations in between. Now closed at
   *   the source: the url token is skipped whole, so nothing inside it is read at all. A url
   *   the grammar rejects is skipped the same way a parser skips it, and named here as a bad url.
   */
  unterminated: string[];
} => {
  const comments: ScannedComment[] = [];
  const rules: ScannedRule[] = [];
  const declarations: ScannedDeclaration[] = [];
  const unterminated: string[] = [];
  /** The open blocks, innermost last. `end` is filled in when the block closes. */
  const open: {
    prelude: string;
    selector: string;
    conditional: boolean;
    bodyStart: number;
    rule: number;
  }[] = [];

  let index = 0;
  /** Where the current selector prelude or declaration began. */
  let pieceStart = 0;
  /**
   * The offsets of the `(`s currently open, innermost last; its length is the paren depth.
   *
   * Offsets rather than a counter so an unclosed `(` is reported at a place, and so the block
   * check below can name *which* paren outlived its block.
   */
  const parenOpens: number[] = [];
  /**
   * Every `(` already reported as outliving its block, so one offender yields one entry.
   *
   * A set, not the last offset: with two offenders open at once the inner one is reported, popped,
   * and the outer one then looks new again at the next brace, so a scalar reports it twice.
   */
  const parenReported = new Set<number>();

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
      rule: frame.rule,
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

    // An unquoted `url(…)` is one token to a real parser: the `/*` in
    // `url(http://example.com/*a.png)` opens no comment and a `;` in there ends no declaration.
    // Read character by character it does both, and the comment a later real `*/` closes swallows
    // every declaration in between — valid CSS that builds, and `unterminated` stays empty because
    // the comment did close. Skipping such a token whole makes its contents opaque, which is what
    // they are.
    //
    // A malformed one is skipped too, and named: `url(a;` is a bad url, which a real parser also
    // consumes to its `)` before discarding the declaration. Falling through to the paren handling
    // instead was wrong in both directions — it reported the `(` of a *valid* url holding a `{`,
    // and left a real bad url unnamed. A quoted `url("…")` is not a url token at all and does
    // fall through, so a `)` inside the quotes still ends nothing. See `urlToken`.
    if (
      (char === 'u' || char === 'U') &&
      /^url\(/i.test(css.slice(index, index + 4)) &&
      // Not preceded by an identifier character, or `--brand-url(` would be read as a url token.
      !/[\w-]/.test(css[index - 1] ?? '')
    ) {
      const token = urlToken(css, index);
      if (token !== null) {
        if (token.problem !== null) unterminated.push(token.problem);
        index = token.end + 1;
        continue;
      }
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

    if (char === '(') parenOpens.push(index);
    else if (char === ')') parenOpens.pop();

    // A `(` still open at a block boundary never closed inside the block it opened in, and no
    // valid CSS leaves one there. Reported here rather than at the end of the scan because a
    // stray `)` in a later rule cancels the depth: by the end the sheet looks balanced, while
    // every declaration between the two has been merged into one and lost. Recorded once per
    // offending `(`, so a sheet with one typo does not produce an entry per later brace.
    if (parenOpens.length > 0 && (char === '{' || char === '}')) {
      const opened = parenOpens[parenOpens.length - 1] ?? -1;
      if (!parenReported.has(opened)) {
        parenReported.add(opened);
        unterminated.push(`( opened at ${opened}, still open at ${char} at ${index}`);
      }
    }

    // No resynchronising here. Forcing the paren depth back to zero at a brace was tried and
    // removed: it manufactured a closed block out of a sheet the scan could not follow, taking the
    // report's own block arm out with it. What replaces it is not the block stack but the depth
    // check at the end of the scan — a `(` that never closes is reported as itself.
    if (parenOpens.length === 0 && char === '{') {
      const prelude = collapse(between(pieceStart, index));
      const parent = open.at(-1);
      const selector = resolveSelector(prelude, parent?.selector);
      const conditional = prelude.startsWith('@') || parent?.conditional === true;
      open.push({ prelude, selector, conditional, bodyStart: index + 1, rule: rules.length });
      rules.push({
        prelude,
        selector,
        conditional,
        bodyStart: index + 1,
        bodyEnd: -1,
        firstDeclaration: declarations.length,
        endDeclaration: -1,
        endRule: -1,
      });
      pieceStart = index + 1;
    } else if (parenOpens.length === 0 && char === '}') {
      flush(index);
      const frame = open.pop();
      if (frame !== undefined) {
        // The frame carries its own index rather than taking the most recent rule: with nesting,
        // `rules.at(-1)` is the *inner* rule at the moment the outer one closes.
        const rule = rules[frame.rule];
        if (rule !== undefined) {
          rule.bodyEnd = index;
          rule.endDeclaration = declarations.length;
          rule.endRule = rules.length;
          // From this block's first declaration, not from the sheet's. Everything before that
          // index was flushed before the block opened and cannot be waiting on this brace. The
          // `bodyStart` test stays: a declaration inside a nested block that never closed is
          // still in this range with `bodyEnd === -1`, and it is not this frame's to fill.
          for (let at = rule.firstDeclaration; at < declarations.length; at += 1) {
            const declaration = declarations[at];
            if (
              declaration !== undefined &&
              declaration.bodyEnd === -1 &&
              declaration.bodyStart === frame.bodyStart
            ) {
              declaration.bodyEnd = index;
            }
          }
        }
      }
      pieceStart = index + 1;
    } else if (parenOpens.length === 0 && char === ';') {
      flush(index);
    }

    index += 1;
  }
  for (const frame of open) {
    unterminated.push(`block opened at ${frame.bodyStart - 1} (${frame.prelude || '?'})`);
  }
  // The paren axis, reported in its own right rather than through the block stack. Two earlier
  // attempts each covered half of it: resetting the depth at a brace hid an unclosed *block*, and
  // removing that reset hid an unbalanced `(` in a prelude, where no block is open to go unclosed
  // — `@media (min-width: 40rem {` is the likeliest typo in the family and had no arm at all.
  // This arm is what catches a `(` in a prelude, where no brace follows inside its own block; the
  // block-boundary check above is what catches one that a later stray `)` would have cancelled.
  // Only what the block check has not already named — a `(` that outlived its block *and* ran to
  // the end of the file is one fault, and reporting it twice is noise in the one place a reader
  // goes to find out what the scan could not read.
  const unreportedOpens = parenOpens.filter((opened) => !parenReported.has(opened));
  if (unreportedOpens.length > 0) {
    unterminated.push(`( opened at ${unreportedOpens[0]}, depth ${parenOpens.length} at end`);
  }
  return { comments, rules, declarations, unterminated };
};

/** One scanned stylesheet. Named so the readers below can take a synthetic one in a test. */
type ScannedSheet = ReturnType<typeof scan>;

const SHEET = scan(source(STYLESHEET_PATH));

/**
 * Every rule in the sheet as `[selector, declarations]`, the declarations rejoined from the scan.
 *
 * Rebuilt rather than sliced out of the source so the consumers below keep reading one normalised
 * shape — `prop: value; prop: value` — whatever the layout in the file. A rule that contains a
 * nested block now carries its own declarations here; under the brace regex they belonged to
 * nothing.
 */
/**
 * The declarations the scan recorded inside `rule` — its own and its nested blocks'.
 *
 * A slice of the recorded range rather than a filter over the sheet. `-1` is the unclosed-block
 * marker (see `ScannedRule`) and reads as "to the end", so a malformed sheet still surfaces every
 * declaration it holds rather than none.
 */
const spanOf = (sheet: ScannedSheet, rule: ScannedRule): ScannedDeclaration[] =>
  sheet.declarations.slice(
    rule.firstDeclaration,
    rule.endDeclaration === -1 ? sheet.declarations.length : rule.endDeclaration,
  );

/**
 * The blocks nested inside one rule of `sheet`, identified by its index in `sheet.rules`.
 *
 * Every block opened after this one and before it closed is nested in it, which is exactly the
 * recorded rule range — the offset comparison it replaces (`bodyStart` after, `bodyEnd` at or
 * before) selects the same blocks by arithmetic over the whole sheet.
 */
const nestedIn = (sheet: ScannedSheet, index: number): ScannedRule[] => {
  const rule = sheet.rules[index];
  if (rule === undefined) return [];
  return sheet.rules.slice(index + 1, rule.endRule === -1 ? sheet.rules.length : rule.endRule);
};

/** One rule as the guards below read it. */
type SheetRule = { selector: string; block: string; prelude: string; conditional: boolean };

/**
 * A scanned sheet's rules, each with its declarations rejoined.
 *
 * A function of the sheet rather than a constant over `SHEET`, so the guards below can be pointed
 * at a synthetic sheet. They could not before: `RULES` closed over the real stylesheet, so a test
 * exercising a nesting shape had to stop at the scan output and assert what a consumer *would*
 * make of it — leaving the consumers themselves unguarded on every shape `src/styles.css` does not
 * happen to contain, which is all of them.
 */
const rulesOf = (sheet: ScannedSheet): SheetRule[] =>
  sheet.rules
    .map(
      (rule): SheetRule => ({
        selector: rule.selector,
        block: spanOf(sheet, rule)
          // Its own, not its nested blocks': the range covers both, and `bodyStart` is the block.
          .filter((declaration) => declaration.bodyStart === rule.bodyStart)
          .map(({ property, value }) => `${property}: ${value}`)
          .join('; '),
        prelude: rule.prelude,
        conditional: rule.conditional,
      }),
    )
    // An at-rule that owns no declarations is a container — `@media`, `@supports` — and holds rules
    // rather than being one. The brace regex never emitted these, because their braces are not the
    // innermost pair, and the three guards reading `RULES` were written against that shape. An
    // at-rule that *does* own declarations (`@font-face`) is a rule and stays.
    // Asked of the PRELUDE, not the resolved selector: a container nested inside a rule resolves to
    // that rule's selector and would otherwise slip through as a rule owning nothing.
    .filter(({ prelude, block }) => !prelude.startsWith('@') || block !== '');

const RULES: SheetRule[] = rulesOf(SHEET);

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
 *
 * **Unconditional blocks only.** This is the declared-value reading — "the rule for this element
 * says X" — and a block inside an at-rule says X only at some viewport. Both nesting directions
 * reach here with a plain selector (`@media (…) { .x { … } }` and `.x { @media (…) { … } }`), so
 * the exclusion is keyed on `conditional`, which the scan carries down the open stack; a test on
 * the block's own prelude would close one direction and leave the other open. Without it a
 * `white-space: nowrap` written only under `max-width: 599px` satisfies the never-breaks guard
 * while the token still wraps at desktop width. `reachingRules` deliberately keeps the opposite
 * reading — an override is an override whichever viewport it applies at.
 */
const declarationsIn = (rules: SheetRule[], selector: string): string =>
  rules
    .filter((rule) => rule.selector === selector && !rule.conditional)
    .map(({ block }) => block)
    .join(' ');

const declarations = (selector: string): string => declarationsIn(RULES, selector);

/**
 * Whether `selector` reaches `element`.
 *
 * A rule nested in a top-level `@media` arrives here as a plain selector, indistinguishable from a
 * top-level one, and that is what this guard wants — an override is an override whichever viewport
 * it applies at. A rule nested inside *another rule* arrives resolved against its parent, so
 * `.badge { @media (…) { white-space: normal } }` is seen as an override of `.badge`; before the
 * chain was resolved it arrived as `@media (…)` and this predicate could not match it at all.
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
const reaches = (element: string, selector: string): boolean => {
  const name = element.replace(/^\./, '');
  const named = new RegExp(String.raw`\.${name}(?![\w-])`);
  return selectorParts(selector).some((part) => named.test(subjectOf(part)));
};

/** The declaration blocks of every rule in `rules` that `reaches` `element`. */
const reachingIn = (rules: SheetRule[], element: string): string[] =>
  rules.filter(({ selector }) => reaches(element, selector)).map(({ block }) => block);

const reachingRules = (element: string): string[] => reachingIn(RULES, element);

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
  for (const { selector, block } of RULES) {
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
  for (const { selector } of RULES) {
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
const wrappingElementsOf = (tokens: string[]): string[] => [
  ...new Set(tokens.flatMap((token) => selectorParts(token).map(collapse))),
];

const WRAPPING_ELEMENTS = wrappingElementsOf(WRAPPING_TOKENS);

describe('stylesheet scan', () => {
  // `SHEET.unterminated` only ever proves the scan did not run off the *end* of the file. These
  // cover the harder half — a construct that loses sync and is brought back to a settled state
  // later, where the end-of-scan checks see a balanced sheet while every declaration in between
  // has been merged into one and dropped with the suite green.

  it('reports a `(` that outlived its block, though a later stray `)` rebalances the depth', () => {
    // `.a`'s `(` never closes inside `.a`; `.c`'s stray `)` cancels it, so the depth is zero by the
    // end and the end-of-scan paren arm says nothing. Meanwhile all three rules have collapsed into
    // one `color` declaration, and the spacing guards see none of them. What reports it is the `(`
    // still being open at `.a`'s closing brace, which no valid CSS leaves there.
    const css = '.a { color: rgb(0, 0, 0; }\n.b { color: red; }\n.c { color: blue); }';

    expect(scan(css).unterminated).toEqual(['( opened at 15, still open at } at 25']);
  });

  it('names each offending `(` once — not once per later brace, nor again at the end', () => {
    // Two offenders open at once. The inner one is reported and popped, which makes the outer one
    // look new again at the next brace, so a single "last reported" offset reports it twice; and
    // a `(` that outlives its block *and* runs to the end of the file is one fault, not two.
    // Neither offset appears more than once here, and there is no trailing `depth … at end`.
    const css = '.a { x: f( ; }\n.b { y: g( }\n.c { z: 1 ) ; }';

    expect(scan(css).unterminated).toEqual([
      '( opened at 9, still open at } at 13',
      '( opened at 24, still open at } at 26',
      'block opened at 3 (.a)',
    ]);
  });

  it('reads no comment inside an unquoted url token, so the declarations after it survive', () => {
    // Valid CSS that builds: `/*` inside a url is not a comment to a real parser. Read as one, it
    // is closed by the next real comment's `*/` — blanking the `;` between them, so `background`
    // and `padding` merge into one declaration and the raw px goes unreported. `unterminated`
    // stays empty throughout, because the comment did close.
    const css = [
      '.probe {',
      '  background: url(http://example.com/*a.png);',
      '  /* a real comment */',
      '  padding: 8px;',
      '}',
    ].join('\n');

    const result = scan(css);

    expect(result.unterminated).toEqual([]);
    expect(result.declarations.map(({ property, value }) => `${property}: ${value}`)).toEqual([
      'background: url(http://example.com/*a.png)',
      'padding: 8px',
    ]);
  });

  it('reads a valid url whole, whatever CSS-legal characters its contents hold', () => {
    // The direction the skip can fail in that no other test here would catch. A url token may hold
    // a `{`, a `}`, a `;` and an escaped `)` — only whitespace, a quote, a `(` and a non-printable
    // end it early. Narrowing the skip to contents that merely *look* safe made the scan fall
    // through on all three below, and the block-boundary arm above then reported the url's own `(`
    // on a sheet that builds — a guard failing on valid CSS, which is the worse direction to be
    // wrong in. The escaped `)` is the sharper half: stopping there resumes the scan *inside* the
    // token and reopens the swallowing this whole suite exists to close — so its case carries a
    // `/*` after the escape, which is what makes resuming there observable. Without one the scan
    // resumes on inert text, the declarations still come out right, and the case proves nothing.
    for (const url of [
      'url(/img/{id}.png)',
      'url(a\\)/*x.png)',
      'url(data:image/svg+xml;utf8,x)',
    ]) {
      const result = scan(`.p { background: ${url}; padding: 8px; }`);

      expect(result.unterminated, url).toEqual([]);
      expect(
        result.declarations.map(({ property }) => property),
        url,
      ).toEqual(['background', 'padding']);
    }
  });

  it('names a bad url token instead of letting its `(` fall through to the paren arm', () => {
    // `url(a; padding: 8px; }` is a bad url — whitespace inside a url token that is not padding
    // before the `)`. A real parser consumes it to the next `)` too and then throws the
    // declaration away, so the two `8px` here were never declarations to anything; the sheet is
    // unreadable, and saying so is the whole job. Reported as a bad url rather than as an unclosed
    // paren, because the paren belongs to a token, not to a typo'd function call.
    const css = '.probe { background: url(a; padding: 8px; }\n.probe-b { margin: 8px); }\n';

    expect(scan(css).unterminated).toEqual(['bad url( opened at 21']);
  });

  it('resolves a block written inside a rule against its parent, top-level blocks untouched', () => {
    const sheet = scan(
      '@media (min-width: 1px) { .top { color: red } }' +
        '.badge { @media (max-width: 600px) { white-space: normal }' +
        ' &:hover { top: 1px } .child { left: 2px } }' +
        '.a, .b { & .c { right: 3px } }',
    );

    expect(sheet.unterminated).toEqual([]);
    expect(sheet.declarations.map(({ selector, property }) => `${selector} { ${property} }`)).toEqual([
      // Inside a TOP-LEVEL at-rule: the plain selector, exactly as it arrived before resolution.
      '.top { color }',
      // An at-rule inside a rule styles nothing of its own — its parent's selector passes through.
      '.badge { white-space }',
      '.badge:hover { top }',
      '.badge .child { left }',
      // A parent that is a selector list is distributed, not wrapped: one string holding a comma
      // that is not a selector separator is what every reader downstream then mis-splits.
      '.a .c, .b .c { right }',
    ]);
  });

  it('lets the reaches predicate see an override written inside the rule it overrides', () => {
    const nested = scan('.place-kind-badge { @media (max-width: 600px) { white-space: normal } }');
    // The shape the scan newly understands, and the one whose attribution used to name nothing:
    // the declaration is reported against the element, and the predicate matches it.
    expect(nested.declarations[0]?.selector).toBe('.place-kind-badge');
    expect(reaches('.place-kind-badge', nested.declarations[0]?.selector ?? '')).toBe(true);
    // What it used to arrive as. Kept as the prelude, and the predicate cannot match that — which
    // is why the override was invisible to `reachingRules` before the chain was resolved.
    expect(nested.rules[1]?.prelude).toBe('@media (max-width: 600px)');
    expect(reaches('.place-kind-badge', nested.rules[1]?.prelude ?? '')).toBe(false);

    // The reading resolution had to preserve: inside a top-level at-rule, nothing changes.
    const top = scan('@media (max-width: 600px) { .place-kind-badge { white-space: normal } }');
    expect(top.rules.map(({ selector }) => selector)).toEqual([
      '@media (max-width: 600px)',
      '.place-kind-badge',
    ]);
    expect(reaches('.place-kind-badge', top.declarations[0]?.selector ?? '')).toBe(true);
  });

  it('splits a prelude at its top-level commas only, so a functional selector list survives', () => {
    // `:is(…)`, `:not(…)` and an attribute value all hold commas that separate nothing. Split
    // naively, each fragment is resolved against the parent on its own and the block ends up
    // naming an element that does not exist — the very failure resolution was added to remove.
    const sheet = scan(
      '.a { :is(.b, .c) { top: 1px } :not(.b, .c) .d { left: 2px } [title="x,y"] { right: 3px } }',
    );

    expect(sheet.unterminated).toEqual([]);
    expect(sheet.declarations.map(({ selector }) => selector)).toEqual([
      '.a :is(.b, .c)',
      '.a :not(.b, .c) .d',
      '.a [title="x,y"]',
    ]);
  });

  it('reads a hand-written functional selector list as one selector, not as two', () => {
    // Resolution no longer emits a comma inside `:is(…)`, but nothing stops the sheet from
    // holding one. Split naively, `:is(.a, .b) .c` yields the fragment `:is(.a`, whose last
    // compound matches `.a` — a rule that styles `.c` read as an override of `.a`.
    expect(reaches('.a', ':is(.a, .b) .c')).toBe(false);
    expect(reaches('.b', ':is(.a, .b) .c')).toBe(false);
    // The should-fire half: the element the selector actually styles is still matched, and a
    // genuine top-level list still reaches each of its own members.
    expect(reaches('.c', ':is(.a, .b) .c')).toBe(true);
    expect(reaches('.b', '.a, .b')).toBe(true);
  });

  it('does not end a compound at a combinator written inside a functional pseudo-class', () => {
    // The false negative. `target` split each part on `/[\s>+~]+/` with no depth tracking, so
    // `.badge:is(.a .b)` ended at the space inside `:is(…)` and its last piece was `.b)` — a rule
    // that really does style `.badge` invisible to every override guard here. The nowrap guard is
    // the one that would have let it through, so probe the shape it would have seen.
    expect(reaches('.badge', '.badge:is(.a .b)')).toBe(true);
    expect(reaches('.badge', '.place-kind-badge:is(.x .y) .badge')).toBe(true);
    expect(
      reaches(
        '.place-kind-badge',
        rulesOf(scan('.place-kind-badge:is(.x .y) { white-space: normal }'))[0]?.selector ?? '',
      ),
    ).toBe(true);
    // A combinator inside brackets is not a combinator either.
    expect(reaches('.badge', '.badge[data-note="a > b"]')).toBe(true);
  });

  it('reads a functional pseudo-class argument for its own subject, not for every token in it', () => {
    // The negative half of the fix above, and the reason the compound is reduced rather than
    // matched whole. `.x:is(.badge .y)` styles a `.y` that has a `.badge` ancestor; matching the
    // compound as written would report it as an override of `.badge`. Only each argument's own
    // subject applies to the element.
    expect(reaches('.badge', '.x:is(.badge .y)')).toBe(false);
    expect(reaches('.badge', '.x:is(.a .badge)')).toBe(true);
    // `:not(…)` names a class in order to exclude it and `:has(…)` in order to describe a
    // descendant — neither styles it. An attribute value names one only as text.
    expect(reaches('.badge', '.x:not(.badge)')).toBe(false);
    expect(reaches('.badge', '.x:has(.badge)')).toBe(false);
    expect(reaches('.badge', '.x[data-note=".badge"]')).toBe(false);
  });

  it('reads a class name whose escape holds a comma as one selector', () => {
    // `selectorParts` tracked the backslash inside a quote but not outside one, so `.a\,b` — one
    // class whose name contains a comma — split into `.a\` and `b`, and resolution crossed both
    // with the child: `.a\ .c, b .c`, two selectors that match nothing.
    const sheet = scan(String.raw`.a\,b { .c { left: 1px } }`);

    expect(sheet.unterminated).toEqual([]);
    expect(sheet.declarations.map(({ selector }) => selector)).toEqual([String.raw`.a\,b .c`]);
    expect(selectorParts(String.raw`.a\,b, .d`)).toEqual([String.raw`.a\,b`, '.d']);
  });

  it('splits a wrapping token at its top-level commas only', () => {
    // `WRAPPING_ELEMENTS` called `token.split(',')` directly — latent while its input is three
    // hand-written literals with no functional pseudo-class, and a silent mis-split the moment
    // that list stops being hand-written. Probed through the construction rather than the
    // constant, which no test can feed.
    expect(wrappingElementsOf(['.a:is(.b, .c)', '.d'])).toEqual(['.a:is(.b, .c)', '.d']);
    expect(wrappingElementsOf(['.a, .b'])).toEqual(['.a', '.b']);
    // The constant itself still resolves to the four elements its three tokens name.
    expect(WRAPPING_ELEMENTS).toEqual(wrappingElementsOf(WRAPPING_TOKENS));
  });

  it('does not report a rule that styles a child as an override of its parent', () => {
    // The negative probe for distribution. `.a, .b { & .c { … } }` styles `.c`; wrapping the
    // parent as `:is(.a, .b) .c` put a comma inside the selector that `reaches` then split, and
    // the fragment `:is(.a` matched `.a` — a child's own rule reported as the parent's override.
    const rules = rulesOf(scan('.a, .b { & .c { white-space: normal } }'));

    expect(rules.map(({ selector }) => selector)).toEqual(['.a, .b', '.a .c, .b .c']);
    // The parent's own (empty) block is all `.a` and `.b` reach — the child's declaration is not
    // theirs. Wrapping put `white-space: normal` in both of these lists.
    expect(reachingIn(rules, '.a')).toEqual(['']);
    expect(reachingIn(rules, '.b')).toEqual(['']);
    // The should-fire half of the same probe: the element it really styles is still seen.
    expect(reachingIn(rules, '.c')).toEqual(['white-space: normal']);
  });

  it('reaches a nested override through the consumer, not just through the scan output', () => {
    // `reachingRules` reads `RULES`, so asserting on a scan's selector alone leaves the container
    // filter and the rule rebuild unexercised on every shape `src/styles.css` does not contain.
    const rules = rulesOf(
      scan('.place-kind-badge { white-space: nowrap; @media (max-width: 600px) { white-space: normal } }'),
    );

    expect(reachingIn(rules, '.place-kind-badge')).toEqual([
      'white-space: nowrap',
      'white-space: normal',
    ]);
  });

  it('keeps a conditional block out of the declared-value reading, in both nesting directions', () => {
    // `declarations` asks what the rule for this element says; a block inside an at-rule says it
    // only at some viewport. Both directions arrive with a plain selector, so the exclusion is
    // keyed on the enclosing at-rule rather than on the block's own prelude.
    const inner = rulesOf(scan('.badge { @media (max-width: 599px) { white-space: nowrap } }'));
    expect(declarationsIn(inner, '.badge')).toBe('');
    // Still visible to the override reading, which deliberately spans viewports. The leading `''`
    // is the enclosing rule's own empty block, and pins that both entries arrive under `.badge`.
    expect(reachingIn(inner, '.badge')).toEqual(['', 'white-space: nowrap']);

    const outer = rulesOf(scan('@media (max-width: 599px) { .badge { white-space: nowrap } }'));
    expect(declarationsIn(outer, '.badge')).toBe('');

    // An unconditional block is untouched, so the exclusion cannot be passing by emptying everything.
    const plain = rulesOf(scan('.badge { white-space: nowrap }'));
    expect(declarationsIn(plain, '.badge')).toBe('white-space: nowrap');
  });

  it('lets an unclosed block still surface its own contents, per the -1 sentinel', () => {
    // `firstDeclaration`/`endDeclaration`/`endRule` stay -1 for a block the scan never saw close.
    // The readers treat that as "runs to the end"; documented, and red here if either drops it.
    const sheet = scan('.a { margin: 1px; @media q { padding: 2px }');

    expect(sheet.unterminated).toEqual(['block opened at 3 (.a)']);
    expect(sheet.rules[0]?.endDeclaration).toBe(-1);
    expect(sheet.rules[0]?.endRule).toBe(-1);
    expect(spanOf(sheet, sheet.rules[0] as ScannedRule).map(({ property }) => property)).toEqual([
      'margin',
      'padding',
    ]);
    expect(nestedIn(sheet, 0).map(({ prelude }) => prelude)).toEqual(['@media q']);
  });

  it('records each block\'s declaration and nested-rule ranges, so a reader can address one rule', () => {
    // The three readers that used to walk the whole sheet per rule read these ranges instead, so
    // the ranges themselves are the claim. A shape with a block nested between two of its parent's
    // own declarations is the one that discriminates: the parent's range has to span the nested
    // block's declarations without claiming them, and the sibling after it must fall outside.
    const sheet = scan('.a { margin: 1px; @media (min-width: 1px) { padding: 2px } gap: 3px } .b { top: 4px }');

    expect(sheet.unterminated).toEqual([]);
    expect(sheet.rules.map(({ prelude }) => prelude)).toEqual([
      '.a',
      '@media (min-width: 1px)',
      '.b',
    ]);
    expect(sheet.declarations.map(({ property, rule }) => `${property}@${rule}`)).toEqual([
      'margin@0',
      'padding@1',
      'gap@0',
      'top@2',
    ]);
    expect(
      sheet.rules.map(({ firstDeclaration, endDeclaration, endRule }) => [
        firstDeclaration,
        endDeclaration,
        endRule,
      ]),
    ).toEqual([
      [0, 3, 2],
      [1, 2, 2],
      [3, 4, 3],
    ]);
    // The backfill now starts at the frame's own first declaration; every declaration must still
    // end at its own block's `}`, the nested one at the inner brace rather than the outer.
    expect(sheet.declarations.map(({ property, bodyEnd }) => `${property}@${bodyEnd}`)).toEqual([
      'margin@68',
      'padding@57',
      'gap@68',
      'top@84',
    ]);
  });

  it('still reads a quoted `url("…")` as a string, so a `)` inside the quotes ends nothing', () => {
    // A quoted url is not a url token at all — it is an ordinary function token whose argument is
    // a string. Skipping to the first `)` would stop inside the string and misread the rest.
    const css = '.probe { background: url("a)b.png"); padding: 8px; }';

    const result = scan(css);

    expect(result.unterminated).toEqual([]);
    expect(result.declarations.map(({ property }) => property)).toEqual(['background', 'padding']);
  });
});

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
     *
     * Read off the owning rule's recorded ranges rather than by scanning the sheet per raw-px
     * declaration. An unclosed owner is still handled — both range reads treat `-1` as "to the
     * end", so its nested blocks stay recognisable and their comments cannot license it.
     */
    const nested = nestedIn(SHEET, declaration.rule);
    const owner = SHEET.rules[declaration.rule];
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
      // Searched within the owning rule, not across the sheet: both the comment and this
      // declaration sit inside that block, so anything textually between them does too.
      !(owner === undefined ? SHEET.declarations : spanOf(SHEET, owner)).some(
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
    // says how it ended, and that is checked here. A construct that loses sync and is rebalanced
    // later by an unrelated one is covered too, by the block-boundary arm and the url token —
    // see the `stylesheet scan` suite above, which exercises both on synthetic sheets.
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
