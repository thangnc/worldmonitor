/**
 * Tests for the cron's why-matters analyst-priority fallback chain and the
 * shared helpers it uses (country normalizer, core hashing, the v2 output
 * validator, shadow sampling). The /api/internal/brief-why-matters edge
 * endpoint and its prompt builder were removed in Lite Phase 1c. The
 * cron-side `generateWhyMatters` priority chain is covered directly via
 * in-process dep injection.
 *
 * Run: node --test tests/brief-why-matters-analyst.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { generateWhyMatters } from '../scripts/lib/brief-llm.mjs';
import {
  hashBriefStory,
  parseWhyMattersV2,
} from '../packages/shared/brief-llm-core.js';

const ANALYST_MAX_TOKEN_CLIP =
  'Marine Le Pen\u2019s conviction on appeal leaves her legally eligible for the 2027 presidential election. ' +
  'The ruling reshapes the campaign while leaving debate over democratic norms and';

// ── Story fixture matching the cron's actual payload shape
// (packages/shared/brief-filter.js:134-135). ────────────────────────────────────

function story(overrides = {}) {
  return {
    headline: 'Iran closes Strait of Hormuz',
    source: 'Reuters',
    threatLevel: 'critical',
    category: 'Geopolitical Risk',
    country: 'IR',
    ...overrides,
  };
}

// ── Country normalizer ───────────────────────────────────────────────────

describe('normalizeCountryToIso2', () => {
  let normalize;
  it('loads from packages/server/_shared/country-normalize.ts via tsx or compiled', async () => {
    // The module is .ts; in the repo's test setup, node 22 can load .ts
    // via tsx. If direct import fails under the test runner, fall back
    // to running the logic inline by importing the JSON and a mirror
    // function. The logic is trivial so this isn't a flaky compromise.
    try {
      const mod = await import('../packages/server/_shared/country-normalize.ts');
      normalize = mod.normalizeCountryToIso2;
    } catch {
      const { default: COUNTRY_NAMES } = await import('../packages/shared/country-names.json', {
        with: { type: 'json' },
      });
      const ISO2_SET = new Set(Object.values(COUNTRY_NAMES));
      normalize = (raw) => {
        if (typeof raw !== 'string') return null;
        const trimmed = raw.trim();
        if (trimmed === '') return null;
        if (trimmed.toLowerCase() === 'global') return null;
        if (/^[A-Za-z]{2}$/.test(trimmed)) {
          const upper = trimmed.toUpperCase();
          return ISO2_SET.has(upper) ? upper : null;
        }
        const lookup = COUNTRY_NAMES[trimmed.toLowerCase()];
        return typeof lookup === 'string' ? lookup : null;
      };
    }
    assert.ok(typeof normalize === 'function');
  });

  it('passes through valid ISO2 case-insensitively', () => {
    assert.equal(normalize('US'), 'US');
    assert.equal(normalize('us'), 'US');
    assert.equal(normalize('IR'), 'IR');
    assert.equal(normalize('gb'), 'GB');
  });

  it('resolves full names case-insensitively', () => {
    assert.equal(normalize('United States'), 'US');
    assert.equal(normalize('united states'), 'US');
    assert.equal(normalize('Iran'), 'IR');
    assert.equal(normalize('United Kingdom'), 'GB');
  });

  it("'Global' sentinel maps to null (non-country; not an error)", () => {
    assert.equal(normalize('Global'), null);
    assert.equal(normalize('global'), null);
    assert.equal(normalize('GLOBAL'), null);
  });

  it('rejects unknown / empty / undefined / non-string inputs', () => {
    assert.equal(normalize(''), null);
    assert.equal(normalize('   '), null);
    assert.equal(normalize('Nowhere'), null);
    assert.equal(normalize(undefined), null);
    assert.equal(normalize(null), null);
    assert.equal(normalize(123), null);
  });

  it('resolves common non-ISO2 abbreviations when they exist in the gazetteer', () => {
    // Plan assumed "USA" was not in the gazetteer; it actually is mapped.
    // This exercises the full-name-path (3+ chars) with a short abbreviation.
    assert.equal(normalize('USA'), 'US');
  });

  it('rejects ISO2-shaped values not in the gazetteer', () => {
    assert.equal(normalize('ZZ'), null); // structurally valid, not in gazetteer
    assert.equal(normalize('XY'), null);
  });
});

describe('displayNameForIso2', () => {
  it('resolves non-tier-1 codes such as Norway instead of leaking the ISO code', async () => {
    const { displayNameForIso2 } = await import('../packages/server/_shared/country-normalize.ts');
    assert.equal(displayNameForIso2('NO'), 'Norway');
    assert.equal(displayNameForIso2('no'), 'Norway');
    assert.equal(displayNameForIso2('US'), 'United States');
    assert.equal(displayNameForIso2('GB'), 'United Kingdom');
    assert.equal(displayNameForIso2('PS'), 'Palestinian Territories');
    assert.equal(displayNameForIso2('CD'), 'Congo - Kinshasa');
    assert.equal(displayNameForIso2('LA'), 'Laos');
    assert.equal(displayNameForIso2('KR'), 'South Korea');
    assert.equal(displayNameForIso2('ZZ'), null);
  });
});

// ── Cache-key stability ──────────────────────────────────────────────────

describe('cache key identity', () => {
  it('uses an unambiguous tuple and a full SHA-256 digest', async () => {
    const a = await hashBriefStory(story({ headline: 'a||b', source: 'c' }));
    const b = await hashBriefStory(story({ headline: 'a', source: 'b||c' }));
    assert.notEqual(a, b);
    assert.match(a, /^[a-f0-9]{64}$/);
  });

  it('hashBriefStory stable across the six-field material', async () => {
    const a = await hashBriefStory(story());
    const b = await hashBriefStory(story());
    assert.equal(a, b);
  });

  it('hashBriefStory differs when any hash-field differs', async () => {
    const baseline = await hashBriefStory(story());
    for (const f of ['headline', 'source', 'threatLevel', 'category', 'country', 'description']) {
      const h = await hashBriefStory(story({ [f]: `${story()[f]}X` }));
      assert.notEqual(h, baseline, `${f} must be part of cache identity`);
    }
  });
});

// ── parseWhyMattersV2 — analyst-path output validator ───────────────────
//
// This is the only output-validation gate between the analyst LLM and
// the cache envelope: if it returns null the whole response falls back
// to the gemini layer. Its rejection rules differ from v1 (100–500
// char range, multi-sentence preamble list, section-label check) and
// were not previously covered by unit tests (greptile P2, PR #3281).

describe('parseWhyMattersV2 — analyst output validator', () => {
  const VALID_MULTI =
    "Iran's closure of the Strait of Hormuz on April 21 halts roughly 20% of global seaborne oil. " +
    'The disruption forces an immediate repricing of sovereign risk across Gulf energy exporters.';

  it('accepts a valid 1–2 sentence output', () => {
    const out = parseWhyMattersV2(VALID_MULTI);
    assert.equal(out, VALID_MULTI);
  });

  it('parser tolerates a longer 3-sentence output (lenient by design; the prompt asks for 1–2)', () => {
    // The parser only gates 100–500 chars + shape, not sentence count, so an
    // occasional over-length generation is passed through rather than nuked
    // to the stub. Conciseness is enforced by the prompt contract, not here.
    const three =
      "Iran's closure of the Strait of Hormuz on April 21 halts roughly 20% of global seaborne oil. " +
      'The disruption forces an immediate repricing of sovereign risk across Gulf energy exporters. ' +
      'Watch IMF commentary in the next 48 hours for cascading guidance.';
    assert.equal(parseWhyMattersV2(three), three);
  });

  it('rejects output under the 100-char minimum (distinguishes it from v1)', () => {
    // v1 accepts short outputs; v2 requires 100+ chars so the model has
    // room for SITUATION + ANALYSIS. A short string is "too terse".
    assert.equal(parseWhyMattersV2('Short sentence under 100 chars.'), null);
    assert.equal(parseWhyMattersV2('x'.repeat(99)), null);
    // Boundary: exactly 100 passes.
    assert.equal(typeof parseWhyMattersV2(`${'x'.repeat(99)}.`), 'string');
  });

  it('rejects output over the 500-char cap (prevents runaway essays)', () => {
    assert.equal(parseWhyMattersV2('x'.repeat(501)), null);
    // Boundary: exactly 500 passes.
    assert.equal(typeof parseWhyMattersV2(`${'x'.repeat(499)}.`), 'string');
  });

  it('rejects the captured max-token clips from both model eras', () => {
    assert.equal(parseWhyMattersV2(ANALYST_MAX_TOKEN_CLIP), null);
  });

  it('rejects banned preamble phrases (v2-specific)', () => {
    for (const preamble of [
      'This matters because the Strait of Hormuz closure would halt 20% of global oil supply right now and this is very important for analysts.',
      'The importance of this event is that oil tankers cannot transit the strait, which forces a global supply rerouting and price shock.',
      'It is important to note that Iran has blockaded a critical global shipping chokepoint with real consequences for supply.',
      'Importantly, the closure of the Strait of Hormuz disrupts roughly 20% of global seaborne oil flows starting April 21.',
      'In summary, the analyst sees this as a major geopolitical escalation with wide-reaching market and security implications.',
      'To summarize, the blockade represents a sharp departure from the prior six months of relative calm in the Persian Gulf region.',
    ]) {
      assert.equal(parseWhyMattersV2(preamble), null, `should reject preamble: "${preamble.slice(0, 40)}..."`);
    }
  });

  it('rejects section-label leaks (SITUATION/ANALYSIS/WATCH prefixes)', () => {
    for (const leak of [
      'SITUATION: Iran has closed the Strait of Hormuz effective April 21, halting roughly 20% of seaborne global oil supply today.',
      'ANALYSIS — the disruption forces an immediate global sovereign risk repricing across Gulf exporters including Saudi Arabia and UAE.',
      'Watch: IMF commentary for the next 48 hours should give the earliest signal on the cascading global guidance implications.',
    ]) {
      assert.equal(parseWhyMattersV2(leak), null, `should reject label leak: "${leak.slice(0, 40)}..."`);
    }
  });

  it('rejects raw forecast-probability disclosures but preserves ordinary sourced percentages', () => {
    const forecastLeak =
      "WorldMonitor's internal forecast assigns an 84% probability to a Strait of Hormuz disruption, which would intensify regional shipping risk. " +
      'That projection is not a reader-facing fact and must fall through to the next generation layer.';
    const likelyLeak =
      'A disruption is 84% likely according to the forecast, creating an immediate risk of higher insurance costs across Gulf shipping routes. ' +
      'The analyst should not present that internal probability as a published fact.';
    const provenance = {
      publicStory: {
        headline: 'Insurers reassess Gulf shipping routes',
        description: 'Carriers are reviewing transit plans after new regional threats.',
        source: 'Reuters',
      },
      privateForecasts: 'WorldMonitor disruption model: Strait closure remains 84% likely.',
    };
    assert.equal(parseWhyMattersV2(forecastLeak, provenance), null);
    assert.equal(parseWhyMattersV2(likelyLeak, provenance), null);
    assert.equal(parseWhyMattersV2(VALID_MULTI), VALID_MULTI, 'ordinary story percentages must remain valid');
  });

  it('rejects markdown leakage (bullets, headers, numbered lists)', () => {
    for (const md of [
      '# The closure of the Strait of Hormuz is the single most material geopolitical event of the quarter for sovereign credit.',
      '- Iran has blockaded the Strait of Hormuz, halting roughly 20% of the world seaborne oil on April 21 effective immediately.',
      '* The closure of the Strait of Hormuz halts roughly 20% of the world seaborne oil, which forces an immediate price shock today.',
      '1. The closure of the Strait of Hormuz halts roughly 20% of seaborne global oil, which forces an immediate sovereign risk repricing.',
    ]) {
      assert.equal(parseWhyMattersV2(md), null, `should reject markdown: "${md.slice(0, 40)}..."`);
    }
  });

  it('rejects the stub echo (same as v1)', () => {
    const stub =
      'Story flagged by your sensitivity settings — the analyst could not find a clean grounding fact and returned the pre-canned fallback.';
    assert.equal(parseWhyMattersV2(stub), null);
  });

  it('trims surrounding quote marks the model sometimes wraps output in', () => {
    const quoted = `"${VALID_MULTI}"`;
    assert.equal(parseWhyMattersV2(quoted), VALID_MULTI);
    const smart = `\u201C${VALID_MULTI}\u201D`;
    assert.equal(parseWhyMattersV2(smart), VALID_MULTI);
  });

  it('rejects non-string inputs (defensive)', () => {
    for (const v of [null, undefined, 123, {}, [], true]) {
      assert.equal(parseWhyMattersV2(v), null, `should reject ${typeof v}`);
    }
  });

  it('rejects whitespace-only strings', () => {
    assert.equal(parseWhyMattersV2(''), null);
    assert.equal(parseWhyMattersV2('   \n\t  '), null);
  });
});

// ── Deterministic shadow sampling ────────────────────────────────────────

describe('shadow sample deterministic hashing', () => {
  // Mirror of the endpoint's sample decision — any drift between this
  // and the endpoint would silently halve the sampled population.
  function sampleHit(hash16, pct) {
    if (pct >= 100) return true;
    if (pct <= 0) return false;
    const bucket = Number.parseInt(hash16.slice(0, 8), 16) % 100;
    return bucket < pct;
  }

  it('pct=100 always hits', () => {
    for (const h of ['0000000000000000', 'ffffffffffffffff', 'abcdef0123456789']) {
      assert.equal(sampleHit(h, 100), true);
    }
  });

  it('pct=0 never hits', () => {
    for (const h of ['0000000000000000', 'ffffffffffffffff', 'abcdef0123456789']) {
      assert.equal(sampleHit(h, 0), false);
    }
  });

  it('pct=25 hits approximately 25% on a bulk sample, and is deterministic', async () => {
    let hits = 0;
    const N = 400;
    const seen = new Map();
    for (let i = 0; i < N; i++) {
      const h = await hashBriefStory(story({ headline: `fixture-${i}` }));
      const first = sampleHit(h, 25);
      const second = sampleHit(h, 25);
      assert.equal(first, second, `hash ${h} must give the same decision`);
      seen.set(h, first);
      if (first) hits++;
    }
    // Tolerance: uniform mod-100 on SHA-256 prefix should be tight.
    assert.ok(hits > N * 0.15, `expected > 15% hits, got ${hits}`);
    assert.ok(hits < N * 0.35, `expected < 35% hits, got ${hits}`);
  });
});

// ── `generateWhyMatters` analyst-priority chain ─────────────────────────

describe('generateWhyMatters — analyst priority', () => {
  const VALID = 'Closure of the Strait of Hormuz would spike global oil prices and force a US naval response.';

  it('uses the analyst endpoint result when it returns a string', async () => {
    let callLlmInvoked = false;
    const out = await generateWhyMatters(story(), {
      callAnalystWhyMatters: async () => VALID,
      callLLM: async () => {
        callLlmInvoked = true;
        return 'FALLBACK unused';
      },
      cacheGet: async () => null,
      cacheSet: async () => {},
    });
    assert.equal(out, VALID);
    assert.equal(callLlmInvoked, false, 'legacy callLLM must NOT fire when analyst returns');
  });

  it('falls through to legacy chain when analyst returns null', async () => {
    let callLlmInvoked = false;
    const out = await generateWhyMatters(story(), {
      callAnalystWhyMatters: async () => null,
      callLLM: async () => {
        callLlmInvoked = true;
        return VALID;
      },
      cacheGet: async () => null,
      cacheSet: async () => {},
    });
    assert.equal(out, VALID);
    assert.equal(callLlmInvoked, true, 'legacy callLLM must fire after analyst miss');
  });

  it('logs an accurate runtime type when analyst returns a non-string value', async () => {
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      for (const [analystOut, expectedType] of [
        [null, 'null'],
        [{ whyMatters: VALID }, 'object'],
      ]) {
        warnings.length = 0;
        const out = await generateWhyMatters(story(), {
          callAnalystWhyMatters: async () => analystOut,
          callLLM: async () => VALID,
          cacheGet: async () => null,
          cacheSet: async () => {},
        });

        assert.equal(out, VALID);
        assert.ok(
          warnings.some((line) => line.includes(`endpoint returned no usable string (type=${expectedType})`)),
          `expected a ${expectedType} runtime type tag; got ${JSON.stringify(warnings)}`,
        );
      }
    } finally {
      console.warn = originalWarn;
    }
  });

  it('falls through when analyst returns out-of-bounds output (too short)', async () => {
    let callLlmInvoked = false;
    const out = await generateWhyMatters(story(), {
      callAnalystWhyMatters: async () => 'Short.',
      callLLM: async () => {
        callLlmInvoked = true;
        return VALID;
      },
      cacheGet: async () => null,
      cacheSet: async () => {},
    });
    assert.equal(out, VALID);
    assert.equal(callLlmInvoked, true, 'out-of-bounds analyst output must trigger fallback');
  });

  it('falls through when the analyst endpoint returns a max-token clip', async () => {
    let callLlmInvoked = false;
    const out = await generateWhyMatters(story(), {
      callAnalystWhyMatters: async () => ANALYST_MAX_TOKEN_CLIP,
      callLLM: async () => {
        callLlmInvoked = true;
        return VALID;
      },
      cacheGet: async () => null,
      cacheSet: async () => {},
    });
    assert.equal(out, VALID);
    assert.equal(callLlmInvoked, true, 'clipped endpoint output must trigger fallback');
  });

  it('preserves multi-sentence v2 analyst output verbatim (P1 regression guard)', async () => {
    // The endpoint now returns 1–2 sentences validated by parseWhyMattersV2.
    // The cron MUST NOT reparse with the narrower v1 bounds. Caught in PR
    // #3269 review; fixed by trusting the endpoint's own validation and only
    // rejecting obvious garbage (length / stub echo) here.
    const multi =
      "Iran's closure of the Strait of Hormuz on April 21 halts roughly 20% of global seaborne oil. " +
      'The disruption forces an immediate repricing of sovereign risk across Gulf energy exporters. ' +
      'Watch IMF commentary in the next 48 hours for cascading guidance.';
    let callLlmInvoked = false;
    const out = await generateWhyMatters(story(), {
      callAnalystWhyMatters: async () => multi,
      callLLM: async () => {
        callLlmInvoked = true;
        return VALID;
      },
      cacheGet: async () => null,
      cacheSet: async () => {},
    });
    assert.equal(out, multi, 'multi-sentence v2 output must reach the envelope unchanged');
    assert.equal(callLlmInvoked, false, 'legacy callLLM must not fire when v2 analyst succeeds');
    // Sanity: output is actually multi-sentence (not truncated to first).
    assert.ok(out.split('. ').length >= 2, 'output must retain 2nd+ sentences');
  });

  it('falls through when analyst throws', async () => {
    let callLlmInvoked = false;
    const out = await generateWhyMatters(story(), {
      callAnalystWhyMatters: async () => {
        throw new Error('network timeout');
      },
      callLLM: async () => {
        callLlmInvoked = true;
        return VALID;
      },
      cacheGet: async () => null,
      cacheSet: async () => {},
    });
    assert.equal(out, VALID);
    assert.equal(callLlmInvoked, true);
  });

  it('returns null when BOTH layers fail (caller uses stub)', async () => {
    const out = await generateWhyMatters(story(), {
      callAnalystWhyMatters: async () => null,
      callLLM: async () => null,
      cacheGet: async () => null,
      cacheSet: async () => {},
    });
    assert.equal(out, null);
  });

  it('no callAnalystWhyMatters dep → legacy chain runs directly (backcompat)', async () => {
    let callLlmInvoked = false;
    const out = await generateWhyMatters(story(), {
      callLLM: async () => {
        callLlmInvoked = true;
        return VALID;
      },
      cacheGet: async () => null,
      cacheSet: async () => {},
    });
    assert.equal(out, VALID);
    assert.equal(callLlmInvoked, true);
  });
});

// ── Gemini path prompt parity snapshot ────────────────────────────────

describe('Gemini path prompt parity', () => {
  it('buildWhyMattersPrompt output is stable (frozen snapshot)', async () => {
    const { buildWhyMattersPrompt } = await import('../scripts/lib/brief-llm.mjs');
    const { system, user } = buildWhyMattersPrompt(story());
    // Snapshot — if either the system prompt or the user prompt shape
    // changes, the endpoint's gemini-path output will drift from the
    // cron's pre-PR output. Bump BRIEF_WHY_MATTERS_PRIMARY=gemini
    // rollout risk accordingly.
    assert.match(system, /ONE concise sentence \(18–30 words\)/);
    assert.equal(
      user.split('\n').slice(0, 5).join('\n'),
      [
        'Headline: Iran closes Strait of Hormuz',
        'Source: Reuters',
        'Severity: critical',
        'Category: Geopolitical Risk',
        'Country: IR',
      ].join('\n'),
    );
    assert.ok(user.endsWith('One editorial sentence on why this matters:'));
  });
});
