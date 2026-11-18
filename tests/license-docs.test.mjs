// This pins the canonical AGPL header in LICENSE and the licence,
// commercial-use and hosted-plan statements in the project documents (#8690,
// section 2). The published words are the contract, so executing application
// code cannot verify them.
//
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// Keep this scoped to project-license docs so third-party source license notes
// do not create false positives. The public legal and docs pages left in
// refactor 1c-3; README.md is the one project document that remains.
const PROJECT_LICENSE_DOCS = [
  'README.md',
];

function readProjectLicenseDocs() {
  return PROJECT_LICENSE_DOCS.map((relativePath) => ({
    relativePath,
    text: readFileSync(join(root, relativePath), 'utf8'),
  }));
}

function snippet(text, index, radius = 80) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function assertNoMatch(relativePath, text, pattern, label) {
  const match = pattern.exec(text);
  const diagnostic = match ? snippet(text, match.index, Math.max(120, match[0].length + 40)) : '';

  assert.equal(
    match,
    null,
    `${relativePath} still contains ${label}: ${diagnostic}`,
  );
}

describe('project license docs', () => {
  it('keeps the canonical AGPL header first and project notices below the complete text', () => {
    const license = readFileSync(join(root, 'LICENSE'), 'utf8');
    const firstContentLine = license.split('\n').find((line) => line.trim().length > 0);
    const agplEnd = license.indexOf('END OF TERMS AND CONDITIONS');
    const projectHeader = license.indexOf('World Monitor — Real-time global intelligence dashboard');
    const projectCopyright = license.indexOf('Copyright (C) 2024-2026 Elie Habib');
    const projectNotice = license.indexOf('\nThis program is free software:');

    assert.equal(firstContentLine?.trim(), 'GNU AFFERO GENERAL PUBLIC LICENSE', 'root LICENSE must start with the canonical AGPL header');
    assert.ok(agplEnd >= 0, 'root LICENSE must contain the complete AGPL text');
    assert.ok(projectHeader > agplEnd, 'project header must follow the complete AGPL text');
    assert.ok(projectCopyright > agplEnd, 'project copyright must follow the complete AGPL text');
    assert.ok(projectNotice > agplEnd, 'project notice must follow the complete AGPL text');
  });

  it('do not claim AGPL prohibits commercial use', () => {
    for (const { relativePath, text } of readProjectLicenseDocs()) {
      assertNoMatch(relativePath, text, /AGPL[\s\S]{0,160}non-?commercial/i, 'AGPL non-commercial framing');
      assertNoMatch(relativePath, text, /non-?commercial[\s\S]{0,160}AGPL/i, 'non-commercial AGPL framing');
      assertNoMatch(relativePath, text, /commercial use requires/i, 'commercial-use-required wording');
      assertNoMatch(relativePath, text, /violation of the AGPL[\s\S]{0,160}make money/i, 'make-money AGPL violation wording');
      assertNoMatch(relativePath, text, /make money[\s\S]{0,160}violation of the AGPL/i, 'make-money AGPL violation wording');
      assertNoMatch(relativePath, text, /cannot use[\s\S]{0,160}commercial purposes/i, 'commercial-purpose prohibition wording');
    }
  });

  const PLAN_LABELS = [
    'Personal license (Pro)',
    'Commercial license (Pro Business)',
    'Commercial license — for your organization (API Starter)',
    'Commercial license — for your customers (API Business)',
  ];

});
