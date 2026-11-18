import { isSessionTokenShape, validateSessionToken } from './_session.js';
import { getOperatorKeys, timingSafeIncludes } from './_crypto.js';

export function getHeaderApiKey(req) {
  return req.headers.get('X-WorldMonitor-Key') || req.headers.get('X-Api-Key') || '';
}

async function isValidEnterpriseKey(key) {
  if (!key) return false;
  const validKeys = getOperatorKeys();
  return timingSafeIncludes(key, validKeys);
}

async function validateCredential(key, forceKey) {
  if (isSessionTokenShape(key)) {
    // Anonymous session tokens are NOT proof of any specific identity —
    // anyone can mint one via POST /api/wm-session. Reject when the caller
    // demands an operator key (premium endpoints set forceKey=true).
    if (forceKey) {
      return { valid: false, required: true, error: 'Pro authentication required' };
    }
    if (await validateSessionToken(key)) {
      return { valid: true, required: false, kind: 'session' };
    }
    return { valid: false, required: true, error: 'Invalid session token' };
  }

  // Enterprise key (WORLDMONITOR_VALID_KEYS). An operator-issued key may start
  // with wm_; any other key, including a former wm_ user API key, is invalid.
  // `credential` records the authority that actually won; downstream
  // identity/rate-limit code must not infer it again from headers.
  if (key && await isValidEnterpriseKey(key)) {
    return { valid: true, required: true, kind: 'enterprise', credential: key };
  }

  if (key) {
    return { valid: false, required: true, error: 'Invalid API key' };
  }

  return { valid: false, required: true, error: 'API key required' };
}

// A browser holding both a host-only and a Domain cookie of one name sends
// both. Cap the candidates so a padded Cookie header cannot multiply the
// validation work done before any rate limiter runs.
const MAX_COOKIE_CANDIDATES = 4;

// The first MAX_COOKIE_CANDIDATES nonempty values sent for `name`, in browser order.
function getCookies(req, name) {
  const raw = req.headers.get('Cookie') || req.headers.get('cookie') || '';
  if (!raw) return [];
  const prefix = `${name}=`;
  const values = [];
  for (const part of raw.split(';')) {
    if (values.length >= MAX_COOKIE_CANDIDATES) break;
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    let value;
    try {
      value = decodeURIComponent(trimmed.slice(prefix.length));
    } catch {
      value = trimmed.slice(prefix.length);
    }
    if (value) values.push(value);
  }
  return values;
}

function getCookie(req, name) {
  return getCookies(req, name)[0] || '';
}

// First wm-session value that validates; otherwise the first value's result,
// so the error still names the credential the browser led with.
async function validateSessionCookies(sessionCookies, forceKey) {
  let firstResult = null;
  for (const cookie of sessionCookies) {
    const result = await validateCredential(cookie, forceKey);
    if (result.valid) return result;
    firstResult ??= result;
  }
  return firstResult;
}

// Note: HTTP headers like Origin / Referer / Sec-Fetch-Site are entirely
// client-controlled at the wire level (see issue #3541 / closed PR #3554).
// Trusting any of them as a "this is a real browser" signal is forgeable by
// curl in one line. The previous Referer-origin fallback and Origin-pattern
// no-key trust path are both gone. Browsers now authenticate via:
//   1. A short-lived wms_-prefixed session token (HMAC-signed by /api/wm-session).
//      Kind: 'session'. Anonymous; satisfies the basic gate. A session token is
//      freely mintable by anyone who can hit /api/wm-session, so it is
//      rejected when forceKey=true (premium routes).
//   2. An enterprise key (WORLDMONITOR_VALID_KEYS), as a header or the
//      HttpOnly tester cookie. Kind: 'enterprise'. The only kind premium
//      routes accept.
//
// Async because session validation uses Web Crypto (crypto.subtle.sign).
// All call sites await this — see grep for migration history.
export async function validateApiKey(req, options = {}) {
  const forceKey = options.forceKey === true;
  const headerKey = getHeaderApiKey(req);
  const sessionCookies = getCookies(req, 'wm-session');
  const testerCookies = [getCookie(req, '__Host-wm-pro-key'), getCookie(req, '__Host-wm-widget-key')].filter(Boolean);

  // Explicit non-session headers remain authoritative. They are machine/API
  // credentials and must never silently fall back to ambient browser cookies.
  if (headerKey && !isSessionTokenShape(headerKey)) {
    return validateCredential(headerKey, forceKey);
  }

  // Returning tester/widget users mint an anonymous wms_ token in a new tab,
  // while their real tester credential is HttpOnly. Prefer that cookie only
  // after it validates. A rotated cookie must not permanently shadow the fresh
  // anonymous header/cookie on non-forceKey routes.
  for (const testerCookie of testerCookies) {
    if (await isValidEnterpriseKey(testerCookie)) {
      return { valid: true, required: true, kind: 'enterprise', credential: testerCookie };
    }
  }

  if (headerKey) return validateCredential(headerKey, forceKey);
  if (sessionCookies.length) return validateSessionCookies(sessionCookies, forceKey);

  // Preserve the useful invalid-key error when the only credential is a stale
  // tester cookie. The fallback above applies only when valid anonymous
  // authority is also present.
  if (testerCookies.length) return { valid: false, required: true, error: 'Invalid API key' };

  return { valid: false, required: true, error: 'API key required' };
}
