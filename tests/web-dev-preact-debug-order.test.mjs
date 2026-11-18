// In dev, @preact/preset-vite puts `import "preact/debug"` first in the entry,
// and apps/web/vite.config.ts (preactHooksBeforeDebug) puts `preact/hooks`
// before it. With debug evaluated first, LiteMap's marker effects, which
// render() into separate roots, clear debug's "hooks allowed" flag during a
// re-render and the map throws "Hook can only be invoked from render methods".
// This runs the real dev server, so a preset upgrade that changes how it
// injects the debug import fails here instead of silently bringing the error back.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('web dev entry: preact/hooks evaluates before preact/debug', () => {
  let server;
  let base;

  before(async () => {
    // Same as the npm scripts: keep Vite 8's config-loader notice out of the output.
    process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING = 'true';
    server = await createServer({
      configFile: resolve(root, 'apps/web/vite.config.ts'),
      logLevel: 'silent',
      server: { port: 0, strictPort: false, hmr: false, ws: false },
      optimizeDeps: { noDiscovery: true },
    });
    await server.listen();
    const { port } = server.httpServer.address();
    base = `http://localhost:${port}`;
  });

  after(async () => {
    await server?.close();
  });

  it('serves the entry with the hooks import ahead of the debug import', async () => {
    // The preset finds the entry through the page's module script.
    const html = await (await fetch(`${base}/lite.html`)).text();
    const src = html.match(/<script type="module" src="([^"]+main\.tsx)"/)?.[1];
    assert.ok(src, 'lite.html loads the entry as a module script');

    const code = await (await fetch(`${base}${src}`)).text();
    const imports = [...code.matchAll(/^import\s+"([^"]+)";?$/gm)].map((m) => m[1]);
    const hooks = imports.findIndex((spec) => /preact[_/]hooks/.test(spec));
    const debug = imports.findIndex((spec) => /preact[_/]debug/.test(spec));
    assert.ok(debug >= 0, `the preset injects preact/debug in dev; bare imports: ${imports.join(', ')}`);
    assert.ok(hooks >= 0 && hooks < debug, `preact/hooks comes before preact/debug; bare imports: ${imports.join(', ')}`);
  });
});
