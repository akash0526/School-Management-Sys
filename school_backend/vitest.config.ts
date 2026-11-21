import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    fileParallelism: false,
    // makes `npm test` work on a fresh clone with no .env (see tests/setup.ts)
    setupFiles: ['tests/setup.ts'],
  },
});
