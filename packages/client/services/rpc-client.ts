import { getConfiguredWebApiBaseUrl } from './runtime';

export function getRpcBaseUrl(): string {
  return getConfiguredWebApiBaseUrl() || '';
}

export function rpcFetch(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
  return globalThis.fetch(...args);
}

export function createLazyClient<T>(factory: () => T): () => T {
  let client: T | undefined;
  return () => {
    client ??= factory();
    return client;
  };
}

export function getRpcErrorStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}
