/**
 * Routing rules for the World Monitor Lite UI (`/lite`, docs/engineering/architecture/lite.md).
 *
 * Pure functions so node:test can cover them without a browser. The flag itself
 * lives in `lite-profile.ts`; callers pass it in.
 */

/**
 * The Lite screens. `/lite` is the cross-domain Briefing (home); the three
 * domain screens are its children. Sources is the read-only ingestion screen.
 */
export type LiteScreen = 'briefing' | 'geopolitics' | 'finance' | 'tech' | 'sources';

/** The domain screens the Briefing links to. */
export type LiteDomainScreen = Exclude<LiteScreen, 'briefing' | 'sources'>;

export const LITE_BASE_PATH = '/lite';

export const LITE_SCREEN_PATHS: Readonly<Record<LiteScreen, string>> = {
  briefing: '/lite',
  geopolitics: '/lite/geopolitics',
  finance: '/lite/finance',
  tech: '/lite/tech',
  sources: '/lite/sources',
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

/** Maps a pathname to a Lite screen. Unknown subpaths fall back to the Briefing. */
export function parseLiteScreen(pathname: string): LiteScreen {
  const rest = pathname.replace(/\/+$/, '').slice(LITE_BASE_PATH.length).replace(/^\/+/, '');
  if (rest === 'geopolitics' || rest === 'finance' || rest === 'tech' || rest === 'sources') return rest;
  return 'briefing';
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
