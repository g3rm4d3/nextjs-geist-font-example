import { nodeConfig } from '@rideshare/config/eslint/node.mjs';

export default [
  ...nodeConfig,
  {
    ignores: ['migrations/**'],
  },
  {
    // Standalone CLI scripts — console output *is* their interface.
    files: ['src/migrate.ts', 'src/seed.ts', 'src/reset.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];
