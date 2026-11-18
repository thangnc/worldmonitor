// @ts-expect-error — JS module, no declaration file
import { validateApiKey } from '../../../api/_api-key.js';
import { OPERATOR_KEY_DAILY_CEILINGS, operatorKeyQuotaPrincipal } from './high-usage-alarm.js';
import { hashKeySync } from './usage-identity.js';

/**
 * Premium access has one rule: the caller presents an operator key
 * (`WORLDMONITOR_VALID_KEYS`, which `validateApiKey` labels `enterprise`),
 * either as `X-WorldMonitor-Key` / `X-Api-Key` or as the HttpOnly
 * `__Host-wm-pro-key` tester cookie. An anonymous `wms_` session is never
 * premium. The gateway applies the same rule to `PREMIUM_RPC_PATHS`; handlers
 * use this module for premium-only fields on routes that are not gated.
 */
export type PremiumCallerIdentity =
  | {
      isPremium: true;
      userId: null;
      kind: 'enterprise';
      quotaExempt: false;
      /**
       * Operator keys carry no account, so their direct-LLM spend is metered
       * per key under this principal (`operatorKeyQuotaPrincipal`), never the
       * raw key, against a circuit-breaker ceiling.
       */
      quotaUserId: string;
      /** Principal for logs and alarms: the gateway's `hashKeySync` of the key. */
      alarmPrincipal: string;
      directLlmDailyLimit: number;
    }
  | {
      isPremium: false;
      userId: null;
      kind: null;
      quotaExempt: false;
    };

type DeniedIdentity = Extract<PremiumCallerIdentity, { isPremium: false }>;

const DENIED: DeniedIdentity = Object.freeze({
  isPremium: false,
  userId: null,
  kind: null,
  quotaExempt: false,
});

async function operatorKeyIdentity(key: string): Promise<PremiumCallerIdentity> {
  return {
    isPremium: true,
    userId: null,
    kind: 'enterprise',
    quotaExempt: false,
    quotaUserId: await operatorKeyQuotaPrincipal(key),
    alarmPrincipal: hashKeySync(key),
    directLlmDailyLimit: OPERATOR_KEY_DAILY_CEILINGS.directLlmCalls,
  };
}

type RpcApiErrorLike = Error & { statusCode: number; body: string };

type RpcApiErrorConstructor<T extends RpcApiErrorLike> =
  new (statusCode: number, message: string, body: string) => T;

/** Resolves premium status for spend controls and premium-only fields. */
export async function resolvePremiumCallerIdentity(request: Request): Promise<PremiumCallerIdentity> {
  // forceKey rejects anonymous `wms_` sessions, so a valid result is always
  // an operator key and names the credential that won.
  const keyCheck = (await validateApiKey(request, { forceKey: true })) as {
    valid: boolean;
    kind?: string;
    credential?: string;
  };
  if (keyCheck.valid && keyCheck.kind === 'enterprise' && keyCheck.credential) {
    return operatorKeyIdentity(keyCheck.credential);
  }
  return DENIED;
}

/**
 * Enforces a hard-denying premium RPC gate. The generated constructor keeps
 * `instanceof ApiError` service-local; the message keeps each endpoint's copy.
 */
export async function requirePremiumRpcAccess<T extends RpcApiErrorLike>(
  request: Request,
  ApiErrorConstructor: RpcApiErrorConstructor<T>,
  fallbackMessage: string,
): Promise<Extract<PremiumCallerIdentity, { isPremium: true }>> {
  const identity = await resolvePremiumCallerIdentity(request);
  if (identity.isPremium) return identity;
  throw new ApiErrorConstructor(403, fallbackMessage, '');
}

/** True when the caller presented a valid operator key. */
export async function isCallerPremium(request: Request): Promise<boolean> {
  return (await resolvePremiumCallerIdentity(request)).isPremium;
}
