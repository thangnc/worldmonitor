/**
 * Source provenance fail-closed defaults (#5390).
 *
 * Regression: unlisted feeds used to default to propaganda risk `low`
 * ("Independent journalism with editorial standards") and source type
 * `other`, which NewsPanel rendered for Tier 1/2 as "Verified News Outlet"
 * (and Tier 1 as a "Wire" label). Official ministry feeds such as
 * official Chinese policy sources therefore looked like independent wire services.
 *
 * Contract:
 * - Missing registry entries → risk `unknown`, type `unknown` (never low/other)
 * - Explicit low only when reviewed in SOURCE_PROPAGANDA_RISK
 * - All six China policy agencies are government sources with high state-affiliated risk
 * - Badge helpers never claim "Verified News Outlet" for unreviewed types
 * - Every declared feed has a definite provenance state via the public API
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as feeds from '../packages/shared/source-provenance.ts';
import { getSourceTier } from '../packages/server/_shared/source-tiers.ts';
import { CONFIGURED_SOURCE_PROVENANCE_DECLARATIONS } from '../packages/shared/source-provenance-declarations';

describe('source provenance defaults (#5390)', () => {
  it('does not map missing risk profiles to independent (low)', () => {
    const profile = feeds.getSourcePropagandaRisk('Completely Unlisted Outlet XYZ');
    assert.equal(profile.risk, 'unknown');
    assert.equal(profile.note, feeds.UNREVIEWED_SOURCE_RISK.note);
    assert.equal(feeds.hasDeclaredPropagandaRisk('Completely Unlisted Outlet XYZ'), false);
    assert.equal(feeds.hasReviewedPropagandaRisk('Completely Unlisted Outlet XYZ'), false);
  });

  it('does not map missing source types to other', () => {
    assert.equal(feeds.getSourceType('Completely Unlisted Outlet XYZ'), 'unknown');
    assert.equal(feeds.hasDeclaredSourceType('Completely Unlisted Outlet XYZ'), false);
    assert.equal(feeds.hasReviewedSourceType('Completely Unlisted Outlet XYZ'), false);
  });

  it('keeps explicit low only for reviewed independent sources', () => {
    assert.equal(feeds.getSourcePropagandaRisk('Reuters').risk, 'low');
    assert.equal(feeds.hasReviewedPropagandaRisk('Reuters'), true);
    assert.equal(feeds.describePropagandaBadge(feeds.getSourcePropagandaRisk('Reuters')), null);
  });

  it('classifies reviewed Chinese ministries, agencies, and data publishers as government', () => {
    for (const name of [
      'CAC (China)',
      'SAMR (China)',
      'MIIT (China)',
      'MOFCOM (China)',
      'NDRC (China)',
      'NBS (China)',
      'PBoC (China)',
      'SAFE (China)',
      'GACC (China)',
    ] as const) {
      assert.equal(feeds.getSourceType(name), 'gov', `${name} type`);
      assert.equal(feeds.SOURCE_TYPES[name], 'gov');
      const risk = feeds.getSourcePropagandaRisk(name);
      assert.equal(risk.risk, 'high', `${name} risk`);
      assert.equal(risk.stateAffiliated, 'China');
      if (name === 'MIIT (China)' || name === 'MOFCOM (China)') {
        assert.equal(getSourceTier(name), 1, `${name} configured feed tier`);
      }
      const badge = feeds.describePropagandaBadge(risk, feeds.getSourceType(name));
      assert.ok(badge);
      assert.equal(badge!.risk, 'high');
      assert.equal(badge!.label, 'Official Government Source: China');
      assert.doesNotMatch(badge!.title, /State-affiliated/);
      assert.doesNotMatch(badge!.label, /State Media/);
      assert.equal(feeds.getSourceTierBadgeTitle(feeds.getSourceType(name)), 'Official Government Source');
      assert.notEqual(feeds.getSourceType(name), 'wire');
    }
  });

  it('never presents unreviewed types as Verified News Outlet', () => {
    assert.equal(feeds.getSourceTierBadgeTitle('unknown'), 'Source type not yet reviewed');
    assert.doesNotMatch(feeds.getSourceTierBadgeTitle('unknown'), /Verified/i);
    assert.equal(feeds.getSourceTierBadgeTitle('wire'), 'Wire Service - Highest reliability');
    assert.equal(feeds.getSourceTierBadgeTitle('gov'), 'Official Government Source');
    assert.doesNotMatch(feeds.getSourceTierBadgeTitle('mainstream'), /Verified News Outlet/);
  });

  it('surfaces unknown provenance in badge descriptors', () => {
    const badge = feeds.describePropagandaBadge(feeds.getSourcePropagandaRisk('Fars News'));
    assert.ok(badge);
    assert.equal(badge!.risk, 'unknown');
    assert.match(badge!.label, /Unreviewed/);
    assert.match(badge!.title, /not yet reviewed/i);
  });

  it('every provenance declaration matches the reviewed registries', () => {
    const names = Object.keys(CONFIGURED_SOURCE_PROVENANCE_DECLARATIONS);
    assert.ok(names.length > 0, 'provenance declarations must not be empty');
    assert.ok(names.includes('MIIT (China)'));
    assert.ok(names.includes('MOFCOM (China)'));

    const falselyIndependent: string[] = [];
    let explicitUnknownDimensions = 0;

    for (const name of names) {
      const state = feeds.getSourceProvenanceState(name);
      const declaration = CONFIGURED_SOURCE_PROVENANCE_DECLARATIONS[name];
      assert.ok(declaration, `${name} missing explicit provenance declaration`);
      assert.ok(state.risk, `${name} missing risk`);
      assert.ok(state.type, `${name} missing type`);
      assert.equal(state.riskDeclared, true, `${name} risk declaration`);
      assert.equal(state.typeDeclared, true, `${name} type declaration`);
      assert.equal(
        declaration.risk,
        state.riskReviewed ? 'reviewed' : 'unknown',
        `${name} risk declaration drift`,
      );
      assert.equal(
        declaration.type,
        state.typeReviewed ? 'reviewed' : 'unknown',
        `${name} type declaration drift`,
      );
      if (declaration.risk === 'unknown') explicitUnknownDimensions += 1;
      if (declaration.type === 'unknown') explicitUnknownDimensions += 1;

      if (state.risk === 'low' && !state.riskReviewed) {
        falselyIndependent.push(name);
      }
      if (!state.riskReviewed) {
        assert.equal(state.risk, 'unknown', `${name} unreviewed risk`);
      }
      if (!state.typeReviewed) {
        assert.equal(state.type, 'unknown', `${name} unreviewed type`);
      }
    }

    assert.deepEqual(falselyIndependent, [], 'unreviewed feeds must not claim low risk');
    assert.ok(explicitUnknownDimensions > 0, 'unreviewed dimensions must be explicitly declared unknown');
  });

  it('SOURCE_PROPAGANDA_RISK entries never use the unknown default sentinel by accident', () => {
    for (const [name, profile] of Object.entries(feeds.SOURCE_PROPAGANDA_RISK)) {
      assert.ok(
        profile.risk === 'low' || profile.risk === 'medium' || profile.risk === 'high',
        `${name} should be an explicit reviewed risk, got ${profile.risk}`,
      );
    }
  });
});
