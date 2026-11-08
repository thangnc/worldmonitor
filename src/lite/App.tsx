import { useEffect } from 'preact/hooks';
import { LITE_PROFILE_ENABLED } from '@/config/lite-profile';
import { useRoute } from './router';
import { Sidebar } from './components/Sidebar';
import { Briefing } from './screens/Briefing';
import { Geopolitics } from './screens/Geopolitics';
import { Finance } from './screens/Finance';
import { Tech } from './screens/Tech';
import { Sources } from './screens/Sources';
import { REFRESH_MS, refreshAll } from './data/store';

const TITLES = {
  briefing: 'Briefing',
  geopolitics: 'Geopolitics & Conflicts',
  finance: 'Finance & Crypto',
  tech: 'Technology & AI',
  sources: 'Sources & ingestion',
} as const;

export function App() {
  const screen = useRoute();

  useEffect(() => {
    document.title = `${TITLES[screen]} · World Monitor Lite`;
  }, [screen]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshAll();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div class="flex min-h-screen flex-col bg-bg font-sans text-ink wide:flex-row" data-lite-screen={screen}>
      <div class="shrink-0 border-b border-line bg-surface wide:w-[232px] wide:border-b-0 wide:border-r">
        <Sidebar screen={screen} />
      </div>
      <main class="min-w-0 flex-1">
        {screen === 'geopolitics' ? <Geopolitics /> : screen === 'finance' ? <Finance /> : screen === 'tech' ? <Tech /> : screen === 'sources' ? <Sources /> : <Briefing />}
      </main>
    </div>
  );
}

/** What `/lite` renders when the deployment profile is off (upstream builds). */
export function ProfileOff() {
  return (
    <main class="flex min-h-screen items-center justify-center bg-bg p-6 font-sans text-ink" data-lite-off="true">
      <p class="text-[14px] text-muted">
        The World Monitor Lite profile is off for this deployment.{' '}
        <a class="text-ink underline" href="/dashboard">
          Open the dashboard
        </a>
        .
      </p>
    </main>
  );
}

export const LITE_ENABLED = LITE_PROFILE_ENABLED;
