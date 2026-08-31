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
 * same type, so there is no second name to chase — and naming the type is no longer the offence,
 * only producing one is.
 *
 * What it still does not reach is stated on `MonthKey` in `src/data/iso-date.ts` — this rule is a
 * floor, not a proof, and nothing here should be read as making the brand unforgeable.
 */

const ADVICE =
  'Build one with monthKey(year, month) or narrow a string with isMonthKey(); src/data/iso-date.ts is the only checked mint point.';

/** The brand's witness property. Structural, so every alias of the type answers the same. */
const BRAND_PROPERTY = '__monthKey';

/** True when `type` itself — or a union/intersection member of it — is the brand. */
function isBrand(type) {
  if (!type) return false;
  if (type.getProperties().some((property) => property.name === BRAND_PROPERTY)) return true;
  return type.isUnionOrIntersection?.() ? type.types.some(isBrand) : false;
}

/**
 * True when the brand is reachable anywhere inside `type` — as the type itself, a union or
 * intersection member, a type argument (`MonthKey[]`, `Box<MonthKey>`, a tuple slot), a property or
 * an index signature (`Record<string, MonthKey>`).
 *
 * Reaching *into* the type is what a cast needs: `[s] as MonthKey[]` asserts an array and
 * `s as { month: MonthKey }` an object, yet both hand out an unchecked `MonthKey` the moment they
 * are indexed. Nothing about the container makes the brand inside it checked.
 *
 * `getTypeOfPropertyOfType` rather than `getTypeOfSymbolAtLocation`: a mapped or synthetic property
 * (`Record<'month', MonthKey>`) has no declaration to locate a type at, and skipping those left the
 * whole `Record` shape invisible. `seen` is what makes the walk terminate on a recursive type.
 */
function containsBrand(type, checker, seen = new Set()) {
  if (!type || seen.has(type)) return false;
  seen.add(type);

  if (isBrand(type)) return true;

  if (type.isUnionOrIntersection?.()) {
    if (type.types.some((member) => containsBrand(member, checker, seen))) return true;
  }

  const typeArguments = checker.getTypeArguments?.(type) ?? [];
  if (typeArguments.some((argument) => containsBrand(argument, checker, seen))) return true;

  for (const indexType of [checker.getIndexTypeOfType?.(type, 0), checker.getIndexTypeOfType?.(type, 1)]) {
    if (containsBrand(indexType, checker, seen)) return true;
  }

  return type
    .getProperties()
    .some((property) =>
      containsBrand(checker.getTypeOfPropertyOfType?.(type, property.name), checker, seen),
    );
}

/**
 * The nearest enclosing node that makes its subtree ambient — a `declare`d binding, or the body of
 * a `declare module` / `declare namespace`.
 *
 * The `declare` flag is required on the module too. A plain `namespace N { export const m: MonthKey
 * = monthKey(2026, 8) }` is real code the checker verifies end to end, and treating every
 * `TSModuleDeclaration` as ambient rejected exactly that — the checked mint point itself, reported
 * as an unchecked declaration.
 */
function inAmbientContext(node) {
  for (let current = node; current; current = current.parent) {
    if (current.declare === true) return true;
  }
  return false;
}

/** The enclosing function-ish node whose return type a `return` statement answers to. */
function enclosingSignature(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'FunctionExpression' ||
      current.type === 'ArrowFunctionExpression'
    ) {
      return current;
    }
  }
  return undefined;
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
      untypedInit: `Do not give a MonthKey an untyped value — \`any\` is not a check. ${ADVICE}`,
      ambient: `Do not declare a MonthKey into existence — an ambient declaration is unchecked. ${ADVICE}`,
      uncheckedReturn: `Do not promise a MonthKey from an unchecked signature. ${ADVICE}`,
      noTypeInformation:
        'local/no-monthkey-forgery cannot check this file: it has no type information, because ' +
        '`tsconfig.json` does not include it. Add it to `include`, or give its directory a ' +
        '`tsconfig.json` of its own — the project service discovers a nested one.',
    },
  },

  create(context) {
    const services = context.sourceCode.parserServices;
    /**
     * Report rather than throw. A throw here is not this file's failure, it is every file's: ESLint
     * aborts the whole run on it, so one misconfigured path costs the lint of the rest of the repo
     * and reports as a stack trace naming neither the file nor the fix. `eslint.config.js` derives
     * this rule's `files` from `tsconfig.json` so the case should be unreachable — which is exactly
     * why the failure mode has to be cheap if it is ever reached again.
     */
    if (!services?.program || !services.esTreeNodeToTSNodeMap) {
      return { Program: (node) => context.report({ node, messageId: 'noTypeInformation' }) };
    }
    const checker = services.program.getTypeChecker();

    /** `containsBrand` with this file's checker already bound. */
    const reachesBrand = (type) => containsBrand(type, checker);

    /** The resolved type at `node`, or `undefined` when the node is not in the TS node map. */
    const typeAt = (node) => {
      const tsNode = services.esTreeNodeToTSNodeMap.get(node);
      return tsNode ? checker.getTypeAtLocation(tsNode) : undefined;
    };

    /**
     * True when the value is `any`, or a container whose *element* is — `any[]` flowing into a
     * `MonthKey[]` annotation is the case `typeToString(t) === 'any'` alone missed.
     *
     * Deliberately does not walk properties, unlike `containsBrand`. `HTMLElement` reaches an `any`
     * somewhere in `lib.dom`, so a property walk reported
     * `const v: { month: MonthKey; el: HTMLElement } = { month: minted, el }` — fully checked code,
     * in a DOM app, told its value was untyped. An `any` nested in a property of an otherwise
     * checked object is also not the route this guards: the brand there came from somewhere the
     * rule already inspected.
     */
    const reachesAny = (type, seen = new Set()) => {
      if (!type || seen.has(type)) return false;
      seen.add(type);
      if (checker.typeToString(type) === 'any') return true;
      if (type.isUnionOrIntersection?.() && type.types.some((member) => reachesAny(member, seen))) return true;
      if ((checker.getTypeArguments?.(type) ?? []).some((argument) => reachesAny(argument, seen))) return true;
      return [checker.getIndexTypeOfType?.(type, 0), checker.getIndexTypeOfType?.(type, 1)].some((indexType) =>
        reachesAny(indexType, seen),
      );
    };

    /**
     * A cast is a forgery unless the value already is what it claims to be — assignable to the
     * asserted type, and not `any`. Both halves were learned by getting them wrong:
     *
     * - reaching *into* the operand (`reachesBrand`) let `{ a: minted, b: s } as { a: MonthKey;
     *   b: MonthKey }` through on the strength of the one real key, while `b` stayed an arbitrary
     *   string;
     * - bare assignability exempted every `any`, since `any` is assignable to everything, which
     *   reopened `JSON.parse(raw) as MonthKey` — the cheapest forgery there is, and the one route
     *   this whole guard exists for;
     * - requiring the operand to *be* the brand (`isBrand`) rejected every cast of a container that
     *   merely holds one: an identity cast of a `HistogramBucket[]`, a `readonly` widening, and
     *   `{ month: minted, visits: 1 } as const` — ordinary code with nothing forged in it.
     */
    const checkAssertion = (node) => {
      const asserted = typeAt(node);
      if (!reachesBrand(asserted)) return;
      const operand = typeAt(node.expression);
      if (operand && asserted && !reachesAny(operand) && checker.isTypeAssignableTo?.(operand, asserted)) return;
      context.report({ node, messageId: 'cast' });
    };

    /**
     * The route that needs no cast at all: a declared `MonthKey` receiving an `any`. Assignability
     * already rejects every other initializer, so `any` is the whole hole — and `JSON.parse` is
     * exactly how this app reads `data/places.json`.
     *
     * Every position that can receive one is checked, because they are one keyword apart:
     * an initializer, a class field, a parameter default, a later assignment, and a `return`.
     */
    const checkUntypedValue = (node, declaredType, valueNode) => {
      if (!declaredType || !valueNode) return;
      if (!reachesBrand(declaredType)) return;
      if (!reachesAny(typeAt(valueNode))) return;
      context.report({ node, messageId: 'untypedInit' });
    };

    const checkAnnotated = (node, typeAnnotation, valueNode) => {
      if (!typeAnnotation) return;
      checkUntypedValue(node, typeAt(typeAnnotation.typeAnnotation), valueNode);
    };

    /**
     * A binding whose type *reaches* the brand, promised by a declaration with nothing to check it.
     *
     * Deliberately deeper than the return-position check below: `declare const hist:
     * MonthlyHistogram` hands out `MonthKey`s that no code ever minted, whereas a *signature*
     * returning the same container is implemented by code the checker verifies. The declaration is
     * the promise; the signature is a shape something else has to satisfy.
     */
    const checkAmbientBinding = (node, typeAnnotation) => {
      if (!typeAnnotation || !inAmbientContext(node)) return;
      if (!reachesBrand(typeAt(typeAnnotation.typeAnnotation))) return;
      context.report({ node, messageId: 'ambient' });
    };

    /**
     * A signature that returns the brand with no body to check it. Return position only — a
     * `MonthKey` **parameter** consumes one and is the entire point of the type.
     *
     * `isBrand`, not `reachesBrand`: a signature returning a *container* that carries one —
     * `() => MonthlyHistogram`, whose buckets hold `MonthKey`s — promises nothing unchecked, since
     * whatever implements it had to mint those keys through the checked path. Reaching into the
     * return type made an ordinary callback type fail the build with a message that did not apply.
     */
    const checkUncheckedReturn = (node) => {
      if (!node.returnType) return;
      if (!isBrand(typeAt(node.returnType.typeAnnotation))) return;
      context.report({ node: node.returnType, messageId: 'uncheckedReturn' });
    };

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,

      VariableDeclarator(node) {
        checkAnnotated(node, node.id.typeAnnotation, node.init);
        checkAmbientBinding(node, node.id.typeAnnotation);
      },
      PropertyDefinition(node) {
        checkAnnotated(node, node.typeAnnotation, node.value);
        checkAmbientBinding(node, node.typeAnnotation);
      },
      // A parameter default: `function h(m: MonthKey = JSON.parse(raw))`.
      AssignmentPattern(node) {
        checkAnnotated(node, node.left.typeAnnotation, node.right);
      },
      // A later assignment: `let m: MonthKey; m = JSON.parse(raw);` — and `this.m = JSON.parse(raw)`.
      AssignmentExpression(node) {
        if (node.operator !== '=') return;
        checkUntypedValue(node, typeAt(node.left), node.right);
      },
      // `function f(): MonthKey { return JSON.parse(raw); }` — the annotation is on the signature,
      // so the initializer visitors above never see the value that fills it.
      ReturnStatement(node) {
        const signature = enclosingSignature(node);
        if (!signature?.returnType) return;
        checkUntypedValue(node, typeAt(signature.returnType.typeAnnotation), node.argument);
      },
      // The expression body of an arrow: `const g = (): MonthKey => JSON.parse(raw);`.
      ArrowFunctionExpression(node) {
        if (!node.returnType || node.body.type === 'BlockStatement') return;
        checkUntypedValue(node, typeAt(node.returnType.typeAnnotation), node.body);
      },

      TSDeclareFunction: checkUncheckedReturn,
      TSMethodSignature: checkUncheckedReturn,
      TSFunctionType: checkUncheckedReturn,
      MethodDefinition(node) {
        // An overload signature or an ambient method: `value` is a function with no body.
        if (node.value?.body) return;
        if (node.value?.returnType) checkUncheckedReturn(node.value);
      },
      // typescript-eslint emits this rather than `MethodDefinition` for an abstract member, so the
      // body-less branch above never sees `abstract mint(x: string): MonthKey`.
      TSAbstractMethodDefinition(node) {
        if (node.value?.returnType) checkUncheckedReturn(node.value);
      },
    };
  },
};
