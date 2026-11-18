/**
 * Routing rules for the World Monitor Lite UI (`/lite`, docs/engineering/architecture/lite.md).
 *
 * Pure functions so node:test can cover them without a browser. `/` and
 * `/dashboard` always redirect here; vercel.json, docker/nginx.conf*, and the
 * dev server (apps/web/vite.dev-api.ts) own that redirect.
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

/** Maps a pathname to a Lite screen. Unknown subpaths fall back to the Briefing. */
export function parseLiteScreen(pathname: string): LiteScreen {
  const rest = pathname.replace(/\/+$/, '').slice(LITE_BASE_PATH.length).replace(/^\/+/, '');
  if (rest === 'geopolitics' || rest === 'finance' || rest === 'tech' || rest === 'sources') return rest;
  return 'briefing';
}
