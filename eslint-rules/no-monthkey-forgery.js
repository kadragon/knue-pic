/**
 * Bans forging a `MonthKey` outside its one checked mint point, using type information rather than
 * the identifier's text.
 *
 * The predecessor was five `no-restricted-syntax` selectors, and esquery can only see a type where
 * the source *writes its name*. PR #32's QA reproduced five routes that name it indirectly and pass
 * both `eslint` and `tsc`: `s as Parameters<typeof monthLabel>[0]`, `type MK = MonthKey & {}`,
 * `type MK = string extends string ? MonthKey : never`, `type Box<T = MonthKey> = T`, and an
 * untyped value flowing straight into the annotation, `const m: MonthKey = JSON.parse(raw)`. Each
 * reached `monthLabel` with `'1e3-08'`, which renders `1e3년 8월`.
 *
 * Resolving the type closes all of them at once, and closes the alias routes the old selectors
 * needed their own arms for: `import { MonthKey as MK }` and `type MK = MonthKey` resolve to the
 * same type, so there is no second name to chase.
 *
 * What it still does not reach is stated on `MonthKey` in `src/data/iso-date.ts` — this rule is a
 * floor, not a proof, and nothing here should be read as making the brand unforgeable.
 */

const ADVICE =
  'Build one with monthKey(year, month) or narrow a string with isMonthKey(); src/data/iso-date.ts is the only checked mint point.';

/** The brand's witness property. Structural, so every alias of the type answers the same. */
const BRAND_PROPERTY = '__monthKey';

/**
 * True when the brand is reachable inside `type` at all — as the type itself, a union or
 * intersection member, a type argument (`MonthKey[]`, `Box<MonthKey>`, a tuple slot) or a property.
 *
 * Reaching *into* the type is what the predecessor selectors did by accident and this rule has to
 * do on purpose: `[s] as MonthKey[]` asserts an array, and `s as { month: MonthKey }` an object,
 * yet both hand out an unchecked `MonthKey` the moment they are indexed. Nothing about the
 * container makes the brand inside it checked.
 *
 * `getProperties()` already flattens an intersection, so the explicit member walk matters for a
 * *union*, whose property list holds only what every member shares. `seen` is what makes the walk
 * terminate on a recursive type.
 */
function containsMonthKey(type, checker, seen = new Set()) {
  if (!type || seen.has(type)) return false;
  seen.add(type);

  const properties = type.getProperties();
  if (properties.some((property) => property.name === BRAND_PROPERTY)) return true;

  if (type.isUnionOrIntersection?.()) {
    if (type.types.some((member) => containsMonthKey(member, checker, seen))) return true;
  }

  const typeArguments = checker.getTypeArguments?.(type) ?? [];
  if (typeArguments.some((argument) => containsMonthKey(argument, checker, seen))) return true;

  return properties.some((property) => {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (!declaration) return false;
    return containsMonthKey(checker.getTypeOfSymbolAtLocation(property, declaration), checker, seen);
  });
}

/**
 * The nearest enclosing node that makes its subtree ambient (`declare` / `declare module`).
 *
 * An `interface` is deliberately not one: `interface HistogramBucket { month: MonthKey }` in
 * `src/stats/histogram.ts` *consumes* a `MonthKey` the caller already had to mint, which is what
 * the type is for. Only a declaration that promises a binding into existence with no code to check
 * it is a forgery.
 */
function inAmbientContext(node) {
  for (let current = node; current; current = current.parent) {
    if (current.declare === true) return true;
    if (current.type === 'TSModuleDeclaration') return true;
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow producing a MonthKey outside src/data/iso-date.ts, whatever name the type is reached by',
    },
    schema: [],
    messages: {
      cast: `Do not cast to MonthKey. ${ADVICE}`,
      untypedInit: `Do not assign an untyped value to a MonthKey — \`any\` is not a check. ${ADVICE}`,
      ambient: `Do not declare a MonthKey into existence — an ambient declaration is unchecked. ${ADVICE}`,
      uncheckedReturn: `Do not promise a MonthKey from an unchecked signature. ${ADVICE}`,
    },
  },

  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services?.program || !services.esTreeNodeToTSNodeMap) {
      throw new Error(
        'local/no-monthkey-forgery needs type information — set parserOptions.projectService for this file.',
      );
    }
    const checker = services.program.getTypeChecker();

    /** `containsMonthKey` with this file's checker already bound. */
    const isMonthKey = (type) => containsMonthKey(type, checker);

    /** The resolved type at `node`, or `undefined` when the node is not in the TS node map. */
    const typeAt = (node) => {
      const tsNode = services.esTreeNodeToTSNodeMap.get(node);
      return tsNode ? checker.getTypeAtLocation(tsNode) : undefined;
    };

    /**
     * A cast is a forgery only when it *produces* the brand. `m as MonthKey` where `m` already is
     * one narrows nothing and mints nothing, and banning it would make the type harder to use than
     * to bypass — the shape that gets a rule disabled rather than obeyed.
     */
    const checkAssertion = (node) => {
      if (!isMonthKey(typeAt(node))) return;
      if (isMonthKey(typeAt(node.expression))) return;
      context.report({ node, messageId: 'cast' });
    };

    /**
     * The route that needs no cast at all: `const m: MonthKey = JSON.parse(raw)`. Assignability
     * already rejects every initializer but `any` (and `never`, which no expression produces
     * without an assertion this rule has already reported), so `any` is the whole hole here — and
     * `JSON.parse` is exactly how this app reads `data/places.json`.
     */
    const checkAnnotatedBinding = (node, typeAnnotation, init) => {
      if (!typeAnnotation || !init) return;
      if (!isMonthKey(typeAt(typeAnnotation.typeAnnotation))) return;
      const initType = typeAt(init);
      // `flags & TypeFlags.Any` without importing typescript: `any` is the only type whose
      // `typeToString` is `any` and which assigns to a brand.
      if (checker.typeToString(initType) !== 'any') return;
      context.report({ node, messageId: 'untypedInit' });
    };

    /** A binding whose *type* is the brand, promised by a declaration with nothing to check it. */
    const checkAmbientBinding = (node, typeAnnotation) => {
      if (!typeAnnotation || !inAmbientContext(node)) return;
      if (!isMonthKey(typeAt(typeAnnotation.typeAnnotation))) return;
      context.report({ node, messageId: 'ambient' });
    };

    /**
     * A signature that returns the brand with no body to check it. Return position only — a
     * `MonthKey` **parameter** consumes one and is the entire point of the type.
     */
    const checkUncheckedReturn = (node) => {
      if (!node.returnType) return;
      if (!isMonthKey(typeAt(node.returnType.typeAnnotation))) return;
      context.report({ node: node.returnType, messageId: 'uncheckedReturn' });
    };

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,

      VariableDeclarator(node) {
        checkAnnotatedBinding(node, node.id.typeAnnotation, node.init);
        checkAmbientBinding(node, node.id.typeAnnotation);
      },
      PropertyDefinition(node) {
        checkAnnotatedBinding(node, node.typeAnnotation, node.value);
        checkAmbientBinding(node, node.typeAnnotation);
      },
      TSPropertySignature(node) {
        checkAmbientBinding(node, node.typeAnnotation);
      },

      TSDeclareFunction: checkUncheckedReturn,
      TSMethodSignature: checkUncheckedReturn,
      TSFunctionType: checkUncheckedReturn,
      MethodDefinition(node) {
        // An overload signature or an ambient method: `value` is a function with no body.
        if (node.value?.body) return;
        if (node.value?.returnType) checkUncheckedReturn(node.value);
      },
    };
  },
};
