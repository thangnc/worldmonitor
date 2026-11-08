/**
 * Sample data copied from the owner's design exports (design/, not committed).
 * Every widget that renders these shows a "Sample" badge. Widgets backed by a
 * real source never fall back to them: an empty real source says so instead.
 */

export interface SampleModelRow {
  name: string;
  org: string;
  isNew?: boolean;
  released: string;
  access: string;
  claimed: string;
  evalLabel: string;
  evalTone: 'high' | 'elev' | 'ok' | 'muted';
}

export const SAMPLE_MODELS: SampleModelRow[] = [
  { name: 'Qorra-2.5 72B', org: 'Qorra Labs', isNew: true, released: '7 Nov', access: 'Open weights', claimed: 'Frontier coding', evalLabel: 'Pending', evalTone: 'high' },
  { name: 'Meridian 4', org: 'Northwind AI', released: '3 Nov', access: 'API · GA', claimed: '2M-token reasoning', evalLabel: 'Partial (2/3)', evalTone: 'elev' },
  { name: 'Atlas Code 3', org: 'Helio', released: '28 Oct', access: 'API · beta', claimed: 'Agentic SWE tasks', evalLabel: 'Replicated', evalTone: 'ok' },
  { name: 'Sable Vision 1.2', org: 'Sable', released: '21 Oct', access: 'Open weights', claimed: 'Document parsing', evalLabel: 'Mixed', evalTone: 'muted' },
];

export interface SampleKpi {
  key: string;
  value: string;
  delta: string;
  tone: 'ok' | 'muted';
}

export const SAMPLE_INFRA_KPIS: SampleKpi[] = [
  { key: 'AI capex', value: '$41B', delta: '+18% m/m', tone: 'ok' },
  { key: 'GPU lead time', value: '22 wk', delta: '−4 wk', tone: 'ok' },
  { key: 'Deals & M&A', value: '9', delta: '3 > $1B', tone: 'muted' },
];

export interface SampleWatchItem {
  name: string;
  state: 'alerting' | 'watching';
  tone: 'crit' | 'high' | 'elev';
}

export const SAMPLE_WATCHLIST: { group: string; items: SampleWatchItem[] }[] = [
  {
    group: 'WATERWAYS',
    items: [
      { name: 'Bab el-Mandeb', state: 'alerting', tone: 'crit' },
      { name: 'Suez Canal', state: 'watching', tone: 'high' },
    ],
  },
  { group: 'INFRASTRUCTURE', items: [{ name: 'Regional power grid', state: 'watching', tone: 'high' }] },
  {
    group: 'COUNTRIES & ACTORS',
    items: [
      { name: 'Yemen', state: 'alerting', tone: 'crit' },
      { name: 'Ukraine', state: 'watching', tone: 'high' },
      { name: 'Mali', state: 'watching', tone: 'elev' },
    ],
  },
];
