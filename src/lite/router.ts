import { useEffect, useState } from 'preact/hooks';
import { LITE_SCREEN_PATHS, parseLiteScreen, type LiteScreen } from '@/config/lite-route';

// A three-route history router. The screens share one data store, so moving
// between them is a re-render, not a page load.
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') window.addEventListener('popstate', notify);

export function navigate(screen: LiteScreen): void {
  const path = LITE_SCREEN_PATHS[screen];
  if (location.pathname !== path) history.pushState(null, '', path);
  notify();
  window.scrollTo(0, 0);
}

export function useRoute(): LiteScreen {
  const [screen, setScreen] = useState<LiteScreen>(() => parseLiteScreen(location.pathname));
  useEffect(() => {
    const update = () => setScreen(parseLiteScreen(location.pathname));
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return screen;
}
