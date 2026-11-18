import type { LlmRoutingPolicy } from './llm';

// Per-customer AI routing restriction (e.g. a contract that says a customer's
// AI traffic goes to one provider and nowhere else). The per-user policy store
// (Convex `aiRoutingPolicies`, keyed by the Clerk user id) was removed with
// Convex and Clerk, and no credential the gateway accepts carries a user id,
// so every caller resolves to the default chain. The decision type and its
// helpers stay so the LLM handlers keep one routing seam.

export type AiRoutingDecision =
  | { kind: 'default' }
  | { kind: 'restricted'; allowedProviders: string[] }
  | { kind: 'unavailable' };

const DEFAULT_DECISION: AiRoutingDecision = { kind: 'default' };

/** Decision for a gateway-routed request: always the default chain. */
export async function resolveAiRouting(_request?: Request): Promise<AiRoutingDecision> {
  return DEFAULT_DECISION;
}

/** The `routingPolicy` to pass to llm.ts. */
export function toLlmRoutingPolicy(decision: AiRoutingDecision): LlmRoutingPolicy | null {
  if (decision.kind === 'default') return null;
  if (decision.kind === 'unavailable') return { allowedProviders: [] };
  return { allowedProviders: decision.allowedProviders };
}

/**
 * Cache-key suffix for LLM-backed responses. Unrestricted callers keep the
 * existing shared keys (empty suffix); restricted callers get their own
 * namespace so they are never served text another provider wrote.
 */
export function aiRoutingCacheSuffix(decision: AiRoutingDecision): string {
  if (decision.kind === 'default') return '';
  if (decision.kind === 'unavailable') return ':ai=none';
  return `:ai=${decision.allowedProviders.join('+')}`;
}

/** True when the caller may use features that only exist on the default chain (e.g. OpenRouter embeddings). */
export function allowsProvider(decision: AiRoutingDecision, provider: string): boolean {
  if (decision.kind === 'default') return true;
  if (decision.kind === 'unavailable') return false;
  return decision.allowedProviders.includes(provider);
}
