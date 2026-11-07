/** Number formatting for the Lite UI. U+2212 minus, as in the design. */
export const MINUS = '−';

export function signed(value: number, digits = 1, suffix = '%'): string {
  const abs = Math.abs(value).toFixed(digits);
  return `${value < 0 ? MINUS : '+'}${abs}${suffix}`;
}

export function price(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const digits = value >= 1000 ? 0 : value >= 100 ? 1 : 2;
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** $38.4B, $612M, −$214M */
export function usdCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function utcClock(ts: number | string | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '—' : `${d.toISOString().slice(11, 19)} UTC`;
}
