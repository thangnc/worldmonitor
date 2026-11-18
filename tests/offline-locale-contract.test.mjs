import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseLocaleList(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([^\\]]+)\\]`));
  assert.ok(match, `expected ${name} declaration`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

describe('offline locale contract', () => {
  const appI18n = readFileSync(join(ROOT, 'src/services/i18n.ts'), 'utf8');
  const offlineScript = readFileSync(join(ROOT, 'scripts/sync-offline-translations.mjs'), 'utf8');
  const supportedLanguages = parseLocaleList(appI18n, 'SUPPORTED_LANGUAGES');
  const generatedLocales = parseLocaleList(offlineScript, 'LOCALES');

  it('keeps the generator locale list aligned with the app registry', () => {
    assert.deepEqual([...generatedLocales].sort(), [...supportedLanguages].sort());
  });
});
