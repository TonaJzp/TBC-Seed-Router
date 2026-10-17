// Lint: ESLint's recommended rules on the site, the scripts and the tests.
// `npm run lint`, and in CI before the tests: a warning fails it too.

import js from '@eslint/js';
import globals from 'globals';

export default [
  // Data, fixtures and the local-only harness are not code of the project.
  { ignores: ['public/data/', 'test/fixtures/', '.cache/', '01-TOOLS/', '02-DOCS/', '.rsc/', '.claude/', '.worktrees/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.worker },
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', ignoreRestSiblings: true }],
    },
  },
  {
    files: ['scripts/**', 'test/**', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // A classic script (not a module): it runs before the page paints.
    files: ['public/theme-init.js'],
    languageOptions: { sourceType: 'script' },
  },
];
