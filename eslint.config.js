import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import noMonthKeyForgery from './eslint-rules/no-monthkey-forgery.js';

/**
 * The one file allowed to assert a `MonthKey` into existence. `monthKey()` there checks both
 * halves before its cast, so keeping the forgeries out is what moves "one checked mint point"
 * from asserted toward enforced — the brand itself only stops *implicit* assignment.
 */
const MONTH_KEY_MINT = 'src/data/iso-date.ts';

export default [
  // `.worktrees/` holds checkouts of this same repo (`dev:task-next --all`). Linting them makes
  // every file ambiguous to the TS parser — "multiple candidate TSConfigRootDirs" — so `npm run
  // lint` fails locally for anyone mid-batch even though CI, which has no worktrees, is green.
  { ignores: ['dist/', 'collector/', 'node_modules/', '.worktrees/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Type information for every TS file, `MONTH_KEY_MINT` included — the rule below is exempted
    // there by path, not by being left unable to resolve a type.
    //
    // `allowDefaultProject` names one path, `probe.ts`, and it exists for
    // `src/data/monthkey-cast.lint.test.ts`: that test lints synthetic source through *this*
    // config, which is the only way it can prove the real guard holds, and the project service
    // refuses a path that is not on disk. Without it the test could only assert against a config
    // it built itself — a guard testing its own copy.
    //
    // The glob is that single name rather than `*.ts` because a file the project service already
    // claims may not also be allowed here: `*.ts` matches `vite.config.ts`, which `tsconfig.json`
    // includes, and every lint of it then fails to parse.
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['probe.ts'] },
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
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    ignores: [MONTH_KEY_MINT],
    plugins: { local: { rules: { 'no-monthkey-forgery': noMonthKeyForgery } } },
    rules: {
      'local/no-monthkey-forgery': 'error',
    },
  },
];
