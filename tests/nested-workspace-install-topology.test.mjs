// Nested workspaces carry their own lockfiles, and installing one takes
// minutes. Whichever script installs them decides how many CI jobs pay that
// cost.
//
// Regression motivation: postinstall used to run `npm --prefix blog-site ci`,
// so every `npm ci` in the matrix installed the blog — including the DOM,
// unit, typecheck and lint jobs, none of which read a single file from it. That
// install was ~5 minutes against a 10-minute job budget and timed the job out
// three times in a row while the tests themselves passed in seconds.
//
// The rule: a nested workspace is installed by the script or service that
// needs it, never by postinstall.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { scripts } = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));

// Every directory below the root that tracks its own npm lockfile.
const NESTED_WORKSPACES = execFileSync('git', ['ls-files', '*/package-lock.json'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .map((file) => dirname(file));

describe('nested workspace install topology', () => {
  it('finds the nested workspaces to check', () => {
    assert.ok(NESTED_WORKSPACES.length > 0, 'expected at least one nested workspace with its own lockfile');
  });

  for (const name of NESTED_WORKSPACES) {
    it(`postinstall does not install ${name}`, () => {
      const installs = new RegExp(`--prefix\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(?:ci|install)\\b`);
      assert.ok(
        !installs.test(scripts.postinstall ?? ''),
        `postinstall must not install ${name}. Every npm ci in CI pays that cost, including `
          + 'the jobs that never read the workspace, and it has timed test jobs out before.',
      );
    });
  }

  it('postinstall stays cheap enough for a test job to afford', () => {
    // inventory:facts is a boot artifact the whole repo reads and it runs in
    // under a second. Anything heavier belongs behind the script that needs it.
    assert.equal(scripts.postinstall, 'npm run inventory:facts');
  });
});
