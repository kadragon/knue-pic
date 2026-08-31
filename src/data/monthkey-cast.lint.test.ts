import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * `local/no-monthkey-forgery` in `eslint.config.js` is what turns "one checked mint point" from a
 * doc-comment claim into an enforced one. It resolves types through the TypeScript program, so
 * nothing type-checks the shape of what it inspects: a refactor can leave a visitor reporting
 * nothing and the guard would pass silently. These cases run the real config and assert both
 * directions.
 */

const eslint = new ESLint();

/** Rule ids reported for `code`, as ESLint would see it at `filePath`. */
async function ruleIdsFor(code: string, filePath: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId);
}

const MONTH_KEY_RULE = 'local/no-monthkey-forgery';

/**
 * The first lint loads the flat config, the TypeScript parser and the project service — a cost
 * paid once per process, and one that timed out this file at vitest's 5s default on a cold run
 * here before `beforeAll` existed. Type-aware linting only made that first load heavier. The load
 * is unrelated to what these cases assert, so it must not be able to report itself as a rule
 * failure; `beforeAll` puts the cost where it is attributed.
 */
const LINT_TIMEOUT_MS = 30_000;

/**
 * A root-level path, not one under `src/`, because the project service refuses a `filePath` that is
 * not on disk — `src/ui/probe.ts` fails to parse before any rule runs. `eslint.config.js` names
 * this one file in `allowDefaultProject` so lint-time type information is available for it.
 */
const PROBE = 'probe.ts';

/** The probe's preamble: the real `MonthKey`, plus the two values a forgery starts from. */
const PREAMBLE = [
  "import type { MonthKey } from './src/data/iso-date';",
  'declare const s: string;',
  'declare const raw: string;',
].join('\n');

describe('the MonthKey forgery ban', () => {
  beforeAll(async () => {
    await ruleIdsFor('export const warm = 1;\n', PROBE);
  }, LINT_TIMEOUT_MS);

  /**
   * Every route the rule claims to close. The first block is what the predecessor
   * `no-restricted-syntax` selectors already closed — kept verbatim so replacing them cannot
   * quietly drop coverage. The second block is the five routes PR #32's QA reproduced *past* those
   * selectors: each typechecks, and each puts a `'1e3-08'` into `monthLabel`, which renders it
   * `1e3년 8월`. They are the reason this rule resolves types instead of matching the name.
   *
   * Routes the rule still does not close are documented on `MonthKey` in `src/data/iso-date.ts`;
   * they are absent here on purpose, so this list stays a description of the guard rather than a
   * wish for one.
   */
  it.each([
    // — closed by the predecessor selectors, and still closed —
    ['a direct cast', 'export const a = s as MonthKey;'],
    ['a cast through unknown', 'export const b = s as unknown as MonthKey;'],
    ['an array element cast', 'export const c = [s] as MonthKey[];'],
    ['an angle-bracket assertion', 'export const d = <MonthKey>s;'],
    [
      'a cast through a renaming import',
      "import type { MonthKey as MK } from './src/data/iso-date';\nexport const e = s as MK;",
    ],
    ['a cast through a local type alias', 'type MK = MonthKey;\nexport const f = s as MK;'],
    ['an ambient binding', 'declare const m: MonthKey;\nexport const g = m;'],
    ['an ambient function', 'declare function mint(x: string): MonthKey;\nexport const h = mint(s);'],
    ['an ambient class member', 'declare class C { static m: MonthKey }\nexport const i = C.m;'],
    ['an ambient module binding', "declare module 'x' { export const q: MonthKey }"],
    [
      'an interface method returning one',
      'interface Mint { mint(x: string): MonthKey }\ndeclare const mk: Mint;\nexport const j = mk.mint(s);',
    ],
    ['a function type returning one', 'export type Mint = (x: string) => MonthKey;'],
    ['a cast to an object that carries one', 'export const q = { month: s } as { month: MonthKey };'],

    // — the five routes the text selectors could not see (PR #32 contract QA) —
    [
      'a type reached without naming it',
      "import { monthLabel } from './src/ui/place-labels';\nexport const k = s as Parameters<typeof monthLabel>[0];",
    ],
    ['an alias whose right-hand side is a composite', 'type MK = MonthKey & {};\nexport const l = s as MK;'],
    [
      'an alias behind a conditional type',
      'type MK = string extends string ? MonthKey : never;\nexport const n = s as MK;',
    ],
    ['a type-parameter default', 'type Box<T = MonthKey> = T;\nexport const o = s as Box;'],
    ['an untyped value assigned to the annotation', 'export const p: MonthKey = JSON.parse(raw);'],
  ])('rejects %s outside the mint point', async (_label, statement) => {
    const ids = await ruleIdsFor(`${PREAMBLE}\n${statement}\n`, PROBE);
    expect(ids).toContain(MONTH_KEY_RULE);
  }, LINT_TIMEOUT_MS);

  /**
   * The ban is on *producing* the brand without a check — not on using or carrying one. A
   * `MonthKey` in a parameter position consumes one and is the entire point of the type, and an
   * interface field holding one is how `HistogramBucket` in `src/stats/histogram.ts` is written; an
   * earlier revision of the ambient check rejected both, which is the shape that gets a rule
   * disabled rather than obeyed.
   *
   * Naming the type is likewise not the offence any more: `import { MonthKey as MK }` and
   * `type MK = MonthKey` had to be banned outright while the guard matched text, because an alias
   * gave the cast rules a name they did not recognise. Resolving the type removes that need — the
   * alias is caught where it is used to forge, which the reject block above pins.
   */
  it.each([
    ['a cast to an unrelated type', 'export const a = s as string;'],
    ['a MonthKey inside a composite type', 'export type Row = { month: MonthKey; visits: number };'],
    ['a MonthKey field on an interface', 'export interface Bucket { month: MonthKey; visits: number }'],
    ['a plain re-export of the name', 'export type { MonthKey };'],
    ['a renaming import that never forges one', "import type { MonthKey as MK } from './src/data/iso-date';\nexport type Row = { month: MK };"],
    ['a local alias that never forges one', 'type MK = MonthKey;\nexport type Row = { month: MK };'],
    [
      'a MonthKey parameter on an overload signature',
      'export function f(m: MonthKey): string;\nexport function f(m: string): string;\nexport function f(m: string): string { return m; }',
    ],
    ['a MonthKey parameter on an ambient function', 'declare function consume(m: MonthKey): void;\nexport const use = consume;'],
    [
      're-asserting a value that is already one',
      "import { monthKey } from './src/data/iso-date';\nexport const b = monthKey(2026, 8) as MonthKey;",
    ],
  ])('allows %s', async (_label, statement) => {
    const ids = await ruleIdsFor(`${PREAMBLE}\n${statement}\n`, PROBE);
    expect(ids).not.toContain(MONTH_KEY_RULE);
  }, LINT_TIMEOUT_MS);

  /**
   * `monthKey()` mints the brand with an `as MonthKey` of its own, after checking both halves.
   * Exempting the file by path is the whole design; if this went red the rule would have banned
   * the only legitimate construction.
   */
  it('allows the checked mint point in src/data/iso-date.ts', async () => {
    const ids = await ruleIdsFor(
      'export type MonthKey = string & { readonly __monthKey: unique symbol };\ndeclare const s: string;\nexport const m = s as MonthKey;\n',
      'src/data/iso-date.ts',
    );
    expect(ids).not.toContain(MONTH_KEY_RULE);
  }, LINT_TIMEOUT_MS);
});
