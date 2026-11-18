// Brief grounding: how many distinct publishers stand behind a set of headline
// rows, and whether they can ground a generated brief. Moved from the deleted
// scripts/crawlable-developments.mjs (refactor Phase 1b) for its remaining
// reader, demos/verification-desk. Plain JavaScript so bare Node.js can import it.
import { publisherFamilyFor, publisherFamilyForDomain } from './publisher-families.js';
import { AGGREGATOR_LINK_HOSTS } from './article-url.js';

// Provenance stamp on a headline row taken from the per-country GDELT article
// index (#7748) rather than the curated digest feeds. The brief floor requires
// at least one curated row.
export const COUNTRY_INDEX_ORIGIN = 'country-index';

function hostnameOf(url) {
  try {
    return new URL(String(url || '').trim()).hostname.toLowerCase().replace(/\.+$/, '');
  } catch {
    return '';
  }
}

// A brief needs at least this many distinct publishers (#7615). A 24/48/72h
// outlook synthesised from one outlet is a confident forecast off one source,
// and three articles from one newsroom are still one outlet: the count reads
// publisher families (shared/publisher-families.js, #6428), never raw source
// labels.
export const MIN_BRIEF_GROUNDING_PUBLISHERS = 2;

// Public suffixes with a second level ("co.uk", "com.au", "co.nz"): the
// registrable domain is the third label from the right, not the second.
// A full public-suffix list is overkill for a floor whose failure direction
// is "count one site twice"; these are the shapes news hosts actually take.
const SECOND_LEVEL_SUFFIX_LABELS = new Set(['ac', 'co', 'com', 'edu', 'go', 'gov', 'mil', 'ne', 'net', 'or', 'org']);

/** Registrable domain of an article URL ("www.bbc.co.uk/…" → "bbc.co.uk"), or '' when unparseable. */
export function registrableDomain(url) {
  let hostname = '';
  try {
    hostname = new URL(String(url || '').trim()).hostname.toLowerCase().replace(/\.+$/, '');
  } catch {
    return '';
  }
  const labels = hostname.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const take = tld.length === 2 && SECOND_LEVEL_SUFFIX_LABELS.has(second) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/**
 * Distinct publishers across a list of frozen rows (headlines or brief
 * sources). Labels resolve through the family table (shared/publisher-
 * families.js); a row's host resolves through that table's curated domains
 * ("bbc.co.uk" is the BBC whatever its label says); and rows published on
 * one site are one publisher: a digest row labelled "Guardian ME" and a
 * GDELT index row labelled "theguardian.com" (#7748) are the same newsroom,
 * and the floor must not clear on it twice. An aggregator redirect is not a
 * site — two outlets behind news.google.com stay two.
 */
export function briefGroundingPublisherCount(rows) {
  if (!Array.isArray(rows)) return 0;
  const parent = new Map();
  const find = (id) => {
    let current = id;
    for (;;) {
      const next = parent.get(current);
      if (next === undefined || next === current) return current;
      current = next;
    }
  };
  const union = (a, b) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };
  const familyBySite = new Map();
  for (const row of rows) {
    const family = publisherFamilyFor(row?.source);
    if (!family) continue;
    if (!parent.has(family)) parent.set(family, family);
    const hostname = hostnameOf(row?.url);
    if (!hostname || AGGREGATOR_LINK_HOSTS.has(hostname)) continue;
    const curated = publisherFamilyForDomain(hostname);
    if (curated) union(family, curated);
    const site = registrableDomain(row?.url);
    if (!site) continue;
    const sharing = familyBySite.get(site);
    if (sharing) union(family, sharing);
    else familyBySite.set(site, family);
  }
  return new Set([...parent.keys()].map(find)).size;
}

/**
 * Why the rows cannot ground a brief, or null when they can:
 * - 'thin-grounding'      fewer than MIN_BRIEF_GROUNDING_PUBLISHERS distinct
 *                         publishers;
 * - 'uncurated-grounding' enough publishers, but every row came from the
 *                         open-web index. Index rows corroborate a brief;
 *                         they do not ground one alone, because a generated
 *                         24/48/72h outlook on an indexed YMYL page needs at
 *                         least one curated newsroom behind it (#7748).
 */
export function briefGroundingGap(rows) {
  if (briefGroundingPublisherCount(rows) < MIN_BRIEF_GROUNDING_PUBLISHERS) return 'thin-grounding';
  const curated = rows.some((row) => row && typeof row === 'object' && row.origin !== COUNTRY_INDEX_ORIGIN);
  return curated ? null : 'uncurated-grounding';
}

/** True when the rows ground a brief: enough distinct publishers, at least one of them curated. */
export function hasBriefGrounding(rows) {
  return Array.isArray(rows) && briefGroundingGap(rows) === null;
}
