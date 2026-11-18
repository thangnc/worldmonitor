import { getKeyPrefix } from './redis.js';

export const DIRECT_LLM_DAILY_QUOTA_LIMIT = 500;
export const DIRECT_LLM_REDIS_UNAVAILABLE_RETRY_AFTER_SECONDS = 30;

/**
 * Daily direct-LLM allowance for a caller with no operator key: today only the
 * Docker self-host country brief, metered per client IP.
 */
export const DIRECT_LLM_UNVERIFIED_DAILY_QUOTA_LIMIT = 50;

// One copy of the daily-meter clock: the operator-key meter's TTL (48 h covers
// the UTC-midnight rollover) and its Retry-After helper.
import {
  API_DAILY_TTL_SECONDS as PRO_DAILY_QUOTA_TTL_SECONDS,
  secondsUntilUtcMidnight,
} from './api-key-rate-limit';

export { PRO_DAILY_QUOTA_TTL_SECONDS, secondsUntilUtcMidnight };

/**
 * Resolve a daily limit: `null` is unlimited, a non-negative number is that
 * limit, anything else falls back to the default.
 */
export function resolveDirectLlmDailyLimit(planDailyLimit?: number | null): number | null {
  if (planDailyLimit === null) return null;
  if (typeof planDailyLimit === 'number' && Number.isFinite(planDailyLimit) && planDailyLimit >= 0) {
    return planDailyLimit;
  }
  return DIRECT_LLM_DAILY_QUOTA_LIMIT;
}

export const DIRECT_LLM_GATEWAY_QUOTA_PATHS = new Set<string>([
  '/api/intelligence/v1/classify-event',
  '/api/intelligence/v1/deduct-situation',
  '/api/intelligence/v1/get-country-intel-brief',
  '/api/market/v1/analyze-stock',
  '/api/news/v1/summarize-article',
]);

// The self-metered handlers (chat-analyst, widget-agent) were removed in
// refactor Phase 1c; the set stays so a future self-metered route has a home.
export const DIRECT_LLM_SELF_METERED_QUOTA_PATHS = new Set<string>([]);

export const DIRECT_LLM_QUOTA_PATHS = new Set<string>([
  ...DIRECT_LLM_GATEWAY_QUOTA_PATHS,
  ...DIRECT_LLM_SELF_METERED_QUOTA_PATHS,
]);

export type DirectLlmQuotaReservation =
  | { ok: true; newCount: number; rollback: () => Promise<void> }
  | {
      ok: false;
      reason: 'cap-exceeded' | 'redis-unavailable';
      floor?: number;
      retryAfterSec: number;
    };

export type DirectLlmQuotaPipeline = (
  commands: Array<Array<string | number>>,
) => Promise<Array<{ result?: unknown }>>;

export function directLlmDailyQuotaKey(userId: string, date?: Date): string {
  if (!userId) return '';
  const d = date ?? new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${getKeyPrefix()}llm:direct-usage:${userId}:${yyyy}-${mm}-${dd}`;
}

export async function reserveDirectLlmQuota(opts: {
  userId: string;
  pipeline: DirectLlmQuotaPipeline;
  limit?: number | null;
  date?: Date;
}): Promise<DirectLlmQuotaReservation> {
  const limit = resolveDirectLlmDailyLimit(opts.limit);
  const retryAfterSec = secondsUntilUtcMidnight(opts.date);
  const key = directLlmDailyQuotaKey(opts.userId, opts.date);
  if (!key) {
    return {
      ok: false,
      reason: 'redis-unavailable',
      retryAfterSec: DIRECT_LLM_REDIS_UNAVAILABLE_RETRY_AFTER_SECONDS,
    };
  }

  let pipeResult: Array<{ result?: unknown }> | null;
  try {
    pipeResult = await opts.pipeline([
      ['INCR', key],
      ['EXPIRE', key, PRO_DAILY_QUOTA_TTL_SECONDS],
    ]);
  } catch {
    pipeResult = null;
  }

  if (!pipeResult || !Array.isArray(pipeResult) || pipeResult.length === 0) {
    return {
      ok: false,
      reason: 'redis-unavailable',
      retryAfterSec: DIRECT_LLM_REDIS_UNAVAILABLE_RETRY_AFTER_SECONDS,
    };
  }

  const incrRaw = pipeResult[0]?.result;
  const newCount = typeof incrRaw === 'number' ? incrRaw : Number(incrRaw);
  if (!Number.isFinite(newCount) || newCount < 1) {
    return {
      ok: false,
      reason: 'redis-unavailable',
      retryAfterSec: DIRECT_LLM_REDIS_UNAVAILABLE_RETRY_AFTER_SECONDS,
    };
  }

  let rolledBack = false;
  const rollback = async (): Promise<void> => {
    if (rolledBack) return;
    rolledBack = true;
    try {
      await opts.pipeline([['DECR', key]]);
    } catch {
      // Best-effort: over-counting by one is the cost-protection-correct direction.
    }
  };

  if (limit !== null && newCount > limit) {
    await rollback();
    return {
      ok: false,
      reason: 'cap-exceeded',
      floor: limit,
      retryAfterSec,
    };
  }

  return { ok: true, newCount, rollback };
}
