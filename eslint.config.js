// Baseline lint configuration. The repository's boundary and safety lint
// rules (network identifiers, the Web Serial API, innerHTML, warning strings)
// are added by P0-02; see ROADMAP_TASKS.md.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.wrangler/**', '**/coverage/**'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);
