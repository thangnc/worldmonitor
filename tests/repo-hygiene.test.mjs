// These checks pin the tracked archive/playground paths and Mintlify exclusions
// (#8690, section 2).
// Application runtime tests cannot verify Git tracking or documentation exclusions.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function trackedFiles(patterns) {
  const output = execFileSync('git', ['ls-files', ...patterns], {
    cwd: root,
    encoding: 'utf8',
  });
  return output.trim().split('\n').filter(Boolean);
}

test('archival backlog and playground artifacts are not tracked in the repo root', () => {
  const trackedRootArchiveMaterial = trackedFiles([
    'todos/*',
    'plans/*',
    'brief-palette-playground.html',
  ]);

  assert.deepEqual(
    trackedRootArchiveMaterial,
    [],
    `Archive-only material belongs under docs/engineering/archive or docs/engineering/archive/dev-artifacts, not the repo root:\n${trackedRootArchiveMaterial.join('\n')}`,
  );
});
