import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * The one file allowed to assert a `MonthKey` into existence. `monthKey()` there checks both
 * halves before its cast, so keeping the cheap forgeries out is what moves "one checked mint
 * point" from asserted toward enforced — the brand itself only stops *implicit* assignment, and
 * the rules below reach less than everything (see their own comment).
 */
const MONTH_KEY_MINT = 'src/data/iso-date.ts';

const MONTH_KEY_ADVICE =
  'Build one with monthKey(year, month) or narrow a string with isMonthKey(); src/data/iso-date.ts is the only checked mint point.';

/**
 * The routes to a `MonthKey` that *spell the name* and that the type checker cannot refuse. They
 * are listed separately rather than merged into one selector because each needs its own message,
 * and because a merged selector is the kind that quietly stops matching one arm.
 *
 * `no-restricted-syntax` matches on the identifier *text*, which is why the alias routes are
 * banned too: without them, `import { MonthKey as MK }` or `type MK = MonthKey` would give the
 * type a second name the cast rules do not recognise, and the ban would be one rename deep.
 *
 * Matching on text is also this rule's ceiling, and the reason no claim of exhaustiveness belongs
 * here or in the doc comments that cite it. `x as Parameters<typeof monthLabel>[0]` names the type
 * without writing it, and `type MK = MonthKey & {}` puts it somewhere the alias selector does not
 * reach — closing those needs type information this rule does not have. What the rule buys is that
 * the short, obvious forgeries fail the build, and the roundabout ones are contrived enough that
 * review sees them.
 *
 * That ceiling is a decision, not an oversight. Raising it means type information: either
 * typescript-eslint's `recommended-type-checked` set, or a local type-aware rule that refuses a
 * `MonthKey` produced outside the mint. Both make every lint run a typed one, and both are
 * maintained forever to close routes that cannot be written by accident — `src/data/iso-date.ts`
 * enumerates the five that stay open, and the one cheap route among them (`const m: MonthKey =
 * JSON.parse(raw)`) is already guarded where it matters, by `parseDataset` in `src/data/load.ts`.
 * So the floor stands as-is. Revisit it if an unchecked `MonthKey` ever reaches `monthLabel` in
 * shipped code — that would be evidence the cost is now worth paying.
 */
const MONTH_KEY_FORGERY = [
  {
    // `x as MonthKey`, `x as unknown as MonthKey`, `x as MonthKey[]`, and the `<MonthKey>x` form.
    selector:
      ':matches(TSAsExpression, TSTypeAssertion) > .typeAnnotation Identifier[name="MonthKey"]',
    message: `Do not cast to MonthKey. ${MONTH_KEY_ADVICE}`,
  },
  {
    selector:
      ':matches(ImportSpecifier[imported.name="MonthKey"][local.name!="MonthKey"], ExportSpecifier[local.name="MonthKey"][exported.name!="MonthKey"])',
    message: `Do not rename MonthKey on import or re-export — an alias escapes the cast ban. ${MONTH_KEY_ADVICE}`,
  },
  {
    // `type MK = MonthKey;` only. A MonthKey *inside* a composite type is untouched.
    selector: 'TSTypeAliasDeclaration > TSTypeReference.typeAnnotation > Identifier[name="MonthKey"]',
    message: `Do not alias MonthKey to a second name — an alias escapes the cast ban. ${MONTH_KEY_ADVICE}`,
  },
  {
    // `declare const m: MonthKey` / `declare class C { static m: MonthKey }` inside an ambient
    // context: a binding whose *type* is the brand, promised without a check.
    selector:
      ':matches(VariableDeclaration[declare=true], ClassDeclaration[declare=true], TSModuleDeclaration) :matches(VariableDeclarator > Identifier > TSTypeAnnotation, PropertyDefinition > TSTypeAnnotation, TSPropertySignature > TSTypeAnnotation) Identifier[name="MonthKey"]',
    message: `Do not declare a MonthKey into existence — an ambient declaration is unchecked. ${MONTH_KEY_ADVICE}`,
  },
  {
    // A signature that *returns* the brand with no body to check it: `declare function mint(): MonthKey`,
    // a non-ambient overload, or a method signature reached through a `declare const`. Only the
    // return position — a `MonthKey` **parameter** consumes one and is exactly what the type is for.
    selector:
      ':matches(TSDeclareFunction, TSMethodSignature, TSFunctionType, MethodDefinition) > TSTypeAnnotation.returnType Identifier[name="MonthKey"]',
    message: `Do not promise a MonthKey from an unchecked signature. ${MONTH_KEY_ADVICE}`,
  },
];

export default [
  // `.worktrees/` holds checkouts of this same repo (`dev:task-next --all`). Linting them makes
  // every file ambiguous to the TS parser — "multiple candidate TSConfigRootDirs" — so `npm run
  // lint` fails locally for anyone mid-batch even though CI, which has no worktrees, is green.
  { ignores: ['dist/', 'collector/', 'node_modules/', '.worktrees/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    ignores: [MONTH_KEY_MINT],
    rules: {
      'no-restricted-syntax': ['error', ...MONTH_KEY_FORGERY],
    },
  },
];
