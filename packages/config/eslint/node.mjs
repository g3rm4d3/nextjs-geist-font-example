// Shared ESLint flat-config for Node.js code (API, shared packages).
// Consumed as: import { nodeConfig } from '@rideshare/config/eslint/node.mjs'
import globals from 'globals';
import { baseConfig } from './base.mjs';

/** @type {import('eslint').Linter.Config[]} */
export const nodeConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];

export default nodeConfig;
