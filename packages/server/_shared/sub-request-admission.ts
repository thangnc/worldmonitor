import { runRedisPipeline } from './redis.js';
import { sha256Hex } from './hash';

export const SUB_REQUEST_MARKER_HEADER = 'x-wm-sub-request';
const ADMISSION_TTL_SECONDS = 30;
const ADMISSION_PREFIX = 'sub-request-admission:v1:';

export type SubRequestAdmissionResult = 'admitted' | 'invalid' | 'unavailable';

export { sha256Hex };

// Sorted, percent-encoded query string, so a reordered query at any hop
// (CDN, proxy, browser) yields the same digest.
function canonicalQueryString(url: URL): string {
  const entries = [...url.searchParams];
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/** Canonical query after the gateway router adds its exact rpc path echo. */
export function canonicalGatewayQueryString(input: URL): string {
  const url = new URL(input);
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const lastSegment = pathSegments[pathSegments.length - 1] ?? '';
  const rpcParams = url.searchParams.getAll('rpc');
  if (rpcParams.some((value) => value === lastSegment)) {
    url.searchParams.delete('rpc');
    for (const value of rpcParams) {
      if (value !== lastSegment) url.searchParams.append('rpc', value);
    }
  }
  return canonicalQueryString(url);
}

// Bind admission to GET and credentials. Store only digests: credentials and
// trusted principal identifiers must never enter the Redis value or key.
async function requestDigest(request: Request): Promise<string> {
  const url = new URL(request.url);
  return sha256Hex(JSON.stringify([
    request.method,
    url.origin,
    url.pathname,
    canonicalGatewayQueryString(url),
    request.headers.get('authorization'),
    request.headers.get('x-worldmonitor-key'),
    request.headers.get('x-api-key'),
  ]));
}

/** Issue only after the caller has paid the endpoint/global admission. */
export async function issueSubRequestAdmission(request: Request, principal: string | null = null): Promise<string | null> {
  if (request.method !== 'GET') return null;
  const token = crypto.randomUUID();
  const value = JSON.stringify({
    request: await requestDigest(request),
    principal: principal ? await sha256Hex(principal) : null,
  });
  const [stored] = await runRedisPipeline([
    ['SET', `${ADMISSION_PREFIX}${token}`, value, 'EX', ADMISSION_TTL_SECONDS, 'NX'],
  ], true);
  return stored?.result === 'OK' && !stored.error ? token : null;
}

/** GETDEL makes concurrent replays fail. Invalid proofs never waive a limit. */
export async function consumeSubRequestAdmission(
  request: Request,
  principal: string | null = null,
): Promise<SubRequestAdmissionResult> {
  const token = request.headers.get(SUB_REQUEST_MARKER_HEADER);
  if (request.method !== 'GET' || !token || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)) return 'invalid';
  const results = await runRedisPipeline([['GETDEL', `${ADMISSION_PREFIX}${token}`]], true);
  if (results.length === 0 || results[0]?.error) return 'unavailable';
  const stored = results[0]?.result;
  if (typeof stored !== 'string') return 'invalid';

  let value: { request?: unknown; principal?: unknown };
  try {
    value = JSON.parse(stored) as { request?: unknown; principal?: unknown };
  } catch {
    return 'invalid';
  }
  if (value.request !== await requestDigest(request)) return 'invalid';
  if (value.principal !== null && typeof value.principal !== 'string') return 'invalid';
  if (principal && value.principal !== await sha256Hex(principal)) return 'invalid';
  return 'admitted';
}
