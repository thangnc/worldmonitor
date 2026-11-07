/**
 * Routing rules for the World Monitor Lite UI (`/lite`, docs/architecture/lite.md).
 *
 * Pure functions so node:test can cover them without a browser. The flag itself
 * lives in `lite-profile.ts`; callers pass it in.
 */

/** The three Lite screens. `/lite` itself is Geopolitics. */
export type LiteScreen = 'geopolitics' | 'finance' | 'tech';

export const LITE_BASE_PATH = '/lite';

export const LITE_SCREEN_PATHS: Readonly<Record<LiteScreen, string>> = {
  geopolitics: '/lite',
  finance: '/lite/finance',
  tech: '/lite/tech',
};

/** `/dashboard?full=1` opens the full dashboard while the profile is on. */
export const LITE_FULL_DASHBOARD_PARAM = 'full';
export const LITE_FULL_DASHBOARD_SESSION_KEY = 'wm-lite-full';

/**
 * Query keys that carry dashboard state. A link that has one is a shared map
 * view or a deep link, so it must open the dashboard, not the Lite UI. The
 * first nine match `LEGACY_DASHBOARD_ROOT_QUERY_KEYS` in middleware.ts.
 */
export const LITE_DASHBOARD_STATE_KEYS = [
  'lat', 'lon', 'zoom', 'view', 'timeRange', 'layers', 'c', 'country', 'chokepoint',
  'expanded', 'settings', 'live-channels', 'preset', 'mission',
] as const;

/** Maps a pathname to a Lite screen. Unknown subpaths fall back to Geopolitics. */
export function parseLiteScreen(pathname: string): LiteScreen {
  const rest = pathname.replace(/\/+$/, '').slice(LITE_BASE_PATH.length).replace(/^\/+/, '');
  if (rest === 'finance') return 'finance';
  if (rest === 'tech') return 'tech';
  return 'geopolitics';
}

/**
 * Whether a dashboard page load should be sent to `/lite` instead.
 * True only when the profile is on, the path is `/` or `/dashboard`, the URL
 * carries no dashboard state, and the person has not asked for the full
 * dashboard in this tab (`?full=1`, remembered for the session).
 */
export function shouldRedirectToLite(
  pathname: string,
  search: string,
  options: { enabled: boolean; fullDashboardInSession: boolean },
): boolean {
  if (!options.enabled || options.fullDashboardInSession) return false;
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path !== '/' && path !== '/dashboard') return false;
  const params = new URLSearchParams(search);
  if (params.get(LITE_FULL_DASHBOARD_PARAM) === '1') return false;
  return !LITE_DASHBOARD_STATE_KEYS.some((key) => params.has(key));
}
