import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      contracts: fileURLToPath(
        new URL('../../libs/contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['apps/api/src/**/*.integration.spec.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 90_000,
    sequence: { concurrent: false },
  },
});
