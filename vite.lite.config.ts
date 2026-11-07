import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json';

/**
 * World Monitor Lite UI (`/lite`, docs/architecture/lite.md "Lite UI").
 *
 * A separate build, like vite.plugin.config.ts: it shares no Rollup chunk graph
 * with the dashboard, so the dashboard's chunks, bundle budgets and PWA
 * precache stay exactly as upstream builds them. It writes lite.html and its
 * hashed assets into dist/ after the main build (which empties dist/).
 *
 * The dev server serves lite.html through the main vite.config.ts instead.
 */
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_HASH__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev'),
    __CLERK_JS_VERSION__: JSON.stringify(pkg.dependencies['@clerk/clerk-js'].replace(/^[\^~>=<\s]*/, '')),
  },
  // The shared CSP is strict-dynamic plus this nonce (vercel.json, nginx).
  html: { cspNonce: 'wm-static-bootstrap' },
  plugins: [tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    copyPublicDir: false,
    // Production publishes no source maps (scripts/check-no-public-source-maps.mjs).
    sourcemap: false,
    rollupOptions: {
      input: { lite: resolve(__dirname, 'lite.html') },
      output: {
        entryFileNames: 'assets/lite/[name]-[hash].js',
        chunkFileNames: 'assets/lite/[name]-[hash].js',
        assetFileNames: 'assets/lite/[name]-[hash][extname]',
      },
    },
  },
});
