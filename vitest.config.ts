import { defineConfig } from 'vitest/config';

// Non-interactive by default (`vitest run` in package.json). No browser, no network,
// no paid provider calls: generation tests must use fixtures or mocked responses.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    watch: false,
    testTimeout: 15_000,
  },
});
