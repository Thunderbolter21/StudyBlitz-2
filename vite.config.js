// vite.config.js — build + test configuration.
// Imported from 'vitest/config' so the `test` block below configures Vitest too.
import { defineConfig, configDefaults } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// A build id baked into the bundle. CI/Netlify can override it; it changes
// the entry hash each deploy so the stale-bundle swap is observable.
const BUILD_ID = process.env.SB2_BUILD_ID || String(Date.now());

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  build: {
    target: 'es2022',
    // Keep an eye on the performance budget: initial JS must stay
    // under 150 kB gzipped. `npm run build` prints per-chunk gzip sizes.
    reportCompressedSize: true,
  },
  plugins: [
    VitePWA({
      // Our own service worker (src/sw.js) — full control over the cache
      // lifecycle so we can guarantee a new deploy replaces the old bundle.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectRegister: false, // we register manually in main.js
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff,woff2,svg,png,webmanifest}'],
      },
      // Don't run the SW during `npm run dev` — avoids caching churn while
      // developing. It only activates in production builds / preview.
      devOptions: { enabled: false },
      manifest: {
        name: 'StudyBlitz',
        short_name: 'StudyBlitz',
        description: 'Adaptive quizzes from your class notes.',
        theme_color: '#faf6ef',
        background_color: '#7a5f45',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    // The real-Supabase test needs network + credentials; it runs only via
    // `npm run test:integration` (see vitest.integration.config.js).
    exclude: [...configDefaults.exclude, '**/*.integration.test.js'],
  },
});
