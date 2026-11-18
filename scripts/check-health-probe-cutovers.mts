import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HEALTH_URL = new URL('../api/health.js', import.meta.url);

type JsonRecord = Record<string, unknown>;

export interface CutoverValidationInput {
  baseSeedMeta: unknown;
  headSeedMeta: unknown;
  // Runtime wiring the marker proof depends on: health grants pre-activation
  // grace only to a STANDALONE_KEYS probe (the bootstrap walk passes
  // allowOnDemand: false) that is on-demand AND whose marker it EXISTS-probes.
  activationMarkers: unknown;
  onDemandKeys: unknown;
  standaloneKeys: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function seedMetaKey(config: unknown): string | null {
  return isRecord(config) && typeof config.key === 'string' ? config.key : null;
}

/**
 * True for a real ISO calendar instant with an explicit Z or numeric timezone.
 * Date.parse alone normalizes impossible dates such as February 30.
 */
export function isUtcIsoInstant(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-](\d{2}):(\d{2}))$/,
  );
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return false;
  if (Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59) return false;
  if (zone !== 'Z' && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Require every new or repointed SEED_META probe to declare how deployment
 * avoids the predictable EMPTY window before its producer first publishes.
 *
 * Both proofs live beside the changed probe, so they are bound to the exact
 * fromKey transition: pre-seed evidence that the key already published, or a
 * durable activation marker that health reads before alarming on absence. The
 * marker counts only when health is wired to read it (ACTIVATION_MARKERS) and
 * to soften the probe until it does (ON_DEMAND_KEYS on a STANDALONE_KEYS probe).
 */
export function validateHealthProbeCutovers({
  baseSeedMeta,
  headSeedMeta,
  activationMarkers,
  onDemandKeys,
  standaloneKeys,
}: CutoverValidationInput) {
  if (!isRecord(baseSeedMeta)) {
    throw new Error('Base SEED_META must be an object');
  }
  if (!isRecord(headSeedMeta)) {
    throw new Error('Head SEED_META must be an object');
  }

  const changed: Array<{
    name: string;
    fromKey: string | null;
    toKey: string;
    mode: 'preseed' | 'activation-marker';
  }> = [];
  for (const [name, config] of Object.entries(headSeedMeta)) {
    const toKey = seedMetaKey(config);
    if (!toKey) {
      throw new Error(`SEED_META.${name} needs a string key`);
    }
    const fromKey = seedMetaKey(baseSeedMeta[name]);
    if (fromKey === toKey) continue;

    const cutover = isRecord(config) ? config.cutover : null;
    if (!isRecord(cutover)) {
      throw new Error(
        `Health probe ${name} (${fromKey ?? '<new>'} -> ${toKey}) needs machine-readable pre-seed evidence or a durable activation marker`,
      );
    }
    if (cutover.fromKey !== fromKey) {
      throw new Error(
        `Health probe ${name} cutover.fromKey must equal ${fromKey ?? 'null'} for this transition`,
      );
    }
    if (!Number.isInteger(cutover.issue)) {
      throw new Error(`Health probe ${name} cutover needs an owner issue number`);
    }

    if (cutover.mode === 'preseed') {
      if (!isUtcIsoInstant(cutover.verifiedAt)) {
        throw new Error(`Health probe ${name} pre-seed evidence needs a valid UTC ISO verifiedAt instant`);
      }
      const evidence = cutover.evidence;
      if (
        !isRecord(evidence)
        || evidence.platform !== 'railway'
        || typeof evidence.service !== 'string'
        || evidence.service.trim().length === 0
        || evidence.probeKey !== toKey
        || evidence.compactHealthStatus !== 'OK'
        || !isHttpsUrl(evidence.reference)
      ) {
        throw new Error(
          `Health probe ${name} pre-seed evidence must identify Railway, its service, probe ${toKey}, compact health OK, and an HTTPS reference`,
        );
      }
    } else if (cutover.mode === 'activation-marker') {
      if (
        typeof cutover.activationKey !== 'string'
        || !/^seed-activated:[a-z0-9][a-z0-9:-]*$/.test(cutover.activationKey)
        || config.activationKey !== cutover.activationKey
      ) {
        throw new Error(
          `Health probe ${name} activation-marker cutover must bind config.activationKey to an exact seed-activated:* key`,
        );
      }
      if (
        !isRecord(activationMarkers)
        || activationMarkers[name] !== cutover.activationKey
        || !(onDemandKeys instanceof Set)
        || !onDemandKeys.has(name)
        || !isRecord(standaloneKeys)
        || !Object.hasOwn(standaloneKeys, name)
      ) {
        throw new Error(
          `Health probe ${name} activation-marker cutover needs ACTIVATION_MARKERS.${name} = ${cutover.activationKey}, an ON_DEMAND_KEYS entry, and a STANDALONE_KEYS probe (bootstrap probes get no on-demand grace; use pre-seed evidence), or health never grants the pre-activation grace`,
        );
      }
    } else {
      throw new Error(`Health probe ${name} cutover mode must be preseed or activation-marker`);
    }

    changed.push({ name, fromKey, toKey, mode: cutover.mode });
  }
  return changed;
}

function resolveCommit(ref: string): string {
  return execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    encoding: 'utf8',
  }).trim();
}

// Same-directory module specifiers in an api/ source: `./_x.js` in static
// imports, re-exports and dynamic imports. api/*.js entries import only these
// helpers and packages (CLAUDE.md "Critical boundaries").
const SIBLING_IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"]\.\/([^'"/]+\.js)['"]/gm;

function showBaseFile(commit: string, path: string): string {
  return execFileSync('git', ['show', `${commit}:${path}`], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

/**
 * Load the base revision's exported SEED_META registry in an isolated temporary
 * directory. The base health.js is materialized together with the base
 * revision of every api/ helper it reaches, so a helper whose exports changed
 * on this branch cannot break the base import.
 */
async function readBaseSeedMeta(ref: string) {
  const commit = resolveCommit(ref);
  const directory = new URL(`../api/.health-cutover-base-${randomUUID()}/`, import.meta.url);
  mkdirSync(directory);
  try {
    const pending = ['health.js'];
    const written = new Set<string>();
    while (pending.length > 0) {
      const file = pending.pop() as string;
      if (written.has(file)) continue;
      written.add(file);
      const source = showBaseFile(commit, `api/${file}`);
      writeFileSync(new URL(file, directory), source, { flag: 'wx' });
      for (const match of source.matchAll(SIBLING_IMPORT_RE)) pending.push(match[1]);
    }
    const module = await import(new URL('health.js', directory).href);
    if (!isRecord(module.__testing__) || !isRecord(module.__testing__.SEED_META)) {
      throw new Error(`api/health.js at ${commit} does not export __testing__.SEED_META`);
    }
    return { commit, seedMeta: module.__testing__.SEED_META };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  const baseRef = process.argv[2] || process.env.HEALTH_PROBE_CUTOVER_BASE || 'origin/main';
  const [{ commit, seedMeta: baseSeedMeta }, headModule] = await Promise.all([
    readBaseSeedMeta(baseRef),
    import(HEALTH_URL.href),
  ]);
  if (!isRecord(headModule.__testing__) || !isRecord(headModule.__testing__.SEED_META)) {
    throw new Error('Current api/health.js does not export __testing__.SEED_META');
  }
  const changed = validateHealthProbeCutovers({
    baseSeedMeta,
    headSeedMeta: headModule.__testing__.SEED_META,
    activationMarkers: headModule.__testing__.ACTIVATION_MARKERS,
    onDemandKeys: headModule.__testing__.ON_DEMAND_KEYS,
    standaloneKeys: headModule.__testing__.STANDALONE_KEYS,
  });
  if (changed.length === 0) {
    console.log(`Health-probe cutover check passed: no new or repointed probes since ${commit}.`);
    return;
  }
  for (const entry of changed) {
    console.log(
      `Health-probe cutover check passed: ${entry.name} ${entry.fromKey ?? '<new>'} -> ${entry.toKey} (${entry.mode}).`,
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
