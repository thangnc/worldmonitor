/**
 * Pure resolver: maps gateway-internal auth state to a UsageIdentity event field set.
 *
 * MUST NOT re-hash keys or re-validate API keys. The gateway has already done
 * that work — this function consumes the resolved values.
 */

export type AuthKind =
  | 'enterprise_api_key'
  | 'widget_key'
  | 'anon';

export interface UsageIdentity {
  auth_kind: AuthKind;
  principal_id: string | null;
  customer_id: string | null;
  tier: number;
  plan_key: string | null;
}

export interface UsageIdentityInput {
  enterpriseApiKey: string | null;
  widgetKey: string | null;
  tier: number | null;
}

// Static enterprise-key → customer map. Explicit so attribution is reviewable in code,
// not floating in env vars. Add entries here as enterprise customers are onboarded.
// The hash (not the raw key) is used as principal_id so logs never leak the secret.
const ENTERPRISE_KEY_TO_CUSTOMER: Record<string, string> = {
  // 'wm_ent_xxxx': 'acme-corp',
};

export function buildUsageIdentity(input: UsageIdentityInput): UsageIdentity {
  const tier = input.tier ?? 0;

  if (input.enterpriseApiKey) {
    const customer = ENTERPRISE_KEY_TO_CUSTOMER[input.enterpriseApiKey] ?? 'enterprise-unmapped';
    return {
      auth_kind: 'enterprise_api_key',
      principal_id: hashKeySync(input.enterpriseApiKey),
      customer_id: customer,
      tier,
      plan_key: 'enterprise',
    };
  }

  if (input.widgetKey) {
    return {
      auth_kind: 'widget_key',
      principal_id: hashKeySync(input.widgetKey),
      customer_id: 'widget',
      tier,
      plan_key: null,
    };
  }

  return {
    auth_kind: 'anon',
    principal_id: null,
    customer_id: null,
    tier: 0,
    plan_key: null,
  };
}

// 64-bit FNV-1a (two-round, XOR-folded) — non-cryptographic, only used to
// avoid logging raw key material. Edge crypto.subtle.digest is async; we
// want a sync helper for the hot path. Two rounds with different seeds give
// ~64 bits of state, dropping birthday-collision risk well below the
// widget-key population horizon (32-bit collides ~65k keys).
export function hashKeySync(key: string): string {
  let h1 = 2166136261;
  let h2 = 0x811c9dc5 ^ 0xa3b2c1d4;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 16777619);
    h2 ^= c + 0x9e3779b1;
    h2 = Math.imul(h2, 16777619);
  }
  const lo = (h1 >>> 0).toString(36);
  const hi = (h2 >>> 0).toString(36);
  return `${hi}${lo}`;
}
