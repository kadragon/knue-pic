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
    // `declare const m: MonthKey` / `declare function mint(): MonthKey` / `declare class C { static m: MonthKey }`
    // mint one with no cast at all. `TSDeclareFunction` also covers a non-ambient overload
    // signature returning `MonthKey`, which is the same unchecked promise written a second way.
    selector:
      ':matches(VariableDeclaration[declare=true], ClassDeclaration[declare=true], TSDeclareFunction, TSModuleDeclaration) Identifier[name="MonthKey"]',
    message: `Do not declare a MonthKey into existence — an ambient declaration is unchecked. ${MONTH_KEY_ADVICE}`,
  },
];

export default [
  { ignores: ['dist/', 'collector/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: [MONTH_KEY_MINT],
    rules: {
      'no-restricted-syntax': ['error', ...MONTH_KEY_FORGERY],
    },
  },
];
