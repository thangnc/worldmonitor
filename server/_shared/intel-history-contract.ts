/**
 * Runtime request contract for the intelligence-history RPCs. buf.validate
 * annotations describe the public surface; handlers enforce the same rules.
 */

import { ValidationError } from '../../packages/contracts/generated/server/worldmonitor/intelligence/v1/service_server';

const HISTORY_DOMAINS = new Set(['conflict', 'military', 'energy']);

export interface ValidatedHistoryScope {
  domain: string;
  country: string;
  from: number;
  to: number;
  limit: number;
}

function invalid(field: string, description: string): never {
  throw new ValidationError([{ field, description }]);
}

function integer(value: unknown, name: string, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) {
    invalid(name, `${name} must be an integer between 0 and ${max}`);
  }
  return value;
}

/** Validate and normalize the scope and numeric fields shared by all reads. */
export function validateHistoryScope(
  req: { domain?: unknown; country?: unknown; from?: unknown; to?: unknown; limit?: unknown },
  maxLimit: number,
): ValidatedHistoryScope {
  const domain = typeof req.domain === 'string' ? req.domain.trim().toLowerCase() : '';
  const country = typeof req.country === 'string' ? req.country.trim().toUpperCase() : '';
  if (domain && !HISTORY_DOMAINS.has(domain)) {
    invalid('domain', 'domain must be one of conflict, military, or energy');
  }
  if (country && !/^[A-Z]{2}$/.test(country)) {
    invalid('country', 'country must be an ISO 3166-1 alpha-2 code');
  }
  const from = integer(req.from ?? 0, 'from', Number.MAX_SAFE_INTEGER);
  const to = integer(req.to ?? 0, 'to', Number.MAX_SAFE_INTEGER);
  const limit = integer(req.limit ?? 0, 'limit', maxLimit);
  if (from && to && from > to) invalid('from', 'from must be less than or equal to to');
  return { domain, country, from, to, limit };
}

/** Validate required semantic text without silently truncating paid input. */
export function validateHistoryText(value: unknown, name: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    invalid(name, `${name} must be between ${min} and ${max} characters`);
  }
  return value;
}
