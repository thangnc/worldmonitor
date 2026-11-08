import './lite.css';
import { render } from 'preact';
import { installWebApiRedirect } from '@/services/runtime';
import { ensureWmSession, installWmSessionFetchInterceptor } from '@/services/wm-session';
import { App, LITE_ENABLED, ProfileOff } from './App';
import { startBootstrap } from './data/sources';
import { initPageScroll } from './components/scroll';

const root = document.getElementById('lite-root');

if (root && !LITE_ENABLED) {
  render(<ProfileOff />, root);
} else if (root) {
  // Same fetch setup as the dashboard entry (src/main.ts, App.ts), without App:
  // API redirect, then the anonymous wm-session most RPCs require.
  installWebApiRedirect();
  installWmSessionFetchInterceptor();
  void ensureWmSession();
  void startBootstrap();
  initPageScroll();
  render(<App />, root);
}
