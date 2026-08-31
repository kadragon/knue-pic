import { relative, resolve, sep } from 'node:path';

import js from '@eslint/js';
import ts from 'typescript';
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
 * The files `tsconfig.json` grants type information to, repo-relative, as TypeScript itself
 * resolves them — `include` minus `exclude`, through any `extends`, from a file that is allowed to
 * carry comments and trailing commas.
 *
 * Exported for `src/data/monthkey-cast.lint.test.ts`, which runs it against fixture projects; the
 * `dir` parameter exists for that and defaults to this repo.
 *
 * It is a list of files that exist, not a glob, so a *synthetic* `src/...` path — one handed to
 * `ESLint.lintText` for a file that is not on disk — is not in it, and the type-aware rules are
 * silently not applied there. That reads exactly like a rule correctly staying quiet, so a test
 * probing a forgery must use `PROBE` or a real on-disk path, never an invented `src/` one.
 *
 * `ts.parseJsonConfigFileContent` rather than `JSON.parse`: tsconfig.json is JSONC, so one comment
 * — in a repo as comment-dense as this one — made `JSON.parse` abort the entire ESLint run with a
 * bare `SyntaxError` before a single file was linted. That is the same "one misconfigured path
 * costs the lint of the rest of the repo, named by neither cause nor fix" failure this config's
 * `noTypeInformation` change removes from rule-time; hand-parsing merely moved it to config-load
 * time. Reading `include` alone had the same shape of bug in the other direction: an `exclude`d
 * path stayed in the typed set with no project behind it, which is exactly the
 * `... was not found by the project service` parse error being fixed here.
 */
export function typedFilesFromTsconfig(dir = import.meta.dirname) {
  // Absolute, because TypeScript resolves an `include` entry against this base itself and finds no
  // inputs at all when handed a relative one — the fixture cases pass a repo-relative path.
  const base = resolve(dir);
  const configPath = resolve(base, 'tsconfig.json');
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (error) {
    throw new Error(
      `eslint.config.js cannot read ${configPath}: ${ts.flattenDiagnosticMessageText(error.messageText, ' ')}`,
    );
  }
  // `configPath` as the 5th argument, not just the base: it is what a relative `extends` resolves
  // against, and an unresolved `extends` reads as an absent `include`.
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, base, undefined, configPath);
  if (parsed.errors.length > 0) {
    throw new Error(
      `eslint.config.js cannot resolve the file list in ${configPath}: ${parsed.errors
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
        .join('; ')}`,
    );
  }
  // ESLint matches `files` against repo-relative POSIX paths; `fileNames` are absolute and native.
  return parsed.fileNames.map((file) => relative(base, file).split(sep).join('/'));
}

/**
 * Typed linting reaches exactly the files `tsconfig.json` grants type information to, because that
 * grant is what makes the type-aware rules resolvable — so the list is derived from it rather than
 * restated here.
 *
 * Claiming more is not a wider net, it is a broken run: the project service answers a file it was
 * given no project for with `... was not found by the project service`, a parse error that fails
 * `npm run lint` naming neither cause nor fix. The previous glob claimed every TS file in the repo
 * while the config granted two paths, so the first root-level script or `scripts/` file hits it.
 *
 * To bring a new TS file under typed linting, add it to `include` in `tsconfig.json`, or give its
 * directory a `tsconfig.json` of its own — the project service discovers a nested one. Until then
 * it is linted untyped, which is a smaller guarantee and not a failure.
 */
const TYPED_FILES = [...typedFilesFromTsconfig(), PROBE];

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
