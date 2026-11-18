const access = new WeakMap<Request, number>();

/** History window an anonymous caller may read. */
export const FREE_COUNTRY_HISTORY_DAYS = 7;
/** History window an operator key may read. */
export const OPERATOR_COUNTRY_HISTORY_DAYS = 365;

// Only the gateway binds this after authentication. Client headers cannot
// create a WeakMap entry, and a direct/local handler read defaults to free.
export function bindCountryHistoryAccess(request: Request, days: number): void {
  access.set(request, days);
}

export function getCountryHistoryAccess(request: Request): number {
  return access.get(request) ?? FREE_COUNTRY_HISTORY_DAYS;
}
