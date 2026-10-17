import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

export default tseslint.config(
  {
    ignores: ['dist/', 'dev-dist/', 'node_modules/', 'playwright-report/', 'test-results/', 'certs/', 'public/pdfjs/'],
  },
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.svelte'] },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'svelte/no-at-html-tags': 'off',
      // Lokale Hilfs-Sets/Maps sind nicht reaktiv gemeint; reaktiver Zustand wird ersetzt statt mutiert.
      'svelte/prefer-svelte-reactivity': 'off',
    },
  },
);
