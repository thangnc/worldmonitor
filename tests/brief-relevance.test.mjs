import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { briefIrrelevanceReason, isBriefRelevantTitle } from '../packages/shared/brief-relevance.js';

describe('briefIrrelevanceReason', () => {
  it('rejects the sports, awards and entertainment rows that grounded 2026-09-21 briefs', () => {
    assert.equal(briefIrrelevanceReason('Egyptian physicist Ahmed Al-Gendy wins global Marie Curie Medal for nanotech cancer treatment'), 'award');
    assert.equal(briefIrrelevanceReason('Lionel Messi offered farewell by Argentina after international retirement'), 'sport');
    assert.equal(briefIrrelevanceReason('Black Maidens thrash Burkina Faso 4-0 in WAFU B opener'), 'sport');
    assert.equal(briefIrrelevanceReason('Messi in Argentina squad for farewell match against Benin'), 'sport');
    assert.equal(briefIrrelevanceReason('Acosta outruns Martin to claim maiden MotoGP victory in Austria'), 'sport');
    assert.equal(briefIrrelevanceReason('Montenegro: RTCG hosts Eurovision Workshop in Tivat'), 'entertainment');
  });

  it('keeps substantive country news the threat classifier files as info/general', () => {
    for (const title of [
      'Egypt stands firm on Arab security and Gaza ceasefire: Sisi to CIA Director',
      "Argentina's Left stages 'March of Anger' over Milei's austerity measures",
      "Moscow claims Armenia wants 'hostile takeover' of Russian businesses",
      'Kenya defends local oil marketers amid Uganda\'s exploitation claims',
    ]) {
      assert.equal(briefIrrelevanceReason(title), null, title);
    }
  });

  it('keeps security and diplomatic news that shares vocabulary with sport or entertainment', () => {
    for (const title of [
      'Death squad blamed for killings in northern province',
      'State actor suspected in cable sabotage',
      'Allies act in concert with Kyiv on air defence',
      'Marathon talks end without a ceasefire deal',
      'Army chief retires amid international pressure',
      'Court upholds election result in 5-4 ruling',
      'Parliament passes budget in 3-2 committee vote',
      'Donald Trump claims son repaid Russian boxing chief Umar Kremlev for Bahamas wedding expenses',
      'Japan Diet passes defence spending bill',
      'US-China relationship strained by chip curbs',
    ]) {
      assert.equal(briefIrrelevanceReason(title), null, title);
    }
  });

  it('keeps security, rights and legal news that happens to name a sport, a star or an award', () => {
    for (const title of [
      'North Korea executes man for sharing K-pop videos',
      'Hunger striker dies in Bahrain prison',
      'Crowd crush at Indonesia football stadium kills 125',
      'Nigeria wins appeal to overturn $11bn P&ID arbitration award',
      'Police fire tear gas at protesters outside World Cup stadium',
      'Actress arrested over anti-government posts',
      'Court jails footballer for match-fixing',
    ]) {
      assert.equal(briefIrrelevanceReason(title), null, title);
    }
  });

  it('keeps honours given to office-holders and peace prizes', () => {
    assert.equal(briefIrrelevanceReason('Tuvalu PM Teo to receive Rising Nations Leaders award'), null);
    assert.equal(briefIrrelevanceReason('Jailed dissident wins Nobel Peace Prize'), null);
  });

  it('matches whole words only and treats non-strings as eligible', () => {
    assert.equal(briefIrrelevanceReason('Golfo de Fonseca maritime dispute flares'), null);
    assert.equal(briefIrrelevanceReason('Opposition names its tennis star candidate'), 'sport');
    assert.equal(briefIrrelevanceReason(undefined), null);
    assert.equal(briefIrrelevanceReason('   '), null);
    assert.equal(isBriefRelevantTitle('World Cup qualifier postponed'), false);
  });
});
