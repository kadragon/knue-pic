import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The `no-restricted-syntax` rules in `eslint.config.js` are what turn "one checked mint point"
 * from a doc-comment claim into an enforced one. Their selectors are esquery strings that nothing
 * type-checks, so a rename or a config refactor can leave one matching nothing and the guard would
 * pass silently. These cases run the real config and assert both directions.
 */

const eslint = new ESLint();

/** Rule ids reported for `code`, as ESLint would see it at `filePath`. */
async function ruleIdsFor(code: string, filePath: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId);
}

const MONTH_KEY_RULE = 'no-restricted-syntax';

/**
 * The first lint loads the flat config and the TypeScript parser — a cost paid once per process,
 * and one that timed out this file at vitest's 5s default on a cold run here before `beforeAll`
 * existed. It does not reproduce on a warm cache, which is the argument for a budget rather than
 * against one: the load is unrelated to what these cases assert, so it must not be able to report
 * itself as a rule failure. `beforeAll` puts the cost where it is attributed.
 */
const LINT_TIMEOUT_MS = 30_000;

const PROBE = 'src/ui/probe.ts';

describe('the MonthKey forgery ban', () => {
  beforeAll(async () => {
    await ruleIdsFor('export const warm = 1;\n', PROBE);
  }, LINT_TIMEOUT_MS);

  /**
   * Every route the rules claim to close. `<MonthKey>s` and the alias forms are the ones a
   * cast-only selector misses: each typechecks, and each puts a `'1e3-08'` into `monthLabel`,
   * which renders it `1e3년 8월`. Routes the rules deliberately do *not* close are documented on
   * `MonthKey` in `src/data/iso-date.ts`; they are absent here on purpose, so this list stays a
   * description of the guard rather than a wish for one.
   */
  it.each([
    ['a direct cast', 'export const a = s as MonthKey;'],
    ['a cast through unknown', 'export const b = s as unknown as MonthKey;'],
    ['an array element cast', 'export const c = [s] as MonthKey[];'],
    ['an angle-bracket assertion', 'export const d = <MonthKey>s;'],
    ['a renaming import', 'import type { MonthKey as MK } from "../data/iso-date";\nexport type Alias = MK;'],
    ['a renaming re-export', 'export type { MonthKey as MK } from "../data/iso-date";'],
    ['a local type alias', 'type MK = MonthKey;\nexport type Alias = MK;'],
    ['an ambient binding', 'declare const m: MonthKey;\nexport const e = m;'],
    ['an ambient function', 'declare function mint(x: string): MonthKey;\nexport const f = mint(s);'],
    ['an ambient class member', 'declare class C { static m: MonthKey }\nexport const g = C.m;'],
    ['an ambient module binding', "declare module 'x' { export const q: MonthKey }"],
    ['an interface method returning one', 'interface Mint { mint(x: string): MonthKey }\ndeclare const mk: Mint;\nexport const h = mk.mint(s);'],
  ])('rejects %s outside the mint point', async (_label, statement) => {
    const ids = await ruleIdsFor(
      `import type { MonthKey } from '../data/iso-date';\ndeclare const s: string;\n${statement}\n`,
      PROBE,
    );
    expect(ids).toContain(MONTH_KEY_RULE);
  }, LINT_TIMEOUT_MS);

  /**
   * The ban is on giving the type a second name or an unchecked value — not on *using* it. A
   * `MonthKey` in a parameter position consumes one and is the entire point of the type, so an
   * ambient signature that merely accepts one must stay legal; an earlier revision of the ambient
   * selector matched any descendant and rejected those, which is the shape that gets a rule
   * disabled rather than obeyed.
   */
  it.each([
    ['a cast to an unrelated type', 'export const g = s as string;'],
    ['a MonthKey inside a composite type', 'export type Row = { month: MonthKey; visits: number };'],
    ['a plain re-export of the name', 'export type { MonthKey };'],
    ['a MonthKey parameter on an overload signature', 'export function f(m: MonthKey): string;\nexport function f(m: string): string;\nexport function f(m: string): string { return m; }'],
    ['a MonthKey parameter on an ambient function', 'declare function consume(m: MonthKey): void;\nexport const use = consume;'],
  ])('allows %s', async (_label, statement) => {
    const ids = await ruleIdsFor(
      `import type { MonthKey } from '../data/iso-date';\ndeclare const s: string;\n${statement}\n`,
      PROBE,
    );
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
