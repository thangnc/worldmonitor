/**
 * Contract-first services that may exist before their runtime is allowed to route.
 *
 * Extracted from scripts/enforce-sebuf-api-contract.mjs so the classification logic is
 * importable — and therefore testable — without executing the gate's top-level scan.
 *
 * Keep this list narrow. Each entry must name the issue whose acceptance removes the
 * exception, an owner, and a review date. The checks below reject an entry once its
 * service disappears, once it gains an HTTP gateway, or once its review date passes:
 * the first two end the deferral by design, and the third exists because neither of
 * them fires in the state that actually rots — the service sits gateway-less forever
 * because the tracking issue was deprioritised or closed unimplemented. Nothing here
 * reads GitHub, so the date is the only thing that forces a human to re-affirm.
 */
// Refactor Phase 1c deleted these services' api/ gateways because the Lite UI
// does not call them. Their protos stay because Lite and kept scripts still read
// some of their generated types (bootstrap payload shapes, resilience tooling);
// PR 2.1 moved proto/ into packages/contracts/proto; Phase 2 drops what nothing reads.
const RETIRED_GATEWAY_REMOVAL = 'refactor Phase 2 (docs/engineering/plans/2026-11-18-001-refactor-lite-monorepo-plan.md)';
const RETIRED_GATEWAY_REVIEW_BY = '2027-02-18';

export const DEFERRED_GENERATED_SERVICES = new Map([
  [
    'company_monitoring/v1',
    {
      removalIssue: '#6003',
      owner: '@koala73',
      // Re-affirm or remove by this date. First set ~3 months from the contract landing
      // (2026-08-05). Re-affirmed 2026-11-06 by @koala73: #6003 is still open and the
      // service still has no gateway; shorten it if #6003 is scheduled sooner.
      reviewBy: '2027-02-05',
    },
  ],
  [
    'aviation/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'batch/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'climate/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'consumer_prices/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'displacement/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'feedback/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'forecast/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'giving/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'health/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'imagery/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'leads/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'maritime/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'natural/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'positive_events/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'prediction/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'radiation/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'resilience/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'safety/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'scenario/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'scorecard/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'shipping/v2',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'thermal/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'trade/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'webcam/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
  [
    'wildfire/v1',
    { removalIssue: RETIRED_GATEWAY_REMOVAL, owner: '@thangnc', reviewBy: RETIRED_GATEWAY_REVIEW_BY },
  ],
]);

/**
 * Classifies every deferred entry against what the tree actually contains.
 *
 * @param {object} args
 * @param {Map<string, {removalIssue: string, owner: string, reviewBy: string}>} args.deferred
 * @param {Set<string>} args.seenGeneratedServices  keys found under the generated server tree
 * @param {Set<string>} args.seenGatewayDomains     keys that have an api/ gateway
 * @param {boolean} args.generatedTreePresent       whether the generated server dir exists at all
 * @param {string} args.today                       ISO date (YYYY-MM-DD) used for expiry
 * @returns {Array<{file: string, message: string, remedy: string}>}
 */
export function collectDeferredServiceViolations({
  deferred,
  seenGeneratedServices,
  seenGatewayDomains,
  generatedTreePresent,
  today,
}) {
  const violations = [];
  const file = 'scripts/lib/sebuf-deferred-services.mjs';

  for (const [key, entry] of deferred) {
    const { removalIssue, owner, reviewBy } = entry;

    // "Absent generated tree" and "service was removed" are indistinguishable from an
    // empty seenGeneratedServices, and they need opposite fixes. Only claim the service
    // is gone when we actually scanned a tree that could have contained it.
    if (generatedTreePresent && !seenGeneratedServices.has(key)) {
      violations.push({
        file,
        message: `deferred generated service ${key} no longer exists`,
        remedy: `Remove its DEFERRED_GENERATED_SERVICES entry (tracked by ${removalIssue}, owner ${owner}).`,
      });
      continue;
    }

    if (seenGatewayDomains.has(key)) {
      violations.push({
        file,
        message: `deferred generated service ${key} now has an HTTP gateway`,
        remedy: `Remove its DEFERRED_GENERATED_SERVICES entry (tracked by ${removalIssue}, owner ${owner}).`,
      });
      continue;
    }

    if (reviewBy && today > reviewBy) {
      violations.push({
        file,
        message: `deferred generated service ${key} passed its ${reviewBy} review date`,
        remedy: `${owner}: land ${removalIssue} and remove this entry, or push reviewBy out with a written reason.`,
      });
    }
  }

  return violations;
}
