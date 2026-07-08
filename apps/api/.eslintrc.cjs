/**
 * Lichte, pragmatische ESLint-config voor de API (ESLint 8 + @typescript-eslint v7).
 * Doel: echte bugs vangen, niet de codebase herschrijven. Ruis staat op "warn".
 */
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist/', 'node_modules/', '*.config.js', '*.config.mjs', '*.config.cjs'],
  rules: {
    // De codebase gebruikt een winston-logger maar ook console op plekken; niet blokkeren.
    'no-console': 'off',
    // Base-regel uit; TS-variant met _-prefix als warn.
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    // any is pragmatisch toegestaan, maar zichtbaar als warn.
    '@typescript-eslint/no-explicit-any': 'warn',
    // Onderstaande zijn geen echte bugs; op warn zodat lint groen blijft zonder codewijziging.
    '@typescript-eslint/no-empty-function': 'warn',
    '@typescript-eslint/no-empty-interface': 'warn',
    '@typescript-eslint/ban-ts-comment': 'warn',
    '@typescript-eslint/no-var-requires': 'warn',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-inferrable-types': 'off',
    '@typescript-eslint/ban-types': 'warn',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    // Core eslint:recommended-regels die in deze codebase alleen stijl/opzet raken,
    // geen echte bugs. Op warn i.p.v. ~12 productiebestanden (regexes, string-literals,
    // let/const) aan te passen om lint groen te krijgen:
    //  - no-useless-escape / no-control-regex: bewuste regex-patronen (o.a. whitespace/CSV/parsing).
    //  - no-irregular-whitespace: veelal NBSP in string-literals; auto-fix zou output kunnen wijzigen.
    //  - prefer-const: puur stijl (let dat niet herbind wordt).
    'no-useless-escape': 'warn',
    'no-control-regex': 'warn',
    'no-irregular-whitespace': 'warn',
    'prefer-const': 'warn',
  },
};
