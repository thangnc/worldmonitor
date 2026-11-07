import { useEffect, useState } from 'preact/hooks';

/**
 * A tiny keyed resource store for the Lite UI. One loader per data source, one
 * shared result per key across all three screens, refreshed every 5 minutes.
 *
 * A loader that fails reports `error`. One that succeeds with nothing to show
 * reports `empty`. Widgets render those as their own states and never swap in
 * sample data (browser rule: no confident empty state on a failed read).
 */
export type ResourceState<T> =
  | { status: 'loading'; data: null; at: 0 }
  | { status: 'ready'; data: T; at: number }
  | { status: 'empty'; data: null; at: number }
  | { status: 'error'; data: null; at: number; error: string };

export const REFRESH_MS = 5 * 60_000;

interface Entry<T> {
  state: ResourceState<T>;
  loader: () => Promise<T | null>;
  inflight: Promise<void> | null;
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry<unknown>>();
const LOADING: ResourceState<never> = { status: 'loading', data: null, at: 0 };

function entryFor<T>(key: string, loader: () => Promise<T | null>): Entry<T> {
  let entry = entries.get(key) as Entry<T> | undefined;
  if (!entry) {
    entry = { state: LOADING, loader, inflight: null, listeners: new Set() };
    entries.set(key, entry as Entry<unknown>);
  }
  return entry;
}

function run<T>(entry: Entry<T>): Promise<void> {
  if (entry.inflight) return entry.inflight;
  entry.inflight = entry
    .loader()
    .then((data) => {
      const empty = data == null || (Array.isArray(data) && data.length === 0);
      entry.state = empty ? { status: 'empty', data: null, at: Date.now() } : { status: 'ready', data: data as T, at: Date.now() };
    })
    .catch((error: unknown) => {
      // Keep the last good data on a failed refresh; only a first load shows the error.
      if (entry.state.status !== 'ready') {
        entry.state = { status: 'error', data: null, at: Date.now(), error: error instanceof Error ? error.message : String(error) };
      }
    })
    .finally(() => {
      entry.inflight = null;
      for (const listener of entry.listeners) listener();
    });
  return entry.inflight;
}

/** Subscribes a component to a keyed loader. The first subscriber starts the load. */
export function useResource<T>(key: string, loader: () => Promise<T | null>): ResourceState<T> {
  const entry = entryFor(key, loader);
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    entry.listeners.add(listener);
    if (entry.state.status === 'loading' && !entry.inflight) void run(entry);
    return () => {
      entry.listeners.delete(listener);
    };
  }, [entry]);
  return entry.state;
}

/** Re-runs every loader that has been used. Called by the 5-minute timer. */
export async function refreshAll(): Promise<void> {
  await Promise.all([...entries.values()].map((entry) => run(entry)));
}

/** Test hook: forget every cached result. */
export function resetResourcesForTests(): void {
  entries.clear();
}
