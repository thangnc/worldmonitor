import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import pkg from '../../package.json';
import { devApiPlugins } from './vite.dev-api';

/**
 * World Monitor Lite (docs/engineering/architecture/lite.md "Lite UI").
 *
 * The only web app: lite.html and its hashed assets under assets/lite/.
 * `npm run dev` also serves the API routes the UI calls (vite.dev-api.ts).
 *
 * The Vite root is apps/web (this directory), but the app still reads the
 * repository root for what the deploy owns there: `.env*` (envDir and
 * loadEnv), `public/` (publicDir), the app version (root package.json) and
 * the build output `dist/` that vercel.json, the Dockerfiles and turbo read.
 */
const REPO_ROOT = resolve(__dirname, '../..');
const STATIC_SCRIPT_NONCE = 'wm-static-bootstrap';

const LITE_OUTPUT = {
  entryFileNames: 'assets/lite/[name]-[hash].js',
  chunkFileNames: 'assets/lite/[name]-[hash].js',
  assetFileNames: 'assets/lite/[name]-[hash][extname]',
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, REPO_ROOT, '');
  // Dev-server plugins and server-side handlers read API keys from .env.local.
  Object.assign(process.env, env);

  // DEV_PORT overrides the 3000 default; a typo falls back instead of crashing listen().
  const parsedDevPort = Number(env.DEV_PORT);
  const devPort =
    Number.isInteger(parsedDevPort) && parsedDevPort >= 1 && parsedDevPort <= 65535 ? parsedDevPort : 3000;

  return {
    root: __dirname,
    envDir: REPO_ROOT,
    publicDir: resolve(REPO_ROOT, 'public'),
    // Keep the dependency pre-bundle cache where it was before the move.
    cacheDir: resolve(REPO_ROOT, 'node_modules/.vite'),
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      // Vercel sets VERCEL_GIT_COMMIT_SHA on production and preview builds.
      __BUILD_HASH__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev'),
    },
    // The shared CSP is strict-dynamic plus this nonce (vercel.json, nginx).
    html: { cspNonce: STATIC_SCRIPT_NONCE },
    plugins: [tailwindcss(), ...devApiPlugins()],
    // The MapLibre worker (apps/web/src/lite/map/LiteMap.tsx) stays under assets/lite/ with the rest.
    worker: {
      format: 'es',
      rollupOptions: { output: LITE_OUTPUT },
    },
    build: {
      outDir: resolve(REPO_ROOT, 'dist'),
      emptyOutDir: true,
      // Production publishes no source maps (scripts/check-no-public-source-maps.mjs).
      sourcemap: false,
      // maplibre-gl alone is about 1 MB minified.
      chunkSizeWarningLimit: 1100,
      rollupOptions: {
        input: { lite: resolve(__dirname, 'lite.html') },
        output: LITE_OUTPUT,
      },
    },
    server: {
      port: devPort,
      open: '/lite',
      watch: {
        ignored: ['**/test-results/**', '**/playwright-report/**', '**/.playwright-mcp/**'],
      },
    },
  };
});
