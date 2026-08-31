# `tsconfig-shapes`

A throwaway project for `src/data/monthkey-cast.lint.test.ts`, exercising the three `tsconfig.json`
shapes that broke the hand-rolled `JSON.parse(...).include` `eslint.config.js` used to derive its
typed-lint file set from: JSONC comments, a trailing comma, an `include` inherited through
`extends`, and an `exclude`d path.

It lives outside `src/` deliberately. Under `src/` the root `tsconfig.json` would claim these files
*and* the project service would discover this nested `tsconfig.json` for them — the ambiguity this
whole change exists to keep out of the lint run.
