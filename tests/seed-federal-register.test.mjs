import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AGENCIES,
  CANONICAL_KEY,
  FR_API_URL,
  buildUrl,
  classifyDocument,
  declareRecords,
  fetchFederalRegister,
  summarizeDocument,
  validateFn,
} from '../scripts/seed-federal-register.mjs';

const NOW = Date.UTC(2026, 10, 20, 6, 0, 0);
const BIS = [{ slug: 'commerce-department' }, { slug: 'industry-and-security-bureau' }];
const USTR = [{ slug: 'trade-representative-office-of-united-states' }];

const doc = (over = {}) => ({
  document_number: '2026-20001',
  title: 'Addressing Remote Access to Advanced Semiconductors',
  type: 'Rule',
  action: 'Interim final rule.',
  abstract: 'BIS amends the Export Administration Regulations to control remote access to advanced computing items.',
  publication_date: '2026-11-19',
  effective_on: '2026-11-19',
  html_url: 'https://www.federalregister.gov/documents/2026/11/19/2026-20001/x',
  agencies: BIS,
  ...over,
});

describe('Federal Register classification (#122)', () => {
  it('keeps BIS and USTR rules and proposed rules, and notices that change controls or tariffs', () => {
    assert.deepEqual(classifyDocument(doc()), { agency: 'BIS', kind: 'export-control' });
    assert.deepEqual(classifyDocument(doc({ type: 'Proposed Rule', agencies: USTR, title: 'Modification of Duty-Free Treatment' })), { agency: 'USTR', kind: 'tariff' });
    assert.deepEqual(classifyDocument(doc({ type: 'Notice', agencies: USTR, title: "Notice of Modification of Section 301 Action: China's Targeting of the Maritime Sector", action: 'Notice.' })), { agency: 'USTR', kind: 'tariff' });
    assert.deepEqual(classifyDocument(doc({ type: 'Notice', title: 'Additions to the Entity List; Temporary Denial Order', action: 'Notice.' })), { agency: 'BIS', kind: 'export-control' });
  });

  it('drops routine notices, other agencies and documents that change nothing', () => {
    assert.equal(classifyDocument(doc({ type: 'Notice', title: 'Agency Information Collection Activities; Comment Request', action: 'Notice.' })), null);
    assert.equal(classifyDocument(doc({ type: 'Notice', agencies: USTR, title: 'Applications for Inclusion on the Binational Panels Roster Under the USMCA', action: 'Request for applications.' })), null);
    assert.equal(classifyDocument(doc({ type: 'Notice', title: 'Materials and Equipment Technical Advisory Committee; Notice of Partially Closed Meeting', action: 'Notice.' })), null);
    assert.equal(classifyDocument(doc({ type: 'Notice', agencies: USTR, title: 'Notice of Public Hearing Schedule', action: 'Notice.' })), null);
    assert.equal(classifyDocument(doc({ agencies: [{ slug: 'commerce-department' }] })), null);
    assert.equal(classifyDocument(doc({ type: 'Presidential Document' })), null);
  });

  it('summarizes a kept document in a small browser shape and rejects malformed ones', () => {
    assert.deepEqual(summarizeDocument(doc()), {
      id: '2026-20001',
      title: 'Addressing Remote Access to Advanced Semiconductors',
      type: 'Rule',
      action: 'Interim final rule.',
      agency: 'BIS',
      kind: 'export-control',
      publishedAt: '2026-11-19',
      effectiveOn: '2026-11-19',
      url: 'https://www.federalregister.gov/documents/2026/11/19/2026-20001/x',
      abstract: 'BIS amends the Export Administration Regulations to control remote access to advanced computing items.',
      aiRelated: false,
    });
    assert.equal(summarizeDocument(doc({ title: 'Export controls on Artificial Intelligence model weights' })).aiRelated, true);
    assert.equal(summarizeDocument(doc({ html_url: 'https://evil.example/x' })).url, '');
    assert.equal(summarizeDocument(doc({ publication_date: 'soon' })), null);
    assert.equal(summarizeDocument(doc({ document_number: '' })), null);
    assert.equal(summarizeDocument(doc({ abstract: 'x'.repeat(900) })).abstract.length, 400);
  });
});

describe('Federal Register fetch (#122)', () => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });

  it('asks for both agencies over the last 30 days, newest first, with a User-Agent, and keeps the kept documents', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push([url, init.headers['User-Agent']]);
      return ok({ total_pages: 1, results: [
        doc({ document_number: '2026-1', publication_date: '2026-11-10', agencies: USTR, type: 'Notice', title: 'Notice of Product Exclusion Extensions: Section 301', action: 'Notice.' }),
        doc(),
        doc({ document_number: '2026-3', type: 'Notice', title: 'Agency Information Collection Activities', action: 'Notice.' }),
        doc(),
      ] });
    };
    const data = await fetchFederalRegister({ fetchImpl, nowMs: NOW });
    const url = new URL(calls[0][0]);
    assert.equal(`${url.origin}${url.pathname}`, FR_API_URL);
    assert.deepEqual(url.searchParams.getAll('conditions[agencies][]'), Object.keys(AGENCIES));
    assert.equal(url.searchParams.get('conditions[publication_date][gte]'), '2026-10-21');
    assert.equal(url.searchParams.get('order'), 'newest');
    assert.match(calls[0][1], /WorldMonitor/);
    assert.equal(data.scanned, 4);
    assert.deepEqual(data.items.map((i) => i.id), ['2026-20001', '2026-1']);
    assert.equal(validateFn(data), true);
    assert.equal(declareRecords(data), 2);
  });

  it('follows extra pages up to the cap, treats an empty month as a failure, and marks client errors non-retryable', async () => {
    let pages = 0;
    const paged = async () => { pages += 1; return ok({ total_pages: 9, results: [doc({ document_number: `p${pages}` })] }); };
    assert.equal((await fetchFederalRegister({ fetchImpl: paged, nowMs: NOW })).scanned, 3);
    await assert.rejects(fetchFederalRegister({ fetchImpl: async () => ok({ total_pages: 0, results: [] }), nowMs: NOW }), /no BIS or USTR document/);
    await assert.rejects(fetchFederalRegister({ fetchImpl: async () => ({ ok: false, status: 404 }), nowMs: NOW }), (err) => err.nonRetryable === true);
    await assert.rejects(fetchFederalRegister({ fetchImpl: async () => ({ ok: false, status: 503 }), nowMs: NOW }), (err) => err.nonRetryable !== true);
    await assert.rejects(fetchFederalRegister({ fetchImpl: async () => ok({ errors: ['bad'] }), nowMs: NOW }), (err) => err.nonRetryable === true);
  });

  it('validates only a payload that scanned documents, and builds page URLs', () => {
    assert.equal(validateFn({ fetchedAt: NOW, scanned: 0, items: [] }), false);
    assert.equal(validateFn({ fetchedAt: NOW, scanned: 3, items: [] }), true, 'a month with nothing kept is valid');
    assert.equal(validateFn({ fetchedAt: NOW, scanned: 3, items: [{ id: 'x', publishedAt: 'bad' }] }), false);
    assert.equal(new URL(buildUrl('2026-10-21', 2)).searchParams.get('page'), '2');
    assert.equal(CANONICAL_KEY, 'policy:federal-register:v1');
  });
});
