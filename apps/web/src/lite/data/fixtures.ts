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
