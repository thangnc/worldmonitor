// Env-source guard by design (#8690, section 2): this suite checks explicit
// Vite env reads and rejects whole-object and dynamic-access source patterns.
// Runtime values after Vite replaces env expressions cannot show which
// source-access pattern produced them.
//
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const runtimeSrc = readFileSync(resolve(__dirname, '../packages/client/services/runtime.ts'), 'utf-8');
describe('runtime env guards', () => {
  it('reads only explicit import.meta.env properties through a guarded ENV wrapper', () => {
    assert.doesNotMatch(
      runtimeSrc,
      /return\s+import\.meta\.env\b/,
      'runtime.ts must not return the whole Vite env object to client code',
    );
    assert.doesNotMatch(
      runtimeSrc,
      /\b(?:const|let|var)\s+\w+\s*=\s*import\.meta\.env\b/,
      'runtime.ts must not snapshot import.meta.env into a local object',
    );
    // The Tauri API bases and the relay host list left with the desktop fetch
    // patch (2026-11); the web runtime reads only the API base.
    for (const key of ['VITE_WS_API_URL']) {
      assert.ok(
        runtimeSrc.includes(`${key}: import.meta.env.${key}`),
        `runtime ENV wrapper must explicitly allow ${key}`,
      );
    }
  });

  it('reads no desktop runtime flag: the desktop detector left with the desktop app', () => {
    assert.doesNotMatch(runtimeSrc, /VITE_DESKTOP_RUNTIME|VITE_TAURI_/);
  });

  it('runtime-config.ts does not dynamically read the Vite env object for secrets', () => {
    const runtimeConfigSrc = readFileSync(resolve(__dirname, '../packages/client/services/runtime-config.ts'), 'utf-8');
    assert.doesNotMatch(
      runtimeConfigSrc,
      /\.env\?\.\[[^\]]+\]/,
      'runtime-config.ts must not dynamically index import.meta.env for runtime secrets',
    );
  });

  it('reuses the guarded ENV wrapper for runtime env lookups', () => {
    assert.ok(runtimeSrc.includes('const WS_API_URL = ENV.VITE_WS_API_URL || \'\''), 'WS API URL should read from ENV');
  });
});
