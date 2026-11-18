import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clearPanelColSpan,
  invalidatePanelStorageCacheForKeys,
  loadPanelColSpans,
  loadPanelSpans,
  savePanelCollapsed,
  PANEL_COL_SPANS_KEY,
  PANEL_COLLAPSED_KEY,
  PANEL_SPANS_KEY,
} from '../packages/client/utils/panel-storage';

function invalidateAllPanelStorageCaches(): void {
  invalidatePanelStorageCacheForKeys([PANEL_SPANS_KEY, PANEL_COL_SPANS_KEY, PANEL_COLLAPSED_KEY]);
}

/** Installs a Map-backed global localStorage for the callback and restores the original afterwards. */
async function withStorage<T>(callback: (harness: { localStorage: Storage }) => T | Promise<T>): Promise<T> {
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  const localStorage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, String(value));
    },
    removeItem(key: string) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    get length() {
      return values.size;
    },
  } as Storage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: localStorage });
  try {
    return await callback({ localStorage });
  } finally {
    if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    invalidateAllPanelStorageCaches();
  }
}

describe('Panel storage cache', () => {
  it('invalidates warmed maps when another tab changes panel storage', () => {
    invalidateAllPanelStorageCaches();
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const values = new Map<string, string>();
    let storageListener: ((event: Event & { key: string | null }) => void) | null = null;

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: {
        addEventListener(type: string, listener: EventListener) {
          if (type === 'storage') {
            storageListener = listener as (event: Event & { key: string | null }) => void;
          }
        },
      },
    });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem(key: string) {
          return values.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          values.set(key, String(value));
        },
        removeItem(key: string) {
          values.delete(key);
        },
      },
    });

    try {
      values.set(PANEL_SPANS_KEY, JSON.stringify({ crossTab: 1 }));
      assert.equal(loadPanelSpans().crossTab, 1);
      assert.ok(storageListener, 'panel storage installs a storage-event invalidation listener');

      values.set(PANEL_SPANS_KEY, JSON.stringify({ crossTab: 3 }));
      assert.equal(loadPanelSpans().crossTab, 1, 'cache remains warm before the cross-tab event');

      const event = new Event('storage') as Event & { key: string | null };
      Object.defineProperty(event, 'key', { value: PANEL_SPANS_KEY });
      storageListener(event);

      assert.equal(loadPanelSpans().crossTab, 3, 'storage event invalidates the warmed map');
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
      else delete (globalThis as { window?: unknown }).window;
      if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('returns frozen cached maps so callers cannot mutate tab-wide storage state', async () => {
    await withStorage((harness) => {
      invalidateAllPanelStorageCaches();
      harness.localStorage.setItem(PANEL_SPANS_KEY, JSON.stringify({ immutable: 2 }));

      const spans = loadPanelSpans();
      assert.equal(Object.isFrozen(spans), true);
      assert.throws(() => {
        (spans as Record<string, number>).poisoned = 5;
      }, TypeError);

      assert.equal(loadPanelSpans().poisoned, undefined);
      assert.equal(loadPanelSpans().immutable, 2);
    });
  });

  it('keeps column-span removeWhenEmpty default when options object is empty', async () => {
    await withStorage((harness) => {
      invalidateAllPanelStorageCaches();
      harness.localStorage.setItem(PANEL_COL_SPANS_KEY, JSON.stringify({ compact: 2 }));

      assert.equal(loadPanelColSpans().compact, 2);
      clearPanelColSpan('compact', {});

      assert.equal(harness.localStorage.getItem(PANEL_COL_SPANS_KEY), null);
      assert.equal(Object.keys(loadPanelColSpans()).length, 0);
    });
  });

  it('invalidates cached panel maps after direct storage replacement', async () => {
    await withStorage((harness) => {
      invalidateAllPanelStorageCaches();
      harness.localStorage.setItem(PANEL_SPANS_KEY, JSON.stringify({ imported: 1 }));
      assert.equal(loadPanelSpans().imported, 1);

      harness.localStorage.setItem(PANEL_SPANS_KEY, JSON.stringify({ imported: 3 }));
      assert.equal(loadPanelSpans().imported, 1, 'cache stays warm until the writer reports replacement');

      invalidatePanelStorageCacheForKeys([PANEL_SPANS_KEY]);
      assert.equal(loadPanelSpans().imported, 3);
    });
  });

  it('returns persisted: false when collapsed storage writes throw', async () => {
    await withStorage((harness) => {
      invalidateAllPanelStorageCaches();
      const originalSetItem = harness.localStorage.setItem.bind(harness.localStorage);
      harness.localStorage.setItem = ((key: string, value: string) => {
        if (key === PANEL_COLLAPSED_KEY) {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        }
        originalSetItem(key, value);
      }) as Storage['setItem'];

      assert.equal(savePanelCollapsed('live-news', true), false);
      assert.equal(harness.localStorage.getItem(PANEL_COLLAPSED_KEY), null);
    });
  });
});
