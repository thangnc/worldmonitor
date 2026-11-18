import './lite.css';
import { render } from 'preact';
import { installWebApiRedirect } from '@wm/client/services/runtime';
import { ensureWmSession, installWmSessionFetchInterceptor } from '@wm/client/services/wm-session';
import { App } from './App';
import { startBootstrap } from './data/sources';
import { initPageScroll } from './components/scroll';

const root = document.getElementById('lite-root');

if (root) {
  // API redirect, then the anonymous wm-session most RPCs require.
  installWebApiRedirect();
  installWmSessionFetchInterceptor();
  void ensureWmSession();
  void startBootstrap();
  initPageScroll();
  render(<App />, root);
}
