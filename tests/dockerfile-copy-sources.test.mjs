// Every COPY/ADD source in every tracked Dockerfile must exist in its build
// context. A moved directory (refactor PR 2.2 moved shared/ to
// packages/shared/) otherwise breaks an image only when its service next
// builds: demos/verification-desk/Dockerfile still copied shared/ after the
// move, and no other suite reads its COPY lines.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Build context per Dockerfile, relative to the repository root. Everything
// not listed builds from the root (the documented `docker build -f <file> .`).
const CONTEXT_BY_DOCKERFILE = {
  'consumer-prices-core/Dockerfile': 'consumer-prices-core',
  'docker/Dockerfile.redis-rest': 'docker',
};

const dockerfiles = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((path) => /(^|\/)Dockerfile[^/]*$/.test(path) && !path.endsWith('.dockerignore'));

function copySources(source) {
  const sources = [];
  for (const line of source.replace(/\\\n/g, ' ').split('\n')) {
    const match = line.match(/^\s*(?:COPY|ADD)\s+(.*)$/i);
    if (!match) continue;
    const tokens = match[1].trim().split(/\s+/);
    if (tokens.some((token) => token.startsWith('--from'))) continue;
    const args = tokens.filter((token) => !token.startsWith('--'));
    args.pop(); // destination
    for (const arg of args) {
      if (arg === '.' || /[*?[]/.test(arg) || /^https?:\/\//.test(arg) || arg.startsWith('$')) continue;
      sources.push(arg.replace(/\/$/, ''));
    }
  }
  return sources;
}

describe('Dockerfile COPY sources exist', () => {
  it('finds the tracked Dockerfiles', () => {
    assert.ok(dockerfiles.length >= 10, `expected the repository's Dockerfiles, found ${dockerfiles.length}`);
  });

  it('parses COPY sources and skips multi-stage copies (positive control)', () => {
    assert.deepEqual(
      copySources('COPY --chown=node a.json b/ ./\nCOPY --from=builder /app/dist ./\nADD c \\\n  ./d\n'),
      ['a.json', 'b', 'c'],
    );
  });

  for (const dockerfile of dockerfiles) {
    it(`${dockerfile} copies only paths that exist in its build context`, () => {
      const context = join(root, CONTEXT_BY_DOCKERFILE[dockerfile] ?? '.');
      const missing = copySources(readFileSync(join(root, dockerfile), 'utf8'))
        .filter((path) => !existsSync(join(context, path)));
      assert.deepEqual(missing, [], `${dockerfile} copies paths missing from its build context`);
    });
  }
});
