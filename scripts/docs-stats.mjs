#!/usr/bin/env node
/**
 * docs-stats — derived inventory metrics plus the documentation contracts that
 * still have a subject after the public docs site left (refactor 1c-3).
 *
 * --check asserts that:
 *   - every CI workflow is listed in ARCHITECTURE.md's CI/CD table;
 *   - CLAUDE.md and CONTRIBUTING.md name the pinned sebuf version;
 *   - every /api/health summary example under docs/engineering/ matches the
 *     probed-key registry in api/health.js.
 *
 * computeStats() also feeds scripts/generate-inventory-facts.mjs, which writes
 * the inventory artifacts atomically.
 *
 * Stats are parsed from source text without executing TypeScript, loading its
 * import graph, or requiring installed packages. This keeps the generator
 * usable in dependency-free CI and container build stages.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { buildSourceAttributionStats } from './source-attribution.mjs';
import { extractAssignedObjectBlock } from './lib/js-source-structure.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// #6702: tests that stage probe trees redirect the module at a throwaway
// copy (see withStatsRoot below) so a sibling test scanning the REAL repo
// can never observe the probe. null means the real ROOT.
let rootOverride = null;
const rootOf = () => rootOverride ?? ROOT;
const read = (p) => readFileSync(join(rootOf(), p), 'utf8');
const filesIn = (p) =>
  readdirSync(join(rootOf(), p), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);

function sorted(items) {
  return [...items].sort();
}

function sameStringSet(a, b) {
  const left = sorted(a);
  const right = sorted(b);
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

function describeSetDelta(found, expected) {
  const foundSet = new Set(found);
  const expectedSet = new Set(expected);
  const missing = sorted(expected.filter((v) => !foundSet.has(v)));
  const extra = sorted(found.filter((v) => !expectedSet.has(v)));
  return [
    missing.length ? `missing: ${missing.join(', ')}` : '',
    extra.length ? `extra: ${extra.join(', ')}` : '',
  ].filter(Boolean).join('; ');
}

function stripCommentsAndTemplates(source) {
  let output = '';
  let state = 'code';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === 'code') {
      if (character === '/' && next === '/') {
        output += '  ';
        state = 'line-comment';
        index += 1;
      } else if (character === '/' && next === '*') {
        output += '  ';
        state = 'block-comment';
        index += 1;
      } else if (character === '`') {
        output += ' ';
        state = 'template';
      } else {
        output += character;
        if (character === "'") state = 'single-quote';
        if (character === '"') state = 'double-quote';
      }
      continue;
    }
    if (state === 'line-comment') {
      output += character === '\n' ? '\n' : ' ';
      if (character === '\n') state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        output += '  ';
        state = 'code';
        index += 1;
      } else {
        output += character === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (state === 'template') {
      output += character === '\n' ? '\n' : ' ';
      if (character === '\\') {
        if (next === '\n') output += '\n';
        else output += ' ';
        index += 1;
      } else if (character === '`') {
        state = 'code';
      }
      continue;
    }
    output += character;
    if (character === '\\') {
      output += next ?? '';
      index += 1;
    } else if (
      (state === 'single-quote' && character === "'")
      || (state === 'double-quote' && character === '"')
    ) {
      state = 'code';
    }
  }
  if (state === 'block-comment' || state === 'template' || state.endsWith('quote')) {
    throw new Error(`docs-stats: unterminated ${state} in LAYER_REGISTRY`);
  }
  return output;
}

function readCallArguments(source, argumentsStart) {
  const argumentsList = [];
  let current = '';
  let quote = null;
  let depth = 0;
  for (let index = argumentsStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      current += character;
      if (character === '\\') {
        current += source[index + 1] ?? '';
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
    } else if ('([{'.includes(character)) {
      depth += 1;
      current += character;
    } else if (')]}'.includes(character)) {
      if (character === ')' && depth === 0) {
        argumentsList.push(current.trim());
        return { args: argumentsList, end: index };
      }
      depth -= 1;
      if (depth < 0) throw new Error('docs-stats: unbalanced LAYER_REGISTRY def() call');
      current += character;
    } else if (character === ',' && depth === 0) {
      argumentsList.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  throw new Error('docs-stats: unterminated LAYER_REGISTRY def() call');
}

function parseLayerRegistry(source) {
  const start = source.indexOf('export const LAYER_REGISTRY');
  const end = source.indexOf('export const V1_LAYER_EXPLANATION_KEYS', start);
  if (start === -1 || end === -1) {
    throw new Error('docs-stats: could not find the complete LAYER_REGISTRY block');
  }
  const registryBlock = stripCommentsAndTemplates(source.slice(start, end));
  let cursor = registryBlock.indexOf('{');
  if (cursor === -1) throw new Error('docs-stats: LAYER_REGISTRY must be an object literal');
  cursor += 1;
  const declaredKeys = [];
  const mismatchedKeys = [];
  const lockedKeys = [];
  while (cursor < registryBlock.length) {
    while (/\s|,/.test(registryBlock[cursor] ?? '')) cursor += 1;
    if (registryBlock[cursor] === '}') break;
    if (registryBlock.startsWith('...', cursor)) {
      throw new Error('docs-stats: LAYER_REGISTRY spread properties are not supported');
    }
    if (registryBlock[cursor] === '[') {
      throw new Error('docs-stats: LAYER_REGISTRY computed properties are not supported');
    }

    let key = '';
    const quote = registryBlock[cursor] === "'" || registryBlock[cursor] === '"'
      ? registryBlock[cursor]
      : null;
    if (quote) {
      cursor += 1;
      while (cursor < registryBlock.length && registryBlock[cursor] !== quote) {
        if (registryBlock[cursor] === '\\') {
          throw new Error('docs-stats: LAYER_REGISTRY property keys must not use escapes');
        }
        key += registryBlock[cursor];
        cursor += 1;
      }
      if (registryBlock[cursor] !== quote) {
        throw new Error('docs-stats: unterminated LAYER_REGISTRY property key');
      }
      cursor += 1;
    } else {
      const identifier = registryBlock.slice(cursor).match(/^[A-Za-z_$][\w$]*/)?.[0];
      if (!identifier) throw new Error('docs-stats: every LAYER_REGISTRY property must have a static key');
      key = identifier;
      cursor += identifier.length;
    }
    if (!/^[A-Za-z_$][\w$]*$/.test(key)) {
      throw new Error(`docs-stats: invalid LAYER_REGISTRY property key ${key}`);
    }
    while (/\s/.test(registryBlock[cursor] ?? '')) cursor += 1;
    if (registryBlock[cursor] !== ':') {
      throw new Error(`docs-stats: LAYER_REGISTRY property ${key} must be an assignment`);
    }
    cursor += 1;
    while (/\s/.test(registryBlock[cursor] ?? '')) cursor += 1;
    if (!registryBlock.startsWith('def(', cursor)) {
      throw new Error(`docs-stats: LAYER_REGISTRY property ${key} must use def()`);
    }
    const { args, end: callEnd } = readCallArguments(registryBlock, cursor + 4);
    cursor = callEnd + 1;
    declaredKeys.push(key);
    const definitionKey = args[0]?.match(/^(['"])([A-Za-z_$][\w$]*)\1$/)?.[2];
    if (!definitionKey) {
      throw new Error(`docs-stats: LAYER_REGISTRY property ${key} needs a static def() key`);
    }
    if (key !== definitionKey) mismatchedKeys.push(`${key} -> ${definitionKey}`);
    if (/^(['"])locked\1$/.test(args[5] ?? '')) lockedKeys.push(key);
  }
  if (declaredKeys.length === 0) {
    throw new Error('docs-stats: LAYER_REGISTRY extraction was empty');
  }
  if (new Set(declaredKeys).size !== declaredKeys.length) {
    throw new Error('docs-stats: LAYER_REGISTRY contains duplicate keys');
  }
  if (mismatchedKeys.length > 0) {
    throw new Error(
      `docs-stats: every LAYER_REGISTRY property must be a matching def('<key>', ...) call; mismatched: ${mismatchedKeys.join(', ')}`,
    );
  }
  return {
    keys: sorted(declaredKeys),
    lockedKeys: sorted(lockedKeys),
  };
}

// Brace-balanced rather than a `\{([\s\S]*?)\n\};` match. The non-greedy form
// silently runs PAST its own object whenever the declaration is not in the
// expected multi-line shape — `= {};` on one line captured everything up to
// some later block's closing brace and parsed that instead. Counting braces
// bounds the body to the object actually declared. Safe here because these
// blocks hold only header strings, which contain no braces.
// Skip wrappers (`Object.freeze(`, `Object.seal(`, JSDoc `/** @type … */ (`)
// between `=` and `{`; JSDoc braces are comments, not the literal (#7115).
// Any other callee is a parse failure so a helper that transforms the object
// cannot silently pass against the argument literal.
const OBJECT_WRAPPER_IDENTIFIERS = new Set(['Object.freeze', 'Object.seal']);

function parseObjectBlockBody(source, declaration, label) {
  const body = extractAssignedObjectBlock(source, declaration, OBJECT_WRAPPER_IDENTIFIERS);
  if (body === null) {
    throw new Error(`docs-stats: could not parse ${label}`);
  }
  return body;
}

// ---- /api/health probed-key registry (api/health.js) ----
//
// Four published example responses quote `summary.total`, which is the single
// number a reader uses to sanity-check whether their own response looks
// complete. #6300: all four sat at 194 while production reported 256 — a
// quarter of the fleet missing — and the figure had been copied forward often
// enough (two English pages, two zh mirrors, plus a PR body quoting them) that
// the agreement read as corroboration rather than as one stale number.
//
// Text-parsed rather than imported, like every other stat here: the docs-stats
// CI job runs on bare Node with no `npm install`, and the runtime registry size
// additionally depends on process.env.IRAN_EVENTS_ENABLED — an env-dependent
// number must not land in a build-owned artifact.
//
// The two object literals are NOT the whole registry: health.js mutates them
// after declaration. Hardcoding that arithmetic is the same trap the docs fell
// into — it would keep reporting a confident number that silently drifts the
// moment a third mutation lands. So every mutation site is DISCOVERED and must
// be one this function accounts for; an unrecognized one fails the gate loudly
// instead of quietly publishing a wrong total.
const HEALTH_PROBED_REGISTRIES = ['BOOTSTRAP_KEYS', 'STANDALONE_KEYS'];

const HEALTH_REGISTRY_MUTATION_RE = new RegExp(
  [
    // `delete BOOTSTRAP_KEYS.iranEvents;`
    String.raw`delete\s+(?:BOOTSTRAP_KEYS|STANDALONE_KEYS)\s*[.[][^\n]*`,
    // `BOOTSTRAP_KEYS[name] = ...;` — including the compound forms (`??=`,
    // `||=`, `&&=`), which register a key just as effectively. The `[^=]` tail
    // keeps reads (`STANDALONE_KEYS[sibling] ?? …`) and `===` out of the match.
    String.raw`(?:BOOTSTRAP_KEYS|STANDALONE_KEYS)\s*(?:\[[^\]]*\]|\.\w+)\s*(?:\?\?|\|\||&&)?=[^=][^\n]*`,
    // `Object.assign(BOOTSTRAP_KEYS, …)` / `Object.defineProperty(…)`
    String.raw`Object\.(?:assign|defineProperty|defineProperties)\(\s*(?:BOOTSTRAP_KEYS|STANDALONE_KEYS)[^\n]*`,
    // Aliasing the registry to another binding — writes through the alias are
    // invisible to every pattern above, so the alias itself is the mutation
    // site to flag. `\s*[;,)]` keeps ordinary indexed reads
    // (`… ?? BOOTSTRAP_KEYS[sibling]`, followed by `[`) out of the match.
    String.raw`=\s*(?:BOOTSTRAP_KEYS|STANDALONE_KEYS)\s*[;,)][^\n]*`,
  ].join('|'),
  'g',
);

// Comments are blanked before the mutation scan and the registry-body parse.
// Two distinct silent failures come from reading them as code:
//   1. A commented-out `// delete BOOTSTRAP_KEYS.iranEvents;` normalizes to the
//      exact accounted string, satisfying the very presence check whose error
//      message is "stale arithmetic" while the runtime registry keeps the key.
//   2. `parseObjectBlockBody` counts raw braces, so one `}` inside a comment in
//      a registry literal ends the block early and yields a confident short
//      count rather than an error.
// Blanked in place (not deleted) so line and column offsets survive — the key
// matcher below keys on an exact two-space indent.
//
// LINE comments must go FIRST. api/health.js:793 contains the line comment
// `// list synchronized with consumer-prices-core/configs/retailers/*.yaml.`,
// whose `/*` opens a block comment that the block matcher then runs 1098 lines
// to the next `*/` to close — blanking the consumer-price loop, the iranEvents
// delete, and most of STANDALONE_KEYS along with it. Stripping line comments
// first removes that text before any `/*` is looked for.
//
// A `/*` inside a string or regex literal would still mislead the block pass;
// nothing in this file has one today, and the registry cross-count plus the
// runtime-pinning test both fail loudly if that ever changes.
const blankComments = (src) => src
  .replace(/^([ \t]*)\/\/[^\n]*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

// Every mutation this function knows how to price, in `normalizeMutation` form
// (trimmed, inner whitespace collapsed). Adding a mutation to api/health.js
// means teaching this list what it does to the count — that is the point.
const HEALTH_REGISTRY_ACCOUNTED_MUTATIONS = [
  // +1 per consumer-price market other than `ae` (which keeps its historical
  // name in the BOOTSTRAP_KEYS literal).
  'BOOTSTRAP_KEYS[name] = `consumer-prices:coverage:${market}`;',
  // -1: the iran-events sunset drops the key unless IRAN_EVENTS_ENABLED=true,
  // which defaults to false — so the documented (production) registry omits it.
  'delete BOOTSTRAP_KEYS.iranEvents;',
  // -1: the strike-pressure tally (since CII v12) is produced by the same relay loop,
  // so the same switch drops it from STANDALONE_KEYS.
  'delete STANDALONE_KEYS.strikePressure;',
];

const normalizeMutation = (line) => line.trim().replace(/\s+/g, ' ');

// Depth-1 entries of a registry object literal. parseObjectBlockBody preserves
// the original indentation, so a top-level key sits at exactly two spaces; a
// nested object's keys would sit at four or more and are correctly excluded.
function countRegistryEntries(source, name) {
  const body = parseObjectBlockBody(source, `const ${name}`, `${name} in api/health.js`);
  // The literal's closing brace sits at column 0, so a correctly bounded body
  // ends on a blank line. Anything else means the brace counter stopped early
  // on a brace inside a string, and the short count that follows would look
  // perfectly plausible.
  if (!/\n[ \t]*$/.test(body)) {
    throw new Error(`docs-stats: ${name} in api/health.js did not terminate at a top-level closing brace`);
  }
  const keys = [...body.matchAll(/^ {2}([A-Za-z_$][\w$]*):/gm)].map((m) => m[1]);
  if (keys.length === 0) throw new Error(`docs-stats: ${name} in api/health.js yielded no keys`);
  const dupe = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dupe) throw new Error(`docs-stats: ${name} in api/health.js declares "${dupe}" twice`);
  // Whole-body conformance check. The matcher above reads exactly ONE shape —
  // a bare identifier key at a two-space indent, one per line — and silently
  // ignores every other legal shape: a quoted key, a computed `[CONST]` key, a
  // `...SPREAD`, a key indented four spaces, a second key on the same line.
  // Each of those changes `Object.entries(registry)` without changing this
  // count, and `keys.length === 0` is far too weak an alarm for that.
  //
  // Both registries are uniformly flat today (every value is a string literal
  // or an identifier, one entry per line), so demanding that EVERY non-blank
  // line conform is a true invariant rather than a guess. A future entry shape
  // that breaks it gets an explicit "teach the counter" failure instead of a
  // quietly smaller number. Comments are already blanked by the caller.
  const nonConforming = body
    .split('\n')
    .filter((line) => line.trim() !== '' && !/^ {2}[A-Za-z_$][\w$]*:\s*\S/.test(line));
  if (nonConforming.length) {
    throw new Error(
      `docs-stats: ${name} in api/health.js has ${nonConforming.length} entr${nonConforming.length === 1 ? 'y' : 'ies'} `
      + `this counter cannot read (it reads one identifier key per line at a two-space indent): `
      + `${nonConforming.map((l) => l.trim()).join(' | ')}`,
    );
  }
  // A second key sharing a conforming line still counts once. Every entry ends
  // in a trailing comma, so comparing comma count to key count catches it.
  const commas = (body.match(/,/g) || []).length;
  if (commas !== keys.length) {
    throw new Error(
      `docs-stats: ${name} in api/health.js has ${commas} entry terminators but ${keys.length} readable keys `
      + '— more than one entry on a line, or a value containing a comma.',
    );
  }
  return keys;
}

// summary.total is one entry per key in EVERY registry the endpoint's `sources`
// array walks — not per key in the two registries this function happens to
// price. Adding a third registry there is the single edit that reproduces #6300
// exactly: production grows while every gate stays pinned at the old number.
// So read the array rather than assume it.
function parseProbedRegistries(source) {
  const block = source.match(/const sources = \[([\s\S]*?)\n {2}\];/);
  if (!block) throw new Error('docs-stats: could not parse the `sources` registry array in api/health.js');
  const listed = [...block[1].matchAll(/\[\s*([A-Za-z_$][\w$]*)\s*,/g)].map((m) => m[1]);
  if (!sameStringSet(listed, HEALTH_PROBED_REGISTRIES)) {
    throw new Error(
      'docs-stats: api/health.js probes a different set of key registries than parseHealthProbedKeys prices '
      + `(${describeSetDelta(listed, HEALTH_PROBED_REGISTRIES)}) — summary.total cannot be derived.`,
    );
  }
  return listed;
}

function parseHealthProbedKeys(rawSource = read('api/health.js')) {
  const source = blankComments(rawSource);
  parseProbedRegistries(source);

  // The registry size equals summary.total only because the endpoint counts
  // every entry unconditionally. A `continue` or a variant/env gate inserted
  // ahead of the increment would shrink production's total while this parse —
  // and the unit test that pins it to `Object.keys(...).length` — stayed put.
  if (!/for \(const \[name, redisKey\] of Object\.entries\(registry\)\) \{\s*\n\s*totalChecks\+\+;/.test(source)) {
    throw new Error(
      'docs-stats: api/health.js no longer counts every registry entry unconditionally, '
      + 'so summary.total is no longer the registry size.',
    );
  }

  const found = [...source.matchAll(HEALTH_REGISTRY_MUTATION_RE)].map((m) => normalizeMutation(m[0]));
  const unaccounted = found.filter((m) => !HEALTH_REGISTRY_ACCOUNTED_MUTATIONS.includes(m));
  if (unaccounted.length) {
    throw new Error(
      'docs-stats: api/health.js mutates its key registries in a way parseHealthProbedKeys does not '
      + `account for, so summary.total cannot be derived: ${sorted(unaccounted).join(' | ')}. `
      + 'Teach HEALTH_REGISTRY_ACCOUNTED_MUTATIONS what it does to the count.',
    );
  }
  for (const expected of HEALTH_REGISTRY_ACCOUNTED_MUTATIONS) {
    if (!found.includes(expected)) {
      throw new Error(
        `docs-stats: api/health.js no longer contains the accounted-for mutation \`${expected}\` — `
        + 'summary.total would be derived from stale arithmetic.',
      );
    }
  }

  const bootstrapKeys = countRegistryEntries(source, 'BOOTSTRAP_KEYS');
  const standaloneKeys = countRegistryEntries(source, 'STANDALONE_KEYS');

  // +N: the consumer-price loop registers every market except `ae`.
  const marketsBlock = source.match(/const CONSUMER_PRICE_HEALTH_MARKETS = Object\.freeze\(\[([^\]]*)\]\)/);
  if (!marketsBlock) {
    throw new Error('docs-stats: could not parse CONSUMER_PRICE_HEALTH_MARKETS in api/health.js');
  }
  const markets = [...marketsBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (!markets.includes('ae')) {
    throw new Error("docs-stats: CONSUMER_PRICE_HEALTH_MARKETS no longer contains 'ae', which the loop skips");
  }
  if (!/if \(market === 'ae'\) continue;/.test(source)) {
    throw new Error("docs-stats: the consumer-price health loop no longer skips 'ae'");
  }
  // Mirror of the iranEvents presence guard below. `BOOTSTRAP_KEYS[name] = …`
  // OVERWRITES a same-named literal entry at runtime (count unchanged) while
  // this parse would add one for it — so a market name also declared in the
  // literal over-counts by one, exactly as a missing iranEvents would
  // under-count by one.
  const addedNames = markets.filter((m) => m !== 'ae').map((m) => `consumerPricesCoverage${m.toUpperCase()}`);
  // Same overwrite semantics within the market list itself: a repeated market
  // assigns the same property twice at runtime (count unchanged) while a naive
  // `.length` here would add one per iteration.
  const repeated = addedNames.find((n, i) => addedNames.indexOf(n) !== i);
  if (repeated) {
    throw new Error(
      `docs-stats: CONSUMER_PRICE_HEALTH_MARKETS yields "${repeated}" more than once — `
      + 'the runtime registers it once while this count would add it per occurrence.',
    );
  }
  const collision = addedNames.find((name) => bootstrapKeys.includes(name));
  if (collision) {
    throw new Error(
      `docs-stats: BOOTSTRAP_KEYS already declares "${collision}", which the consumer-price loop also `
      + 'registers — the runtime overwrites it while this count would add it twice.',
    );
  }
  const addedMarkets = addedNames.length;

  // -1: iran-events is sunset unless IRAN_EVENTS_ENABLED=true (default false).
  // Asserting it is present in the literal keeps the subtraction from
  // double-counting a key that was already removed from the declaration.
  if (!bootstrapKeys.includes('iranEvents')) {
    throw new Error('docs-stats: BOOTSTRAP_KEYS no longer declares iranEvents, so the sunset delete subtracts twice');
  }
  if (!/const IRAN_EVENTS_ENABLED = .*\?\? 'false'/.test(source)) {
    throw new Error('docs-stats: IRAN_EVENTS_ENABLED no longer defaults to false — the documented registry size changed');
  }

  // The effective registries: the literal, plus the loop's markets, minus the
  // sunset key. Names — not just counts — so the unit test can compare SETS
  // against the imported runtime registries; two compensating errors (one real
  // key missed, one phantom invented) net to an identical count but not to an
  // identical set. computeStats stores only the counts: dumping 256 key names
  // into the committed stats.json would bury the claims it actually publishes.
  if (!standaloneKeys.includes('strikePressure')) {
    throw new Error('docs-stats: STANDALONE_KEYS no longer declares strikePressure, so the sunset delete subtracts twice');
  }
  const effectiveBootstrap = [...bootstrapKeys, ...addedNames].filter((k) => k !== 'iranEvents');
  const effectiveStandalone = standaloneKeys.filter((k) => k !== 'strikePressure');
  const bootstrap = bootstrapKeys.length + addedMarkets - 1;
  const standalone = standaloneKeys.length - 1;
  if (effectiveBootstrap.length !== bootstrap) {
    throw new Error(`docs-stats: internal — bootstrap arithmetic (${bootstrap}) disagrees with its key list (${effectiveBootstrap.length})`);
  }
  return {
    bootstrap,
    standalone,
    total: bootstrap + standalone,
    bootstrapKeys: effectiveBootstrap,
    standaloneKeys: effectiveStandalone,
  };
}

function makefileVar(text, name) {
  const match = text.match(new RegExp(`^${name}\\s*:=\\s*(\\S+)`, 'm'));
  if (!match) throw new Error(`docs-stats: could not find ${name} in Makefile`);
  return match[1];
}

function readdirPresentSync(abs) {
  try {
    return readdirSync(abs, { withFileTypes: true });
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return [];
    throw error;
  }
}

function walk(rel, out = []) {
  for (const e of readdirPresentSync(join(rootOf(), rel))) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(child, out);
    else out.push(child);
  }
  return out;
}

// #6702: run a callback against a throwaway COPY of the repo tree. Probe
// tests use this so they never mutate (or transiently create paths inside)
// the real checkout a sibling test may be scanning concurrently.
export async function withStatsRoot(fn) {
  const { cpSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const sandbox = mkdtempSync(join(tmpdir(), 'wm-docs-stats-'));
  const previous = rootOverride;
  rootOverride = sandbox;
  try {
    // Full tree minus the heavy/vendor directories: computeStats reads a
    // wide surface (api/, docs/, src/, shared/, data/...), and a missing
    // file throws rather than counting as zero.
    const entries = readdirSync(ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'target') {
        continue;
      }
      try {
        cpSync(join(ROOT, entry.name), join(sandbox, entry.name), {
          recursive: true,
          filter: (from) => basename(from) !== 'node_modules',
        });
      } catch {
        // A path that cannot be copied (platform link, transient state): the
        // stat reports zero for whatever lived there, same as a repo
        // without it.
      }
    }
    return await fn(sandbox);
  } finally {
    rootOverride = previous;
    rmSync(sandbox, { recursive: true, force: true });
  }
}

// Local leftovers (empty `api/[domain]/v1` after a dirty checkout) are not
// endpoints. Git cannot track empty trees, so a readdir count that includes
// them writes a stats.json CI cannot reproduce.
function dirHasFiles(rel) {
  for (const e of readdirPresentSync(join(rootOf(), rel))) {
    if (e.name.startsWith('.')) continue;
    const child = `${rel}/${e.name}`;
    if (e.isFile()) return true;
    if (e.isDirectory() && dirHasFiles(child)) return true;
  }
  return false;
}

function computeStats({ sourceAttribution: suppliedAttribution } = {}) {
  const makefile = read('Makefile');

  // ---- Map layers (src/config/map-layer-definitions.ts) ----
  const mld = read('src/config/map-layer-definitions.ts');
  const { keys: layerKeys } = parseLayerRegistry(mld);
  const layerDefinitions = layerKeys.length;

  const variantBlock = mld.slice(mld.indexOf('VARIANT_LAYER_ORDER'), mld.indexOf('export function getLayersForVariant'));
  const variantLayers = {};
  for (const m of variantBlock.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    variantLayers[m[1]] = (m[2].match(/'[^']+'/g) || []).length;
  }
  const variantCount = Object.keys(variantLayers).length;

  // ---- Panel subclasses across src/components ----
  // The old dashboard's src/components/ is gone (refactor Phase 1), so this
  // count is 0 unless the directory comes back.
  const panelClasses = walk('src/components')
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .reduce((n, f) => n + (read(f).match(/class\s+\w+\s+extends\s+Panel\b/g) || []).length, 0);

  // ---- User-facing locales (src/locales/*.json, excluding shell fragments) ----
  // The Lite UI ships English only, as the en.shell.json fragment; a locale
  // with only a shell fragment still counts as a supported interface language.
  const localeCodes = [...new Set(filesIn('src/locales')
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/(?:\.shell)?\.json$/, '')))]
    .sort();
  const locales = localeCodes.length;

  // ---- CI workflows (.github/workflows/*.yml) ----
  const workflows = filesIn('.github/workflows').filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).sort();

  // ---- Freshness-tracked sources (src/services/data-freshness.ts) ----
  // The dashboard's freshness tracker left with the dashboard (refactor Phase 1).
  let dfs = '';
  try {
    dfs = read('src/services/data-freshness.ts');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const dfsStart = dfs.indexOf('const SOURCE_METADATA');
  const dfsClass = dfs.indexOf('class ', dfsStart);
  const metaBlock = dfs.slice(dfsStart, dfsClass >= 0 ? dfsClass : dfs.length);
  const freshnessSources = (metaBlock.match(/^\s+\w+:\s*\{\s*name:/gm) || []).length;

  // ---- Feed definitions (packages/shared/news-catalog.json) ----
  // One record per feed; a feed placed in several categories counts once.
  const feedDefinitions = JSON.parse(read('packages/shared/news-catalog.json')).feeds.length;

  // ---- Source attribution inventory (scripts/server/api/src URL contracts) ----
  // Keep this separate from the feed-label count: one provider can expose
  // several feed URLs, while a structured endpoint may never appear in the
  // curated-feed registry. The attribution checker owns manifest coverage.
  const sourceAttribution = suppliedAttribution ?? buildSourceAttributionStats({ rootDir: rootOf() });

  return {
    _generated: 'scripts/generate-inventory-facts.mjs — build artifact; do not commit',
    layerDefinitions,
    variantLayers,
    variantCount,
    panelClasses,
    localeCodes,
    locales,
    workflows,
    workflowCount: workflows.length,
    freshnessSources,
    feedDefinitions,
    sourceAttribution,
    sourceAttributionHosts: sourceAttribution.activeHosts,
    sebufVersion: makefileVar(makefile, 'SEBUF_VERSION'),
    // Counts only — see parseHealthProbedKeys on why the key names stay out.
    healthProbedKeys: (({ bootstrap, standalone, total }) => ({ bootstrap, standalone, total }))(
      parseHealthProbedKeys(),
    ),
  };
}

/**
 * Registered exact document claims. `value` returns the expected value; the
 * regex must capture group 1.
 */
function claims(s) {
  return [
    // The generator version is a toolchain compatibility contract, not an
    // inventory total. Its documented value must stay exact.
    { file: 'CLAUDE.md', re: /requires buf \+ sebuf (v\d+\.\d+\.\d+) plugins/, value: s.sebufVersion },
    { file: 'CONTRIBUTING.md', re: /currently \*\*(v\d+\.\d+\.\d+)\*\*/, value: s.sebufVersion },
  ];
}

// ---- /api/health summary example bodies (#6300) ----
//
// `"onDemandWarn"` is the anchor: it is unique to this endpoint's summary
// object, and the double quotes keep it inside JSON examples rather than the
// surrounding prose, which names the same field in backticks.
const HEALTH_SUMMARY_ANCHOR = '"onDemandWarn"';

// The floor: scope is DISCOVERED so a sibling page nobody remembered gets
// checked too, but a known surface that loses its example must fail rather than
// drop quietly out of scope. The public docs site (and its zh mirrors) left in
// refactor 1c-3; the endpoint guide moved to docs/engineering/.
const HEALTH_SUMMARY_DOC_FILES = [
  'docs/engineering/architecture/health-endpoints.md',
];

function healthSummaryDocSources(pages = null) {
  const candidates = pages ?? Object.fromEntries(
    walk('docs/engineering').filter((f) => f.endsWith('.md')).map((file) => [file, read(file)]),
  );
  const docs = {};
  const failures = [];
  for (const [file, text] of Object.entries(candidates)) {
    if (text.includes(HEALTH_SUMMARY_ANCHOR)) docs[file] = text;
  }
  for (const file of HEALTH_SUMMARY_DOC_FILES) {
    if (docs[file]) continue;
    failures.push(
      `${file}: known /api/health surface no longer publishes a summary example (missing ${HEALTH_SUMMARY_ANCHOR})`,
    );
  }
  return { docs, failures };
}

// EVERY summary block on a publishing page is checked, not just the first.
// That is the whole reason this is a validator and not a claim: `claims()` uses
// `text.match()`, so appending a second example body below the pinned one would
// publish a number the gate never reads — reproducing #6300 on a docs-only PR,
// which also skips the `unit` job and so gets no other coverage at all.
//
// Two properties are asserted per block, and only two, so a page stays free to
// illustrate a WARNING fleet rather than only an all-OK one:
//   - `total` equals the registry size. True of any response, whatever its status.
//   - the buckets sum to `total`. `summary.warn` is already net of onDemandWarn
//     (api/health.js computes `realWarnCount = counts.warn - counts.onDemandWarn`),
//     and rolloutPending is a documented SUBSET of warn, so the partition is
//     exactly ok + warn + onDemandWarn + crit. staleContent is diagnostic: a
//     graced entry counts in `ok`, so it is NOT a subset of warn — but every
//     STALE_CONTENT entry still lands in exactly one of ok/warn, which keeps
//     `staleContent <= ok + warn` a real bound worth enforcing. This is what caught
//     the pre-#6300 api-platform.mdx body, which showed a concrete "HEALTHY"
//     alongside 5 warns.
function validateHealthSummaryDocs(stats, docs = null) {
  const failures = [];
  if (docs === null) {
    const discovered = healthSummaryDocSources();
    failures.push(...discovered.failures);
    docs = discovered.docs;
  }
  const total = stats.healthProbedKeys.total;

  for (const [file, text] of Object.entries(docs)) {
    const blocks = [...text.matchAll(/"summary":\s*\{([^{}]*)\}/g)];
    if (blocks.length === 0) {
      failures.push(`${file}: publishes ${HEALTH_SUMMARY_ANCHOR} but no readable "summary" object`);
      continue;
    }
    blocks.forEach(([, body], i) => {
      const where = blocks.length > 1 ? `${file} (summary example ${i + 1} of ${blocks.length})` : file;
      const field = (name) => {
        const m = new RegExp(`"${name}":\\s*(\\d+)`).exec(body);
        return m ? Number(m[1]) : null;
      };
      const counts = {};
      for (const name of ['total', 'ok', 'warn', 'containedWarn', 'onDemandWarn', 'staleContent', 'rolloutPending', 'crit']) {
        counts[name] = field(name);
        if (counts[name] === null) failures.push(`${where}: /api/health summary example is missing "${name}"`);
      }
      if (Object.values(counts).some((v) => v === null)) return;

      if (counts.total !== total) {
        failures.push(`${where}: summary.total is ${counts.total}, but /api/health probes ${total} keys`);
      }
      const partition = counts.ok + counts.warn + counts.onDemandWarn + counts.crit;
      if (partition !== counts.total) {
        failures.push(
          `${where}: ok + warn + onDemandWarn + crit = ${partition}, which must equal total (${counts.total})`,
        );
      }
      if (counts.rolloutPending > counts.warn) {
        failures.push(
          `${where}: rolloutPending (${counts.rolloutPending}) is documented as a subset of warn (${counts.warn})`,
        );
      }
      // Same rule as rolloutPending: the pages state containedWarn is a subset
      // of warn, not an additional bucket, so it must never exceed it. Without
      // this the partition check above stays silent, because containedWarn is
      // deliberately absent from that sum.
      if (counts.containedWarn > counts.warn) {
        failures.push(
          `${where}: containedWarn (${counts.containedWarn}) is documented as a subset of warn (${counts.warn})`,
        );
      }
      // staleContent is no longer a subset of warn (a graced entry counts in
      // ok), but it is still bounded: STATUS_COUNTS maps STALE_CONTENT to warn
      // and healthStatusBucket only ever overrides that to ok, so an example
      // claiming more stale-content diagnoses than there are ok+warn keys is
      // arithmetically impossible and must not ship.
      if (counts.staleContent > counts.ok + counts.warn) {
        failures.push(
          `${where}: staleContent (${counts.staleContent}) exceeds ok + warn (${counts.ok + counts.warn}), which is impossible`,
        );
      }
    });
  }
  return failures;
}

// The --check validator set. Exported and iterated so the wiring is data a
// test can assert.
const DOC_VALIDATORS = [
  validateHealthSummaryDocs,
];

function main() {
  const check = process.argv.includes('--check');
  const stats = computeStats();

  if (!check) {
    console.error('docs-stats only validates claims; run `npm run inventory:facts` to write generated stats.');
    process.exitCode = 1;
    return;
  }

  const failures = [];

  // Every CI workflow must be documented in ARCHITECTURE.md's CI/CD table.
  const arch = read('ARCHITECTURE.md');
  for (const wf of stats.workflows) {
    if (!arch.includes('`' + wf + '`')) {
      failures.push(`ARCHITECTURE.md: CI workflow \`${wf}\` is not listed in the CI/CD table`);
    }
  }

  for (const validate of DOC_VALIDATORS) failures.push(...validate(stats));

  for (const c of claims(stats)) {
    let text;
    try {
      text = read(c.file);
    } catch {
      failures.push(`${c.file}: file not found`);
      continue;
    }
    const m = text.match(c.re);
    if (!m) {
      failures.push(`${c.file}: claim pattern ${c.re} not found (expected ${c.value})`);
      continue;
    }
    if (m[1] !== c.value) {
      failures.push(`${c.file}: doc says ${m[1]}, code says ${c.value} — pattern ${c.re}`);
    }
  }

  if (failures.length) {
    console.error(`docs-stats --check FAILED (${failures.length}):`);
    for (const f of failures) console.error('  ✗ ' + f);
    console.error('\nFix the documented contract or its authoritative registry.');
    process.exit(1);
  }
  console.log(`docs-stats --check OK — ${stats.workflowCount} workflows, ${claims(stats).length} doc claims and the /api/health examples match code.`);
}

export {
  computeStats,
  parseLayerRegistry,
  parseHealthProbedKeys,
  parseProbedRegistries,
  validateHealthSummaryDocs,
  healthSummaryDocSources,
  HEALTH_SUMMARY_DOC_FILES,
  HEALTH_SUMMARY_ANCHOR,
  DOC_VALIDATORS,
};

// Run only when executed directly (node scripts/docs-stats.mjs [--check]).
// Stays import-safe so tests can load the validators without triggering the
// filesystem scan / CI gate on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
