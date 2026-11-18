import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const braces = require('braces');

describe('installed dependency backports', () => {
  for (const [lockfile, name, version, resolved] of [
    ['package-lock.json', 'braces', '3.0.4-worldmonitor.1', 'file:vendor/braces'],
    ['package-lock.json', 'stream-json', '1.9.2-worldmonitor.1', 'file:vendor/stream-json'],
  ]) {
    it(`${lockfile} selects only the source backport for ${name}`, () => {
      const lock = JSON.parse(readFileSync(new URL(`../${lockfile}`, import.meta.url), 'utf8'));
      const copies = Object.entries(lock.packages).filter(([path]) => path.endsWith(`/${name}`));
      assert.equal(copies.length, 1);
      for (const [, entry] of copies) {
        assert.equal(entry.version, version);
        assert.equal(entry.resolved, resolved);
        assert.equal(entry.link, undefined);
      }
    });
  }

  it('installs the patched source for micromatch without symlinks or install scripts', () => {
    const consumers = [
      [createRequire(require.resolve('micromatch')), 'braces', ['index.js', 'lib/parse.js', 'lib/compile.js', 'lib/expand.js', 'lib/stringify.js', 'lib/constants.js', 'lib/utils.js']],
    ];
    for (const [consumer, name, files] of consumers) {
      const manifest = consumer(`${name}/package.json`);
      assert.equal(manifest.private, true);
      assert.equal(manifest.scripts, undefined);
      for (const file of files) {
        assert.deepEqual(readFileSync(consumer.resolve(`${name}/${file}`)), readFileSync(new URL(`../vendor/${name}/${file}`, import.meta.url)));
      }
    }
  });

});

describe('braces stack-exhaustion remediation', () => {
  for (const method of ['parse', 'compile', 'expand', 'stringify']) {
    for (const [open, close] of [['{', '}'], ['(', ')']]) {
      it(`${method} rejects deep ${open}${close} input within the character limit`, () => {
        const input = open.repeat(3500) + 'a,b' + close.repeat(3500);
        assert.throws(() => braces[method](input), /exceeds max depth/);
        assert.throws(() => braces[method](input, { maxDepth: Infinity }), /exceeds max depth/);
        assert.throws(() => braces[method](input, { maxDepth: 100000 }), /exceeds max depth/);
      });
    }
  }

  for (const method of ['compile', 'expand', 'stringify']) {
    it(`${method} rejects a deep AST supplied directly`, () => {
      const ast = { type: 'root', nodes: [] };
      let node = ast;
      for (let depth = 0; depth < 150; depth++) {
        const child = { type: 'paren', nodes: [], parent: node };
        node.nodes.push(child);
        node = child;
      }
      node.nodes.push({ type: 'text', value: 'a', parent: node });
      assert.throws(() => braces[method](ast), /exceeds max depth/);
    });
  }

  it('preserves ordinary expansion, compilation, literals, and caller depth limits', () => {
    assert.deepEqual(braces.expand('a{1..3}b{c,d}'), ['a1bc', 'a1bd', 'a2bc', 'a2bd', 'a3bc', 'a3bd']);
    assert.equal(braces.compile('{a,b{1..2}}'), '(a|b(1|2))');
    assert.equal(braces.stringify('a{b,c}'), 'a{b,c}');
    assert.doesNotThrow(() => braces.compile('{'.repeat(32) + 'a' + '}'.repeat(32)));
    assert.doesNotThrow(() => braces.compile('"' + '{'.repeat(3500) + '"'));
    assert.throws(() => braces.parse('{{a}}', { maxDepth: 1 }), /exceeds max depth/);
  });
});
