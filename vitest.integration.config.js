// vitest.integration.config.js — config for the REAL-Supabase integration
// test (`npm run test:integration`). Kept separate so the normal `npm test`
// stays fast, offline, and safe to run anywhere.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.js'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
