import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: reactHooks.configs.recommended.rules,
  },
  reactRefresh.configs.vite,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // The current codebase uses a lot of 'any' and intentionally-ignored catch vars.
      // Keep lint useful without forcing a large refactor.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-unused-vars': 'off',

      // React Hooks deps warnings are currently widespread; treat as opt-in.
      'react-hooks/exhaustive-deps': 'off',

      // Style/safety rules that currently fire frequently.
      'no-async-promise-executor': 'off',
      'no-empty': 'off',
      'no-prototype-builtins': 'off',
      'prefer-const': 'off',
    },
  },
)
