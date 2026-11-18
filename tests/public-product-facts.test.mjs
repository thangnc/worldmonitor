import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_REGISTRY } from '../api/mcp/registry/index.ts';
import { PRODUCT_CATALOG } from '../convex/config/productCatalog.ts';
import {
  ACQUISITION_CLAIM_ROOTS,
  collectCurrentAcquisitionClaimFiles,
  computeStats,
  retainedExactContractCoverageFailures,
  validateVolatileInventoryClaims,
  VOLATILE_INVENTORY_CLAIM_RE,
} from '../scripts/docs-stats.mjs';
import { buildSourceAttributionStats } from '../scripts/source-attribution.mjs';

const PRODUCT_FACTS_FROZEN = 'product facts are frozen since refactor Phase 1a: their generator reads removed dashboard config; Phase 1b removes /pro and these facts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const readJson = (path) => JSON.parse(read(path));

const registryToolNames = () => TOOL_REGISTRY.map((tool) => tool.name);
const registryToolCount = () => TOOL_REGISTRY.length;
const advertisedAgentCardToolCount = () => {
  const routingSkill = readJson('public/.well-known/agent-card.json').skills
    ?.find((skill) => skill.id === 'route-to-tool');
  assert.ok(routingSkill?.description, 'A2A routing skill must have a description');
  const count = routingSkill.description.match(/\b(\d+)-tool catalog\b/);
  assert.ok(count, 'A2A routing skill must advertise an N-tool catalog');
  return Number.parseInt(count[1], 10);
};
const displayPrice = (price) => (Number.isInteger(price) ? String(price) : price.toFixed(2));

const REQUIRED_ACQUISITION_CLAIM_ROOTS = [
  'README.ja-JP.md',
  'README.md',
  'README.zh-CN.md',
  'cli',
  'docs',
  'lite.html',
  'public',
  'public/.well-known/agent-skills',
  'public/.well-known/ai-catalog.json',
  'public/api/llms.txt',
  'scripts/build-agent-skills-index.mjs',
  'server.json',
];

function assertAcquisitionClaimRootClosure(actualRoots) {
  assert.deepEqual([...actualRoots].sort(), REQUIRED_ACQUISITION_CLAIM_ROOTS);
}

const REQUIRED_CURRENT_DOC_EXCLUDES = [
  'docs/api/',
  'docs/engineering/archive/',
  'docs/engineering/plans/',
  'docs/engineering/process/',
  'docs/engineering/research/',
  'docs/engineering/solutions/',
  'docs/generated/',
  'docs/brainstorms/',
  'docs/ideation/',
  'docs/internal/',
  'docs/plans/',
  'docs/research/',
];

function independentlyCollectCurrentDocs() {
  const paths = [];
  const visit = (path) => {
    if (REQUIRED_CURRENT_DOC_EXCLUDES.some((prefix) => path.startsWith(prefix))) return;
    if (['docs/changelog.mdx', 'docs/engineering/architecture/desktop-parity-matrix.md', 'docs/engineering/runbooks/railway-seed-consolidation-runbook.md', 'docs/source-attribution.mdx', 'docs/zh/changelog.mdx'].includes(path)) return;
    const stat = statSync(join(ROOT, path));
    if (stat.isDirectory()) {
      for (const entry of readdirSync(join(ROOT, path))) visit(`${path}/${entry}`);
      return;
    }
    if (/\.(?:md|mdx)$/.test(path)) paths.push(path);
  };
  visit('docs');
  return paths.sort();
}

function machineReadablePricing() {
  const match = read('public/pricing.md').match(
    /## Machine-Readable Summary[\s\S]*?```json\n([\s\S]*?)\n```/,
  );
  assert.ok(match, 'public/pricing.md must publish a machine-readable pricing summary');
  return JSON.parse(match[1]);
}

const ACQUISITION_ROOTS = [
  'lite.html',
  'README.md',
  'README.zh-CN.md',
  'server.json',
  'cli',
  'docs',
  'public',
];

const ACQUISITION_EXTENSIONS = /\.(?:astro|html|json|md|mdx|mjs|txt)$/;
const ACQUISITION_EXCLUDES = [
  'docs/api/',
  'docs/engineering/archive/',
  'docs/engineering/plans/',
  'docs/engineering/process/',
  'docs/brainstorms/',
  'docs/ideation/',
  'docs/internal/',
  'docs/plans/',
  'public/openapi',
];

function collectAcquisitionSurfaces() {
  const surfaces = [];
  const visit = (path) => {
    if (ACQUISITION_EXCLUDES.some((prefix) => path.startsWith(prefix))) return;
    const fullPath = join(ROOT, path);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(fullPath)) visit(`${path}/${entry}`);
    } else if (ACQUISITION_EXTENSIONS.test(path)) {
      surfaces.push(path);
    }
  };
  for (const path of ACQUISITION_ROOTS) visit(path);
  return surfaces.sort();
}

const CURRENT_FACT_SURFACES = collectAcquisitionSurfaces();
describe('public product facts generation contract', () => {
  it('keeps the acquisition claim scan on the complete registered root set', () => {
    assertAcquisitionClaimRootClosure(ACQUISITION_CLAIM_ROOTS);
    assert.throws(
      () => assertAcquisitionClaimRootClosure(
        ACQUISITION_CLAIM_ROOTS.filter((path) => path !== 'README.ja-JP.md'),
      ),
      /Expected values to be strictly deep-equal/,
      'deleting one registered acquisition root must fail closed',
    );
  });

  it('keeps recursive current documentation in the exact acquisition scan closure', () => {
    const expected = independentlyCollectCurrentDocs();
    const actual = collectCurrentAcquisitionClaimFiles().filter((path) => path.startsWith('docs/'));
    assert.deepEqual(actual, expected);
    assert.ok(actual.includes('docs/panels/news-feeds.mdx'), 'nested panel docs must be scanned');
    assert.throws(
      () => assert.deepEqual(actual.filter((path) => path !== 'docs/panels/news-feeds.mdx'), expected),
      /Expected values to be strictly deep-equal/,
      'deleting one nested current documentation surface must fail closed',
    );
  });

  it('fails closed when a retained exact contract disappears', () => {
    const contract = { path: 'docs/fixed-protocol.mdx', text: /six fixed fields/ };
    assert.deepEqual(retainedExactContractCoverageFailures([contract], new Set([contract])), []);
    assert.deepEqual(
      retainedExactContractCoverageFailures([contract], new Set()),
      ['docs/fixed-protocol.mdx: retained exact count contract is missing or changed: /six fixed fields/'],
    );
  });

  it('keeps stable product facts separate from build-owned inventory facts', () => {
    const stableFacts = readJson('shared/product-facts.generated.json');
    const publicFacts = readJson('public/product-facts.json');
    const relayInventory = readJson('scripts/shared/inventory-facts.generated.json');
    const stats = computeStats();

    assert.equal(stableFacts.capabilities, undefined);
    assert.equal(readJson('shared/product-catalog.generated.json').facts.capabilities, undefined);
    assert.deepEqual(
      Object.fromEntries(Object.entries(publicFacts).filter(([key]) => key !== 'capabilities')),
      stableFacts,
    );
    assert.deepEqual(publicFacts.capabilities, relayInventory.capabilities);
    assert.deepEqual(publicFacts.capabilities, {
      mcpTools: stats.mcpToolCount,
      locales: stats.locales,
      variants: stats.variantCount,
      mapLayers: stats.layerDefinitions,
      panelImplementations: stats.panelClasses,
      feedDefinitions: stats.feedDefinitions,
      freshnessTrackedSourceGroups: stats.freshnessSources,
      sourceAttributionHosts: stats.sourceAttributionHosts,
      sourceAttributionProviders: stats.sourceAttribution.providerCount,
      localeCodes: stats.localeCodes,
    });
    assert.equal(stableFacts.product.lifecycle, 'launched');
    assert.equal(stableFacts.product.pricingUrl, 'https://www.worldmonitor.app/pro#pricing');
    assert.equal(stableFacts.product.primaryCtaLabel, 'View Pro plans');
    assert.equal(stableFacts.currency, 'USD');
    const serverCardNames = readJson('public/.well-known/mcp/server-card.json')
      .tools
      .map((tool) => tool.name);
    assert.deepEqual(serverCardNames.sort(), registryToolNames().sort());
    assert.equal(stats.mcpToolCount, registryToolCount());

    const proMonthly = stableFacts.plans.find((plan) => plan.planKey === 'pro_monthly');
    const proAnnual = stableFacts.plans.find((plan) => plan.planKey === 'pro_annual');
    assert.equal(proMonthly.price, PRODUCT_CATALOG.pro_monthly.priceCents / 100);
    assert.equal(proMonthly.billingDuration, 'P1M');
    assert.equal(proAnnual.price, PRODUCT_CATALOG.pro_annual.priceCents / 100);
    assert.equal(proAnnual.billingDuration, 'P1Y');
    for (const plan of stableFacts.plans.filter((candidate) => candidate.price != null)) {
      assert.equal(plan.priceCurrency, 'USD');
      assert.equal(plan.availability, 'https://schema.org/InStock');
      assert.equal(plan.url, stableFacts.product.pricingUrl);
    }
  });

  it('keeps the A2A routing card tool count aligned with the live registry', () => {
    assert.equal(advertisedAgentCardToolCount(), registryToolCount());
  });

  it('removes stale waitlist lifecycle terms from current acquisition surfaces', () => {
    const banned = /Pro \(Waitlist\)|Get Early Access|pro#waitlist/;
    for (const path of CURRENT_FACT_SURFACES) {
      assert.doesNotMatch(read(path), banned, `${path} still publishes a pre-launch lifecycle term`);
    }
  });

  it('keeps volatile inventory totals out of hand-authored acquisition copy', () => {
    const violations = validateVolatileInventoryClaims();
    assert.deepEqual(
      violations,
      [],
      `hand-authored acquisition copy must use registry-derived or semantic inventory wording:\n${violations.join('\n')}`,
    );
    for (const claim of [
      '30+ live services',
      '500+ curated news feeds',
      '25+ other live services',
      '12+ data source credentials',
      'MCP offers 52 tools',
      'There are 445 API handlers',
      '80+ Vercel Edge Functions',
      '190+ documented operations',
      '24 typed services',
      '26 OSINT channels',
      '31 live webcams',
      'seven live news channels',
      'Panels: 102',
      'six specialized variants',
      'five dashboard variants',
      'five interchangeable surfaces',
      '34 proto-backed domains',
      '27 positive-news feeds',
      '28 supported languages',
      '44 data layers',
      '44 other intelligence layers',
      '20+ separate services',
      '| Live video streams | 8 |',
      '| Languages supported | 27 (including RTL) |',
      '| Airports monitored | 111 |',
      '52個のMCPツール',
      '52個のMCPツールも使える',
      '52個のMCPツールから選べる',
      '52個のMCPツールまで対応',
      '52個のMCPツールより多い',
      '60以上のVercel Edge Functions',
      '6つのダッシュボード',
      '313のAIデータセンターを電力・運営者メタデータ付きでマッピング',
      '26 个 OSINT 频道',
      '210+ military bases',
      '38+ associated military bases',
      '9 strategic theaters',
      '210+ 基地数据库',
      '56-channel Telegram OSINT feed',
      '62 strategic ports',
      '88 mapped pipelines',
      '13 monitored waterways',
      '~100 tracked satellites',
      '80–120 intelligence satellites',
      '25 installable agent skills',
      '跨 30+ 实时服务',
      '500 多个实时数据源',
      '25 个可安装智能体技能',
      '25 个公开智能体配方',
      'Vercel Edge Functions（60+）',
      'Vercel Edge Functions (60 以上)',
    ]) {
      assert.match(claim, VOLATILE_INVENTORY_CLAIM_RE, `modifier form must remain guarded: ${claim}`);
    }
  });

  it('keeps user-visible prices aligned with generated plan facts', () => {
    const facts = readJson('shared/product-facts.generated.json');
    const plans = Object.fromEntries(facts.plans.map((plan) => [plan.planKey, plan]));
    const proMonthly = displayPrice(plans.pro_monthly.price);
    const proAnnual = displayPrice(plans.pro_annual.price);
    const apiMonthly = displayPrice(plans.api_starter.price);
    const apiAnnual = displayPrice(plans.api_starter_annual.price);
    const businessMonthly = displayPrice(plans.api_business.price);
    for (const path of ['docs/pricing.mdx', 'docs/zh/pricing.mdx', 'public/pricing.md']) {
      const source = read(path);
      for (const price of [proMonthly, proAnnual, apiMonthly, apiAnnual, businessMonthly]) {
        assert.match(source, new RegExp(`\\$${price.replace('.', '\\.')}[^\\d]`), `${path}: $${price}`);
      }
    }

    const summaryPlans = Object.fromEntries(
      machineReadablePricing().plans.map((plan) => [plan.name, plan]),
    );
    assert.equal(summaryPlans.Pro.price_usd_monthly, plans.pro_monthly.price);
    assert.equal(summaryPlans.Pro.price_usd_yearly, plans.pro_annual.price);
    assert.equal(summaryPlans.API.price_usd_monthly, plans.api_starter.price);
    assert.equal(summaryPlans.API.price_usd_yearly, plans.api_starter_annual.price);
    assert.equal(summaryPlans['API Business'].price_usd_monthly, plans.api_business.price);
  });

  it('states the measured source inventory on every surface that quotes it', { skip: PRODUCT_FACTS_FROZEN }, () => {
    const stats = buildSourceAttributionStats({ validate: false });
    const providers = `${stats.providerCount} attributed providers`;
    const hosts = `${stats.activeHosts} observed source hosts`;
    const surfaces = [
      ['docs/about.mdx', [`${stats.feedHosts} news and OSINT feeds from ${providers}`, `all ${providers}`]],
      ['ARCHITECTURE.md', [hosts]],
      ['public/llms-full.txt', [`${providers} across ${hosts}`]],
      ['api/oauth/authorize.js', [`events from ${providers}`]],
      ['mcp-grant.html', [`events from ${providers}`]],
    ];
    for (const [path, phrases] of surfaces) {
      const text = read(path);
      for (const phrase of phrases) assert.ok(text.includes(phrase), `${path} must state "${phrase}"`);
      // The hand-typed totals these surfaces had drifted to before they were restated.
      assert.doesNotMatch(text, /\b(?:578\+? observed upstream hosts|574 active providers|100\+ global sources)\b/, path);
    }
  });

  it('derives hero proof stats from live registries, not literals', { skip: PRODUCT_FACTS_FROZEN }, async () => {
    const { getCompleteLayerCatalogKeys } = await import('../src/config/map-layer-definitions.ts');
    const { loadManifest, scanUpstreamHosts, sourceAttributionStats } = await import('../scripts/source-attribution.mjs');
    const facts = readJson('shared/product-facts.generated.json');
    const stats = sourceAttributionStats(scanUpstreamHosts(ROOT), loadManifest(ROOT));
    assert.equal(facts.heroProofStats.mapLayers, getCompleteLayerCatalogKeys('full').length);
    assert.equal(facts.heroProofStats.feeds, stats.feedHosts);
    assert.equal(facts.heroProofStats.providers, stats.providerCount);
    assert.equal(facts.heroProofStats.alertOrigins, 5);
  });
});
