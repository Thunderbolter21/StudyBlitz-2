// vite.config.js — build + test configuration.
// Imported from 'vitest/config' so the `test` block below configures Vitest too.
import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    // Keep an eye on the performance budget: initial JS must stay
    // under 150 kB gzipped. `npm run build` prints per-chunk gzip sizes.
    reportCompressedSize: true,
  },
  test: {
    environment: 'node',
    // The real-Supabase test needs network + credentials; it runs only via
    // `npm run test:integration` (see vitest.integration.config.js).
    exclude: [...configDefaults.exclude, '**/*.integration.test.js'],
  },
});
