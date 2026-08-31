import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import noMonthKeyForgery from './eslint-rules/no-monthkey-forgery.js';

/**
 * The one file allowed to assert a `MonthKey` into existence. `monthKey()` there checks both
 * halves before its cast, so keeping the forgeries out is what moves "one checked mint point"
 * from asserted toward enforced — the brand itself only stops *implicit* assignment.
 */
const MONTH_KEY_MINT = 'src/data/iso-date.ts';

/**
 * The synthetic path `src/data/monthkey-cast.lint.test.ts` lints through. It is not on disk, so it
 * is reachable only via `allowDefaultProject` below — and it must be typed, since that test is the
 * only thing proving the forgery rule still reports.
 */
const PROBE = 'probe.ts';

/**
 * Typed linting reaches exactly the files `tsconfig.json` includes, because that file is what
 * grants them type information — so the globs are derived from it rather than restated here.
 *
 * Claiming more is not a wider net, it is a broken run: the project service answers a file it was
 * given no project for with `... was not found by the project service`, a parse error that fails
 * `npm run lint` naming neither cause nor fix. The previous glob claimed every TS file in the repo
 * while `include` granted two paths, so the first root-level script or `scripts/` file hits it.
 *
 * To bring a new TS file under typed linting, add it to `include` in `tsconfig.json`, or give its
 * directory a `tsconfig.json` of its own — the project service discovers a nested one. Until then
 * it is linted untyped, which is a smaller guarantee and not a failure.
 */
const TYPED_FILES = [
  ...JSON.parse(readFileSync(join(import.meta.dirname, 'tsconfig.json'), 'utf8')).include.map(
    (entry) =>
      // A `include` entry is a directory, a file, or already a glob. Only the first needs expanding.
      /[*?]/.test(entry) || /\.[cm]?tsx?$/.test(entry) ? entry : `${entry}/**/*.{ts,tsx,mts,cts}`,
  ),
  PROBE,
];

export default [
  // `.worktrees/` holds checkouts of this same repo (`dev:task-next --all`). Linting them makes
  // every file ambiguous to the TS parser — "multiple candidate TSConfigRootDirs" — so `npm run
  // lint` fails locally for anyone mid-batch even though CI, which has no worktrees, is green.
  { ignores: ['dist/', 'collector/', 'node_modules/', '.worktrees/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Type information for every file `TYPED_FILES` reaches, `MONTH_KEY_MINT` included — the rule
    // below is exempted there by path, not by being left unable to resolve a type.
    //
    // `allowDefaultProject` names one path, `PROBE`, and it exists for
    // `src/data/monthkey-cast.lint.test.ts`: that test lints synthetic source through *this*
    // config, which is the only way it can prove the real guard holds, and the project service
    // refuses a path that is not on disk. Without it the test could only assert against a config
    // it built itself — a guard testing its own copy.
    //
    // The glob is that single name rather than `*.ts` because a file the project service already
    // claims may not also be allowed here: `*.ts` matches `vite.config.ts`, which `tsconfig.json`
    // includes, and every lint of it then fails to parse.
    files: TYPED_FILES,
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: [PROBE] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    /**
     * Forging a `MonthKey` is banned by *type*, not by the identifier's text. The predecessor rule
     * matched the name with esquery selectors, which reach a forgery only where the source spells
     * `MonthKey` — `s as Parameters<typeof monthLabel>[0]` and `type MK = MonthKey & {}` both got
     * past it, and so did an untyped `JSON.parse` assigned straight to the annotation. Resolving
     * the type closes those, and removes the need to ban aliases separately: an alias resolves to
     * the same type, so it is no longer a second name to chase.
     *
     * What the rule still cannot reach is documented on `MonthKey` itself in `src/data/iso-date.ts`,
     * where the limits belong next to the type they qualify.
     * `src/data/monthkey-cast.lint.test.ts` runs this config over every route, in both directions,
     * so a refactor cannot leave the guard reporting nothing.
     */
    // Exactly `TYPED_FILES`: the rule resolves types, so applying it anywhere the block above did
    // not grant type information would leave it reporting `noTypeInformation` on every node's file
    // rather than checking anything.
    files: TYPED_FILES,
    ignores: [MONTH_KEY_MINT],
    plugins: { local: { rules: { 'no-monthkey-forgery': noMonthKeyForgery } } },
    rules: {
      'local/no-monthkey-forgery': 'error',
    },
  },
];
