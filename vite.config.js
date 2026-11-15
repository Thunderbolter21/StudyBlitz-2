// vite.config.js — build + test configuration.
// Imported from 'vitest/config' so the `test` block below configures Vitest too.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    // Keep an eye on the performance budget: initial JS must stay
    // under 150 kB gzipped. `npm run build` prints per-chunk gzip sizes.
    reportCompressedSize: true,
  },
  test: {
    environment: 'node',
    // fake-indexeddb is registered per-test-file where needed (Phase 1).
  },
});
