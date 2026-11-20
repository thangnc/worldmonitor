import assert from 'node:assert/strict';
import test from 'node:test';
import { CSL_ADDITIONS_LIMIT, buildSanctionsChanges, projectCslAdditions } from '../scripts/_sanctions-changes.mjs';

const now = Date.UTC(2026, 9, 18);
const day = 86400000;
const row = (id, programs = ['IRAN']) => ({ id: `SDN:${id}`, name: `Person ${id}`, entityType: 'SANCTIONS_ENTITY_TYPE_INDIVIDUAL', countryCodes: ['IR'], programs, effectiveAt: '0' });
const snapshot = (rows, at = now - 6 * 3600000) => ({ fetchedAt: at, records: rows });
const priorRows = Array.from({ length: 20 }, (_, i) => row(i));
const run = (current, extra = {}) => buildSanctionsChanges({
  previous: { SDN: snapshot(priorRows) }, current: { SDN: snapshot(current, extra.now ?? now) },
  health: { SDN: { status: 'ok' } }, now, history: null, ...extra,
});

test('fresh source snapshots produce added, removed and program amendments with old programs', () => {
  const current = priorRows.slice(1).map(r => r.id === 'SDN:1' ? { ...r, programs: ['NEW', 'IRAN'] } : r);
  current.push(row(21));
  const log = run(current);
  assert.deepEqual(log.events.map(e => e.op).sort(), ['added', 'amended', 'removed']);
  const amended = log.events.find(e => e.op === 'amended');
  assert.deepEqual(amended.prevPr, ['IRAN']);
  assert.deepEqual(amended.pr, ['IRAN', 'NEW']);
  assert.equal(amended.list, 'SDN');
  assert.equal(amended.et, 'individual');
  assert.equal(amended.at, now);
  assert.deepEqual(log.gaps, []);
  assert.deepEqual(run(priorRows.map(r => ({ ...r, programs: [...r.programs].reverse() }))).events, []);
});

test('retained and unavailable sources produce gaps without events', () => {
  for (const status of ['retained', 'unavailable']) {
    const log = run([row(100)], { health: { SDN: { status } } });
    assert.deepEqual(log.events, []);
    assert.equal(log.gaps[0].reason, status);
    assert.equal(log.gaps[0].from, now - 6 * 3600000);
    assert.equal(log.gaps[0].to, now);
  }
});

test('missing baselines and expired 48h-outage recovery do not emit mass additions', () => {
  const log = run(priorRows, { previous: { SDN: null } });
  assert.deepEqual(log.events, []);
  assert.equal(log.gaps[0].reason, 'baseline-unavailable');
  const outage = run([], { health: { SDN: { status: 'unavailable' } } });
  const recovered = run(priorRows, { previous: { SDN: null }, history: outage, now: now + 49 * 3600000 });
  assert.deepEqual(recovered.events, []);
  assert.equal(recovered.gaps.at(-1).reason, 'baseline-unavailable');
});

test('holds the whole source diff when more than 5 percent would be removed', () => {
  assert.equal(run(priorRows.slice(1)).events.length, 1, 'exactly 5 percent is allowed');
  const held = run([...priorRows.slice(2), row(21)]);
  assert.deepEqual(held.events, []);
  assert.equal(held.gaps[0].reason, 'held');
});

test('prunes events and gaps older than 90 days and caps the newest 10000 events', () => {
  const event = { at: now, effectiveAt: '0', op: 'added', list: 'SDN', id: 'SDN:1', name: 'A', et: 'individual', cc: [], pr: [] };
  const history = { version: 1, fetchedAt: now - 1, events: [
    { ...event, at: now - 91 * day },
    ...Array.from({ length: 10001 }, (_, i) => ({ ...event, at: now - 10001 + i, id: `SDN:${i}` })),
  ], gaps: [{ list: 'SDN', from: now - 92 * day, to: now - 91 * day, reason: 'retained' }] };
  const log = run(priorRows, { history, previous: { SDN: snapshot(priorRows, now - 1) } });
  assert.equal(log.events.length, 10000);
  assert.equal(log.events[0].id, 'SDN:1');
  assert.equal(log.truncatedBefore, now - 10001);
  assert.deepEqual(log.gaps, []);
  assert.equal(run(priorRows, { history: log }).truncatedBefore, log.truncatedBefore);
});

test('recovery diffs a retained valid baseline, but holds a split history/snapshot publication', () => {
  const retained = run(priorRows, { health: { SDN: { status: 'retained' } }, current: { SDN: snapshot(priorRows) } });
  const recovered = run([...priorRows, row(21)], { history: retained, now: now + 3600000 });
  assert.equal(recovered.events.length, 1);
  assert.equal(recovered.events[0].op, 'added');
  const first = run([...priorRows, row(21)]);
  const split = run([...priorRows, row(21)], { history: first, now: now + 3600000 });
  assert.deepEqual(split.events, first.events);
  assert.equal(split.gaps.at(-1).reason, 'baseline-unavailable');
});

test('coalesces consecutive gaps and rejects malformed or future history instead of resetting it', () => {
  const first = run([], { health: { SDN: { status: 'retained' } } });
  const second = run([], { health: { SDN: { status: 'retained' } }, now: now + 3600000, history: first });
  assert.equal(second.gaps.length, 1);
  assert.equal(second.gaps[0].to, now + 3600000);
  for (const history of [{}, { version: 1, fetchedAt: now + 1, events: [], gaps: [] }]) {
    assert.throws(() => run(priorRows, { history }), /SANCTIONS_CHANGES_INVALID/);
  }
});

test('CSL events carry notice and url, accept the unspecified type, and reject non-string citations', () => {
  const csl = (id, extra = {}) => ({ ...row(id), id: `CSL-EL:${id}`, entityType: 'SANCTIONS_ENTITY_TYPE_UNSPECIFIED',
    _notice: '90 FR 14032', _url: 'https://www.bis.gov/x', ...extra });
  const prior = Array.from({ length: 20 }, (_, i) => csl(i));
  const log = buildSanctionsChanges({
    previous: { 'CSL-EL': snapshot(prior) },
    current: { 'CSL-EL': snapshot([...prior, csl(21), csl(22, { _notice: undefined, _url: undefined })], now) },
    health: { 'CSL-EL': { status: 'ok' } }, now, history: null,
  });
  const cited = log.events.find(e => e.id === 'CSL-EL:21');
  const bare = log.events.find(e => e.id === 'CSL-EL:22');
  assert.equal(cited.et, 'unspecified');
  assert.equal(cited.notice, '90 FR 14032');
  assert.equal(cited.url, 'https://www.bis.gov/x');
  assert.equal('notice' in bare || 'url' in bare, false);
  for (const bad of [{ notice: 42 }, { url: ['https://x'] }]) {
    const history = { ...log, events: [{ ...cited, ...bad }] };
    assert.throws(() => run(priorRows, { history }), /SANCTIONS_CHANGES_INVALID/);
  }
});

test('retained and unavailable runs cannot roll back the history clock after split publication', () => {
  const first = run([...priorRows, row(21)]);
  for (const status of ['retained', 'unavailable']) {
    const outage = run(priorRows, { history: first, now: now + 3600000,
      health: { SDN: { status } }, current: { SDN: status === 'retained' ? snapshot(priorRows) : null } });
    const recovery = run([...priorRows, row(21)], { history: outage, now: now + 7200000 });
    assert.deepEqual(recovery.events, first.events);
    assert.equal(recovery.gaps.at(-1).reason, 'baseline-unavailable');
  }
});

test('recovery after a held partial source starts a baseline instead of inventing restored additions', () => {
  const partial = priorRows.slice(2);
  const held = run(partial);
  const outage = run(partial, { history: held, now: now + 3600000,
    previous: { SDN: snapshot(partial, now) }, current: { SDN: snapshot(partial, now) },
    health: { SDN: { status: 'retained' } } });
  const recovery = run(priorRows, { history: outage, now: now + 7200000, previous: { SDN: snapshot(partial, now) } });
  assert.deepEqual(recovery.events, []);
  assert.equal(recovery.gaps.at(-1).reason, 'baseline-unavailable');
  const next = run([...priorRows, row(21)], { history: recovery, now: now + 10800000,
    previous: { SDN: snapshot(priorRows, now + 7200000) } });
  assert.equal(next.events.length, 1);
  assert.equal(next.events[0].op, 'added');
});

test('projects the last 7 days of CSL additions for the Lite indicator, newest first, with list state and window gaps (#123)', () => {
  const ev = (list, op, at, name = `${list} ${op} ${at}`) => ({ at, op, list, id: `${list}:${name}`, name, et: 'unspecified', cc: ['CN', 'HK', 'A', 'B', 'C', 'D', 'E'], pr: ['P1', 'P2', 'P3', 'P4'], effectiveAt: '0', notice: '91 FR 1', url: 'https://x' });
  const changes = {
    version: 1, fetchedAt: now, events: [
      ev('CSL-EL', 'added', now - 8 * day),
      ev('CSL-EL', 'added', now - 6 * day),
      ev('CSL-EL', 'removed', now - day),
      ev('SDN', 'added', now - day),
      ev('CSL-DTC', 'added', now),
      ev('CSL-EL', 'amended', now),
    ],
    gaps: [{ list: 'CSL-EL', from: now - 9 * day, to: now - 8 * day, reason: 'held' }, { list: 'CSL-DPL', from: now, to: now, reason: 'unavailable' }, { list: 'SDN', from: now, to: now, reason: 'held' }],
  };
  const health = { 'CSL-EL': { status: 'ok', recordCount: 3317, publishedAt: now - 2 * day }, 'CSL-DPL': { status: 'unavailable', recordCount: 0, publishedAt: null } };
  const out = projectCslAdditions(changes, health, ['CSL-EL', 'CSL-DPL', 'CSL-DTC']);
  assert.deepEqual(out.events.map(e => [e.list, e.at]), [['CSL-DTC', now], ['CSL-EL', now - 6 * day]]);
  assert.deepEqual(out.events[0].cc.length, 6);
  assert.deepEqual(out.events[0].pr, ['P1', 'P2', 'P3']);
  assert.equal(out.events[0].notice, '91 FR 1');
  assert.equal('id' in out.events[0] || 'url' in out.events[0], false);
  assert.deepEqual(out.lists, [
    { list: 'CSL-EL', status: 'ok', count: 3317, publishedAt: now - 2 * day },
    { list: 'CSL-DPL', status: 'unavailable', count: 0, publishedAt: null },
    { list: 'CSL-DTC', status: 'unavailable', count: 0, publishedAt: null },
  ]);
  assert.deepEqual(out.gaps, [{ list: 'CSL-DPL', from: now, to: now, reason: 'unavailable' }]);
  assert.equal(out.truncated, false);
  assert.equal(out.windowDays, 7);

  const many = { ...changes, events: Array.from({ length: CSL_ADDITIONS_LIMIT + 3 }, (_, i) => ev('CSL-EL', 'added', now - i * 1000)) };
  const capped = projectCslAdditions(many, health, ['CSL-EL']);
  assert.equal(capped.events.length, CSL_ADDITIONS_LIMIT);
  assert.equal(capped.truncated, true);
  assert.equal(capped.events[0].at, now);
  assert.equal(projectCslAdditions({ ...changes, truncatedBefore: now - 2 * day }, health, ['CSL-EL']).truncated, true);
  assert.equal(projectCslAdditions({ ...changes, truncatedBefore: now - 30 * day }, health, ['CSL-EL']).truncated, false);
});
