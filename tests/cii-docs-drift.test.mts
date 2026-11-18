import assert from 'node:assert/strict';
import { readFileSync as originalReadFileSync } from 'node:fs';
function readFileSync(path: any, options?: any): any {
  const content = originalReadFileSync(path, options);
  if (typeof content === 'string') {
    return content.replace(/\r\n/g, '\n');
  }
  return content;
}
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  CII_FORMULA_VERSION,
  STRATEGIC_RISK_POSITIONAL_DECAY,
  STRATEGIC_RISK_TOP_N,
} from '../server/worldmonitor/intelligence/v1/_risk-config.ts';
import { CII_COUNTRY_WEIGHTS } from '../packages/shared/cii-weights.ts';

it('current and translated CII claims use the published formula version', () => {
  const paths = [
    'README.md', 'README.ru.md', 'README.ja-JP.md', 'README.zh-CN.md',
    'docs/engineering/product/PRESS_KIT.md',
    'docs/engineering/architecture/health-endpoints.md',
  ];
  for (const path of paths) {
    const body = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const versions = [...body.matchAll(/\bCII (v\d+)\b/g)].map(match => match[1]);
    assert.ok(versions.length > 0, `${path} must identify its current CII formula`);
    assert.ok(versions.every(version => version === CII_FORMULA_VERSION), `${path} has stale CII claims`);
  }
});

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

function findNextMarkdownHeadingOffset(text: string, start: number): number {
  const remainder = text.slice(start);
  const lines = remainder.split('\n');
  let offset = 0;
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
    } else if (!inFence && /^#{1,3} /.test(line)) {
      return offset;
    }
    offset += line.length + (i < lines.length - 1 ? 1 : 0);
  }

  return -1;
}

function markdownSection(text: string, heading: string): string {
  const marker = `${heading}\n`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `Expected markdown section heading "${heading}"`);
  const sectionStart = start + marker.length;
  const nextHeading = findNextMarkdownHeadingOffset(text, sectionStart);
  return nextHeading === -1
    ? text.slice(sectionStart)
    : text.slice(sectionStart, sectionStart + nextHeading);
}

function parseStrategicRiskServerBands(source: string): Array<{ range: string; enumValue: string }> {
  const high = source.match(/overallScore\s*>=\s*(\d+)\s*\n\s*\?\s*'SEVERITY_LEVEL_HIGH'/);
  const medium = source.match(/overallScore\s*>=\s*(\d+)\s*\n\s*\?\s*'SEVERITY_LEVEL_MEDIUM'/);
  assert.ok(high, 'server StrategicRisk HIGH threshold not found');
  assert.ok(medium, 'server StrategicRisk MEDIUM threshold not found');
  const highMin = Number(high[1]);
  const mediumMin = Number(medium[1]);
  return [
    { range: `${highMin}-100`, enumValue: 'SEVERITY_LEVEL_HIGH' },
    { range: `${mediumMin}-${highMin - 1}`, enumValue: 'SEVERITY_LEVEL_MEDIUM' },
    { range: `0-${mediumMin - 1}`, enumValue: 'SEVERITY_LEVEL_LOW' },
  ];
}

describe('CII docs drift guards', () => {
  it('internal review docs do not retain stale CII country-count or source-of-truth claims', () => {
    const internalDocPaths = [
      'docs/engineering/archive/legacy/todo_docs.md',
      'docs/engineering/archive/legacy/todo.md',
      'docs/engineering/archive/legacy/TODO_Performance.md',
      'docs/engineering/archive/legacy/COMPONENTS.md',
    ];
    const escapedFormulaVersion = CII_FORMULA_VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const staleCiiFormulaVersionClaim = new RegExp(
      String.raw`\bCII\s+(?!${escapedFormulaVersion}\b)v\d+\s+(?:stability|stress|instability|scores?|scoring|formula)\b`,
      'i',
    );
    const stalePublishedCiiVersionClaim = new RegExp(
      String.raw`\b(?:server-authoritative|published)\s+CII\s+(?:is\s+)?(?:server-authoritative\s+)?(?!${escapedFormulaVersion}\b)v\d+\b`,
      'i',
    );
    const staleCurrentCiiPublishedVersionClaim = new RegExp(
      String.raw`\bCII\b[^\n.]{0,80}\bserver-authoritative\s+(?!${escapedFormulaVersion}\b)v\d+\s+scores?\b`,
      'i',
    );
    assert.match(
      'CII currently publishes server-authoritative v6 scores for 31 Tier-1 countries',
      staleCurrentCiiPublishedVersionClaim,
      'internal docs guard must catch todo.md-style stale formula-version wording',
    );
    assert.doesNotMatch(
      `CII currently publishes server-authoritative ${CII_FORMULA_VERSION} scores for 31 Tier-1 countries`,
      staleCurrentCiiPublishedVersionClaim,
      'internal docs guard must allow the current formula version in todo.md-style wording',
    );
    const stalePatterns = [
      /22-country CII computation/i,
      /20 hardcoded Tier 1 countries/i,
      /\bCII\s+v5\s+(?:stability|stress|instability|scores?|scoring)\b/i,
      /\breal-time\s+CII\s+v5\s+instability\s+score\b/i,
      /\bComputes\s+CII\s+v5\s+scores\b/i,
      /\bserver-authoritative\s+CII\s+v5\s+scoring\b/i,
      staleCiiFormulaVersionClaim,
      stalePublishedCiiVersionClaim,
      staleCurrentCiiPublishedVersionClaim,
      /src\/workers\/cii\.worker\.ts/i,
      /src\/components\/CIIPanel\.ts` \(150 lines\)/i,
      /\*\*Country Instability Index\*\* \(`country-instability\.ts`\)/i,
    ];

    const violations: string[] = [];
    for (const relPath of internalDocPaths) {
      const text = readFileSync(resolve(root, relPath), 'utf8');
      for (const pattern of stalePatterns) {
        if (pattern.test(text)) violations.push(`${relPath}: ${pattern}`);
      }
    }

    assert.equal(
      violations.length,
      0,
      `internal CII review docs contain stale claims:\n  ${violations.join('\n  ')}`,
    );
  });

  it('CII methodology doc keeps Strategic Risk positional-decay rationale aligned with the top-N cap', () => {
    const doc = readFileSync(resolve(root, 'docs/engineering/methodology/cii-risk-scores.md'), 'utf8');
    const config = readFileSync(resolve(root, 'server/worldmonitor/intelligence/v1/_risk-config.ts'), 'utf8');
    const section = markdownSection(doc, '## 3. Strategic Risk roll-up');
    const nextOneBasedPosition = STRATEGIC_RISK_TOP_N + 1;
    const nextZeroBasedIndex = STRATEGIC_RISK_TOP_N;
    const nextPositionWeight = 1 - nextZeroBasedIndex * STRATEGIC_RISK_POSITIONAL_DECAY;

    assert.equal(STRATEGIC_RISK_TOP_N, 5, 'test assumes the current published top-5 roll-up window');
    assert.equal(
      Math.round(nextPositionWeight * 100) / 100,
      0.25,
      'the next 1-based position 6 / 0-based index 5 remains non-zero with decay=0.15; docs must not claim it hits zero',
    );
    for (const surface of [
      { label: 'methodology doc', text: section },
      { label: 'risk config comment', text: config },
    ]) {
      assert.doesNotMatch(
        surface.text,
        /reaches zero (?:weight )?at position 6|weight reaches zero at position 6/i,
        `${surface.label} must not claim 0-based position 6 has zero Strategic Risk weight`,
      );
      assert.match(
        surface.text,
        new RegExp(`(?:1-based )?position ${nextOneBasedPosition}[\\s\\S]{0,120}(?:0-based index ${nextZeroBasedIndex}[\\s\\S]{0,80})?(?:0\\.25|weight=0\\.25)`, 'i'),
        `${surface.label} must disclose that 1-based position 6 / 0-based index 5 would still carry 0.25 weight`,
      );
      assert.doesNotMatch(
        surface.text,
        /position 6[\s\S]{0,120}(?:0\.10|weight=0\.10)/i,
        `${surface.label} must not retain the off-by-one 0.10 position-6 example`,
      );
      assert.match(
        surface.text,
        /top-5 window|window cap|cap at 5/i,
        `${surface.label} must identify the explicit top-5 window as the bounding rule`,
      );
    }
  });

  it('section extraction ignores heading-looking lines inside fenced code blocks', () => {
    const section = markdownSection(
      [
        '### Target',
        'Before fence.',
        '```sh',
        '# install',
        '### not a section boundary',
        '```',
        'After fence.',
        '### Next',
        'Outside target.',
      ].join('\n'),
      '### Target',
    );

    assert.match(section, /### not a section boundary/);
    assert.match(section, /After fence\./);
    assert.doesNotMatch(section, /Outside target\./);
  });

  it('CII docs publish UCDP newest-release behavior and classifier thresholds', () => {
    const methodologyDoc = readFileSync(resolve(root, 'docs/engineering/methodology/cii-risk-scores.md'), 'utf8');
    const countryDoc = readFileSync(resolve(root, 'docs/engineering/methodology/country-instability-index.md'), 'utf8');
    assert.match(
      countryDoc,
      /^## Boosts And Floors$/m,
      'country-instability-index doc must keep the Boosts And Floors section heading used by UCDP threshold guards',
    );
    const countryFloors = markdownSection(countryDoc, '## Boosts And Floors');

    assert.match(
      methodologyDoc,
      /v8 amendment \(2026-06-07\)[\s\S]{0,260}newest GED[\s\S]{0,120}returns events[\s\S]{0,140}#4200/i,
      'methodology changelog must document the #4200 UCDP newest-release discovery amendment without a version bump',
    );
    assert.match(
      methodologyDoc,
      /ACLED returns zero events[\s\S]{0,80}comparison[\s\S]{0,20}windows/i,
      'methodology changelog must document the ACLED zero-event warning added with the v8 amendment',
    );
    assert.match(
      countryDoc,
      /conflict realtime\s+family is covered when either ACLED or an in-window UCDP feed is present/i,
      'country-instability-index doc must publish ACLED-or-UCDP health coverage semantics',
    );
    assert.match(
      countryDoc,
      /`COVERAGE_PARTIAL` only when ACLED is dark and UCDP is also absent, stale, or\s+outside the 2-year scoring window/i,
      'country-instability-index doc must not imply ACLED auth missing alone causes COVERAGE_PARTIAL',
    );
    assert.match(
      methodologyDoc,
      /Country Instability Index[\s\S]{0,120}ACLED-or-UCDP health coverage semantics/i,
      'methodology changelog must cross-link the current ACLED-or-UCDP health coverage semantics',
    );
    for (const surface of [
      { label: 'country-instability-index doc', text: countryFloors },
    ]) {
      assert.match(
        surface.text,
        /2-year[\s\S]{0,240}(?:total\s+deaths (?:are\s+)?greater than 1000|total\s+deaths > 1000)[\s\S]{0,120}(?:event\s+count (?:is\s+)?greater than 100|event\s+count > 100)/i,
        `${surface.label} must publish the UCDP war thresholds`,
      );
      assert.match(
        surface.text,
        /(?:minor conflict|UCDP \*\*minor conflict\*\*)[\s\S]{0,160}(?:event\s+count (?:is\s+)?greater than 10|event\s+count > 10)/i,
        `${surface.label} must publish the UCDP minor-conflict threshold`,
      );
    }
  });

  it('product copy does not retain stale CII, CRI, or platform-count claims', () => {
    const surfaces = [
      { label: 'docs/engineering/product/PRESS_KIT.md', text: readFileSync(resolve(root, 'docs/engineering/product/PRESS_KIT.md'), 'utf8') },
      { label: 'docs/engineering/product/COMMUNITY-PROMOTION-GUIDE.md', text: readFileSync(resolve(root, 'docs/engineering/product/COMMUNITY-PROMOTION-GUIDE.md'), 'utf8') },
    ];

    for (const surface of surfaces) {
      assert.doesNotMatch(
        surface.text,
        /\bCountry Instability Index\b[\s\S]{0,240}\b22\s+(?:monitored\s+)?(?:nations|countries)\b/i,
        `${surface.label} must not retain the old 22-country CII count`,
      );
      assert.doesNotMatch(
        surface.text,
        /Baseline risk\s*\(40%\)[\s\S]{0,220}(?:Social unrest|unrest events)\s*\(20%\)[\s\S]{0,220}(?:Security events|security activity)\s*\(20%\)[\s\S]{0,220}Information velocity\s*\(20%\)/i,
        `${surface.label} must not publish the old 40/20/20/20 CII shortcut as current methodology`,
      );
      assert.doesNotMatch(
        surface.text,
        /\b(?:150|435)\+\s+(?:curated\s+)?(?:RSS\s+)?(?:news\s+)?feeds\b|\b(?:35|45|50)\+\s+(?:interactive\s+)?(?:map\s+)?(?:data\s+)?layers\b|\b(?:14|19|21)\s+languages\b/i,
        `${surface.label} must not retain stale feed, layer, or language counts`,
      );
    }

    const pressKit = surfaces[0]!.text;
    const communityGuide = surfaces[1]!.text;

    // inventory-contract: public-fixed-algorithm-claims; classification: exact; reason: CII v14 has a versioned fixed country universe
    assert.match(pressKit, /server-authoritative CII v14[\s\S]{0,120}31 Tier-1 countries/i);
    // inventory-contract: public-fixed-algorithm-claims; classification: exact; reason: CRI uses a closed public rankable universe
    assert.match(pressKit, /Country Resilience Index[\s\S]{0,140}196-country public rankable universe/i);
    assert.match(pressKit, /named thematic variants/i);
    assert.match(pressKit, /registered map layer types/i);
    assert.match(pressKit, /curated RSS feeds/i);
    assert.match(pressKit, /Locale support follows the runtime registry/i);
    assert.match(communityGuide, /specialized views/i);
    assert.doesNotMatch(
      `${communityGuide}\n${readFileSync(resolve(root, 'CLAUDE.md'), 'utf8')}`,
      /Tri-Variant Build System|Three Variant Dashboards|three specialized variants|tri-variant architecture|three specialized views/i,
    );
  });

  it('the CII version claim names a version after the current formula, and the change protocols point at the brief', () => {
    const claim = JSON.parse(readFileSync(resolve(root, 'docs/engineering/methodology/cii-next.json'), 'utf8')) as {
      next?: unknown; claimedBy?: unknown; claimedAt?: unknown;
    };
    assert.match(String(claim.next), /^v\d+$/, 'cii-next.json `next` must be a version such as v15');
    const versionNumber = (v: string) => Number(v.slice(1));
    assert.ok(
      versionNumber(String(claim.next)) > versionNumber(CII_FORMULA_VERSION),
      `cii-next.json claims ${String(claim.next)}, which is not after the current ${CII_FORMULA_VERSION}; move it on when a version ships`,
    );
    assert.ok(claim.claimedBy === null || (typeof claim.claimedBy === 'string' && claim.claimedBy.length > 0));
    if (claim.claimedBy !== null) assert.ok(Number.isFinite(Date.parse(String(claim.claimedAt))), 'a claim needs an ISO claimedAt');

    const brief = readFileSync(resolve(root, 'docs/engineering/methodology/cii-change-brief.md'), 'utf8');
    for (const path of [
      'tests/fixtures/cii/', 'scripts/cii-table-diff.mts', 'scripts/cii-capture-fixture.mts',
      'tests/cii-invariants.test.mts', 'tests/cii-fixtures.test.mts', 'docs/engineering/methodology/cii-next.json',
      'docs/engineering/methodology/cii-input-register.md',
    ]) {
      assert.ok(brief.includes(path), `the brief must name ${path}`);
      assert.ok(path.endsWith('/') || readFileSync(resolve(root, path)).length > 0, `${path} must exist`);
    }
    for (const id of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16']) {
      assert.match(brief, new RegExp(`^\\| ${id} \\|`, 'm'), `the brief's property table must list ${id}`);
    }
    for (const path of ['server/worldmonitor/intelligence/v1/_risk-config.ts', 'server/worldmonitor/intelligence/v1/get-risk-scores.ts']) {
      assert.ok(readFileSync(resolve(root, path), 'utf8').includes('docs/engineering/methodology/cii-change-brief.md'), `${path} change protocol must point at the brief`);
    }
  });
});
