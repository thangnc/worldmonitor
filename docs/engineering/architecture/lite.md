# World Monitor Lite profile

Status: accepted scope and architecture, 2026-11-07. Phase 0 (repository review) is done. Phase 1 (profile shell) is implemented in code; the access gate is configured at deploy time.

This is the canonical spec for the owner's private, low-noise build of World Monitor. It records the original proposal, what review against the code changed, and the owner's decisions. `CLAUDE.md` holds the always-loaded summary and `.claude/rules/lite-profile.md` holds the file-level rules. Change this document first when scope or architecture changes.

## Purpose

Replace the "everything happening" view with three bounded domains. The default screen answers in under a minute: **what changed, why it matters, and what may happen next.**

1. Geopolitics and conflicts
2. Finance, Bitcoin and crypto
3. Technology and AI

Start with a low-noise executive view, keep the existing ingestion architecture, and promote an item only when several signals say it matters.

The owner's priority (2026-11-08) is **early indicators**: see army activity, conflict and violence, macro releases and bond moves, hacking, releases and outages as soon as a source reports them, so decisions can be made early. Each indicator is **linked to the news** around it, so a move or an event comes with the reports that may explain it. See [Early indicators](#early-indicators).

## Owner decisions

| Question | Decision |
|---|---|
| Name and branding | Keep "World Monitor". The instance is private and gated to the owner, not offered to others ([trademark policy](../../trademark-policy.mdx)). If it is ever opened to other people, switch to a distinct name with "Based on World Monitor" attribution. |
| Variant | Keep the existing `full` variant. No new `lite` variant. |
| Lite mechanism | A deployment profile: one build/deploy env flag on the owner's deployment turns on the three-domain defaults and the owner's custom features. With the flag off, behavior is identical to upstream. |
| "For me only" | The profile flag plus an access gate in front of the owner's domain. |
| Hosting | The owner's managed stack (see [Platform map](#platform-map)). The Docker compose stack stays a secondary option with the same flag. |
| AI models | External APIs allowed, through the existing chain in `server/_shared/llm.ts`. Keys and per-call cost are an operating concern. Local Ollama stays optional. |
| Conflict data | No ACLED (2026-11-07): API access is hard to obtain. UCDP (`seed-ucdp-events`, `UCDP_ACCESS_TOKEN`) supplies the map events and each country's conflict floor. GDELT country events (`seed-gdelt-bulk-materializer`, no key) supply the realtime conflict and unrest signal; `get-risk-scores.ts` scores them whenever ACLED returns no events. UCDP alone cannot do this, because it is an annual release. Health reports ACLED as `not_configured`, which is not a failure, and the `[CII] ACLED returned 0 events` log line is expected. |
| Lite map | MapLibre on OpenFreeMap vector tiles, solid land (2026-11-07): free, no key, no usage limits, and already the dashboard's fallback basemap. The style (`src/lite/map/style.ts`) draws only land, water, country borders and place names, colored from the Lite `@theme` tokens; markers, the popup a marker click opens, zoom buttons and the OpenStreetMap credit are Tailwind-styled HTML. No popup is open until a marker is clicked. MapLibre loads only when a screen with a map opens (Geopolitics, Finance or Technology). If OpenFreeMap is down, the map shows the background with markers still placed. Data shading (the reported-violence country fill now, GPS-interference hexagons later) is a MapLibre fill layer coloured from the theme tokens (owner's decision, 2026-11-08); the country shapes come from `/data/countries.geojson`. Markers, cards, controls and credits stay Preact. |
| Conflict map design | The owner's design (2026-11-08). UCDP locations are red circles sized by deaths, clustered by zoom (`supercluster`) with the toll printed inside; a click zooms a cluster in or opens a location's event card. Curated hotspots are diamonds with a name, coloured by the dashboard's live escalation score (`src/lite/data/escalation.ts` over `shared/analysis-hotspot-escalation.ts`: news in the last 2 h, CII, unrest, earthquake and military-flight convergence within 150 km, flights within 200 km; no vessels or session history). All curated hotspots are drawn, as on the dashboard; from 3/5 (elevated) they also show their name, and below it they are small grey diamonds labelled watch or stable in their card. Cards open on click beside the marker with a leader line. The dashboard's time range (1h–7d, default 7d) plus 30d (2026-11-08) sits on the map. It filters the digest-driven parts of the screen and the UCDP events, all counted back from now (owner's choice, for consistency across the screen). UCDP dates events by day, so an event counts when any part of its day falls inside the range. UCDP is a delayed release (weeks behind), so short ranges are often empty; the map's subtitle then names UCDP's newest date. The indicator designs supersede the range and UCDP parts of this row: see Indicator screens below; the code follows in build step 2. A point with two or more UCDP events gets a summary card (date span, violence types, actor pairs, sources), and UCDP's `XXX` codes for actors it cannot identify read "Unidentified group (UCDP XXX100)". |
| Early indicators | The owner's priority (2026-11-08): indicators that arrive first, each linked to the news around it, so a price move or an event can be understood, not only seen. Each indicator has a written trigger rule, its source and timestamp, and a "reported" or "verified" label. Without linked news it says "No linked news found" and never guesses a cause. The catalogue, the defaults and the build order are in [Early indicators](#early-indicators). |
| Indicator sources | The owner holds free keys for Cloudflare Radar, NVD, abuse.ch, AbuseIPDB and AlienVault OTX (2026-11-08), so the Technology and AI indicators can be built. FAA NOTAM access is not self-service and has been requested; airspace closures wait for it. Keys live in the deployment's env and, for local seeder runs, in `.env.local`; they are never committed or printed. |
| Indicator screens | The owner's designs (2026-11-08) for the Briefing, Geopolitics, Finance & Crypto, Technology & AI and the layers popover. Every domain screen has a map with a layers popover, an indicator panel beside it and its domain panels below; the Briefing has a fired-indicators block with a feed-health strip. Owner answers: VERIFIED is kept for independently verified datasets (UCDP), and prices are labelled MARKET DATA; a stablecoin fires at 0.5% from $1; Finance shows the 1D range only; the Geopolitics range is 6h, 24h, 7d and 30d (12 months dropped), and UCDP shows as the verified background whatever the range; "Primary-source regulation" stays a labelled sample until a regulation feed exists. Details in [Screen design](#screen-design). |
| Front page | A dedicated Lite UI at `/lite`, built from the owner's designs with Preact and Tailwind CSS. With the flag on it is the default page; the full dashboard stays reachable at `/dashboard?full=1`. See [Lite UI](#lite-ui-lite). |

### Open decisions

These were open in the proposal and are still open:

1. The initial watchlist: countries, conflicts, assets, institutions, companies, AI topics.
2. Alert latency and false-positive tolerance per domain. [Early indicators](#early-indicators) sets default triggers for the owner to adjust.
3. Budget and licensing posture for market, news and specialist data.
4. Who reviews source policy, corrections and high-impact alert rules (default: the owner).

## Scope by domain

Panel and layer IDs are the keys in `src/config/panels.ts` and `src/config/map-layer-definitions.ts`. "Missing from `full`" means the panel exists only in another variant and must be added to `FULL_PANELS` before the profile can show it.

### Geopolitics and conflicts

Event-centric, not headline-centric. Refresh target: 5 to 15 minutes.

| Proposal widget | Existing building blocks | Gap |
|---|---|---|
| Priority event feed | `insights`, `strategic-posture`, `cross-source-signals` | No durable event object (see [Intelligence layer](#intelligence-layer)) |
| Conflict map | layers `conflicts`, `hotspots`, `military`, `ciiChoropleth`, `sanctions`, `ucdpEvents` | — |
| Escalation tracker | `cii`, `strategic-risk`, `escalation-correlation`, `ucdp-events` | 24h/7d change exists for CII; not per event |
| Regional timeline | `threat-timeline`, story lifecycle (`shared/story-phase.js`) | No multi-story event timeline |
| Watchlists and alerts | followed countries, `monitors` | Alert delivery depends on Convex (see [Platform map](#platform-map)) |

### Finance and crypto

Contextual monitoring, not a trading terminal. Refresh target: 1 to 5 minutes for prices, event-driven for news.

| Proposal widget | Existing building blocks | Gap |
|---|---|---|
| Market pulse | `markets`, `macro-signals`, `fear-greed` | — |
| BTC/crypto detail | `crypto`, `etf-flows`, `stablecoins`; Hyperliquid positioning stress (`scripts/seed-hyperliquid-flow.mjs`) | `crypto-news` missing from `full`; no liquidation data |
| Macro and calendar | `economic-calendar`, `macro-signals` | `centralbanks` missing from `full` |
| Market-moving events | market news in the digest; seeded crypto, stock, index, commodity and FX quotes for the price links; freight indices (`supply_chain:shipping:v2`) | Rows are deduplicated stories, not clustered events; the freight indices are not linked to shipping stories yet |
| Risk alerts | stablecoin depeg status (`shared/stablecoin-classifier.cjs`), relay `market_alert` on 24h moves | Depeg never notifies; funding and open interest are display-only; no volatility model |

Market commentary is labelled as analysis, not investment advice. Price and derivatives data must be licensed and fit provider rate limits.

### Technology and AI

Material capability, policy and business changes, not product marketing. Refresh target: 15 to 60 minutes.

| Proposal widget | Existing building blocks | Gap |
|---|---|---|
| AI/tech event feed | `ai`, `tech` | Not grouped into events |
| Model and product tracker | — | New panel and sources needed |
| Policy and governance | `policy` (AI Policy & Regulation news), `ai-regulation`, `src/config/ai-regulations.ts` | Both missing from `full`. `full` has `trade-policy`, a different panel |
| Research radar | research service (`server/worldmonitor/research/v1/`: arXiv, Hacker News, trending repos) | Data exists; no panel on `full` |
| Infrastructure and business | `hardware`, `tech-readiness`, layer `datacenters`, `src/config/ai-datacenters.ts` | `hardware` missing from `full` |

### Interaction rules

- One dashboard with geopolitics, finance and technology as the default layout. Ship a "Lite" mission preset (`src/services/mission-presets.ts`) so the layout can be re-applied: `FULL_PANELS` defaults only reach first visits and new keys.
- Pin entities, regions, assets, companies, models and topics. Reuse followed countries, the market watchlist and `monitors` before adding a new store.
- Every summary exposes its sources, timestamps, confidence and "why this matters".
- Progressive disclosure: headline → event card → evidence and timeline → original links.
- Keep confirmed facts, attributed claims, model inference and open questions visibly distinct.

## Early indicators

The owner's priority (2026-11-08). An indicator is a feed that reports a change before the news digest or the slower datasets explain it. Lite shows an indicator when its trigger rule fires, with its source, its timestamp and the news linked to it.

### News link rule

Every indicator links to the news, in both directions:

- **Indicator → news.** When a trigger fires, Lite lists up to three digest stories published in the link window before it (and up to one hour after it). It matches them on the indicator's subject:
  - the instrument or its tickers (`shared/ticker-extract.js`, `namedInstruments` in `src/lite/data/prices.ts`);
  - the instrument's named drivers, from a fixed list per instrument (for example the 10-year yield: Fed, Treasury, CPI, PCE, payrolls, auction);
  - the country or hotspot (`shared/country-headline-match.ts`, the hotspot keywords used by the escalation score);
  - named entities (`shared/entity-registry.js`).

  Matches rank by match strength, then closeness in time, then corroboration (`assessCorroboration`). The panel reads "Reported around the move", never "caused by".
- **News → indicator.** A story shows the indicators that moved around it. Finance already does this for prices (market-event price links); the same link extends to yields, macro releases and the Geopolitics and Tech indicators.
- **No link.** An indicator with no matching story says "No linked news found". An unexplained move is a signal in itself, so it is not hidden.
- **AI summaries.** A one-line "why" may be generated only from the linked stories, with citations, through the grounded brief code (`shared/brief-llm-core.js`, `shared/brief-claim-rules.js`), and labelled as model inference.

### Catalogue

Defaults are a starting point (open decision 2). Each build PR runs its seeders locally first and reports how often the trigger would have fired. "Key" names the credential the seeder needs; none is printed or committed.

Finance fire rates over the year to 8 Nov 2026 (step 3): US 2-year or 10-year ±10 bp on 17 of 249 trading days, no 2s10s sign flip; 10-year ±10 bp on 7 of 252 days for DE, 13 of 251 for GB and 2 of 240 for JP. The prior-print stand-in fires on about half the releases (FRED, last 24: CPI 10, PCE 12, payrolls 13), which is why the forecast source stays the target. ETF flows, perp positioning, freight and 8-K filings keep no history to replay.

Labels say what kind of evidence a value is (owner's rule, 2026-11-08):

- **Official**: published by a government, regulator, central bank, exchange operator or the issuer itself.
- **Reported**: third-party telemetry or machine-coded reports (transponders, GDELT, Cloudflare, threat feeds).
- **Estimated**: derived from proxies; the card says what from.
- **Market data**: prices and market-derived values from a quote provider.
- **Verified**: an independently verified dataset. Only UCDP qualifies today; a composite of several venues is still market data.

A slow feed shows the date its data covers ("data to 3 Nov", "week to 7 Nov"), not a clock time, so a daily, weekly or delayed feed does not read as stale.

**Geopolitics and conflicts.** Link window: 24 h before.

| Indicator | Feed | Default trigger | Label |
|---|---|---|---|
| Reported violence | `seed-gdelt-bulk-materializer` (GDELT, CAMEO 18–20, every 15 min; no key), read from `gdelt:bulk:conflict-counts:v1`. The unit is **reports**: distinct articles coded as material conflict, per country (no coordinates, so the map shades countries) | A country's reports in the last 6 complete hours reach twice its 7-day average for 6 hours, and at least 5. A partial hour or fewer than 5 complete baseline days is unknown, never calm | Reported (GDELT, machine-coded) |
| Military aircraft | `seed-military-flights` (adsb.lol; no key) | 5 or more military aircraft within 200 km of a curated hotspot. The card splits them by type where the aircraft is on the known list, and counts the rest as other | Reported (transponders) |
| Chokepoint transits | `seed-portwatch` (IMF PortWatch daily transits by vessel type at Bab el-Mandeb, Suez, Hormuz, Malacca, Panama, the Bosphorus, the Taiwan Strait, Gibraltar, the Dover Strait and the Cape of Good Hope; refreshed every 6 h, data a few days behind) and `seed-chokepoint-flows` (tanker flow in mb/d at the oil chokepoints among them) | 7-day transits 25% or more below the year-earlier normal, or tanker flow below 85% of its 90-day normal on each of the last 3 days (the seeder's `disrupted` flag) | Estimated (IMF PortWatch, from ship transponders) |
| GPS interference | `fetch-gpsjam` (gpsjam.org, daily map cells of about 1,800 km² with the share of aircraft reporting bad GPS; medium 2–10%, high above 10%; no key) | A high cell within 200 km of a curated hotspot that had none the day before, or a region's high cells up 50% or more on the day. Needs the previous day kept ([Baselines](#baselines)) | Reported (gpsjam.org, aircraft transponders) |
| Airspace closures | `seed-notam-nms` (FAA NOTAM service; key `NOTAM_KEY`, `NOTAM_SECRET`; access requested from the FAA, so built last in step 2) | A new closure over a watchlist country or a curated hotspot | Official notice |
| Incidents at sea | `seed-ukmto-incidents` (UKMTO; no key) | Any new incident | Official notice |
| Taiwan Strait activity | `seed-cross-strait-activity` | Daily activity above its 30-day average | Official report |
| Embassy security alerts | `seed-security-advisories` (US embassies) | A new alert for a watchlist country | Official notice |
| Verified violence | `seed-ucdp-events` | None: background, weeks behind | Verified (UCDP) |

**Finance and crypto.** Link window: 6 h before.

| Indicator | Feed | Default trigger | Label |
|---|---|---|---|
| Macro release surprise | `seed-economic-calendar`, actuals from FRED (`scripts/_econ-actuals.mjs`: CPI, PCE (`PCEPI`) and others); `seed-us-cpi` (key `FRED_API_KEY`) | Target: actual minus forecast of 0.1 pt or more for CPI or PCE month on month, 50k or more for payrolls. No source gives a forecast (the calendar's `estimate` is empty), so until one exists the prior print stands in (owner's choice, 2026-11-08): the print 0.2 pt or more from the prior print for CPI or PCE, 100k or more for payrolls, released in the last 3 days, labelled "no forecast source" | Official data |
| Treasury yields | `seed-us-treasury-par-yield` (daily; no key); the intraday 10-year from the `^TNX` quote | The 2-year or 10-year moves 10 bp or more in a day, or the 2s10s spread changes sign | Official data |
| Other government bonds | `seed-yield-curve-*` (DE, GB, JP and others) | A 10-year moves 10 bp or more in a day | Official data |
| Price moves | Seeded quotes (the existing risk alerts) | The existing fixed thresholds and BTC 2 h move over 4σ | Market data |
| Company material events | `seed-sec-8k-stream` (SEC 8-K filings; no key) | A filing in the last 24 h by a watchlist company. Until the watchlist exists (owner's choice, 2026-11-08): a company in the dashboard's default stock list (`shared/stocks.json`, matched by name, since filings carry no ticker), or any filer reporting item 1.03 (bankruptcy), 1.05 (cyber incident), 2.04 (debt default) or 4.02 (restatement) | Official filing |
| Bitcoin ETF flows | `seed-etf-flows` (10 US spot bitcoin ETFs from `scripts/shared/etfs.json`, Yahoo daily bars; `ALPHA_VANTAGE_API_KEY` optional) | 8 or more of the ETFs flow the same way in a day | Estimated (from price and volume, not issuer-reported flows) |
| Stablecoin depeg | `seed-stablecoin-markets` (USDT, USDC, DAI, FDUSD, USDe; CoinGecko, CoinPaprika fallback; no key) | A tracked stablecoin more than 0.5% from $1 (owner's choice): the classifier's `SLIGHT DEPEG` or `DEPEGGED` (`scripts/shared/stablecoins.json`) | Market data |
| Perp positioning | `seed-hyperliquid-flow` (one venue, every 5 min: BTC, ETH, SOL, PAXG, oil, metals, natural gas, EUR, JPY; stress score from funding 30%, volume 25%, open interest 25%, basis 20%) | Stress score 60 or more (the seeder's `ALERT_THRESHOLD`) | Market data (Hyperliquid, one venue). No liquidation figures: no source has them |
| Container and bulk freight | `seed-supply-chain-trade` (`supply_chain:shipping:v2`: SCFI weekly on Fridays, Baltic Dry daily) | SCFI 5% or more week on week, or the Baltic Dry 5% or more in a day | Official (Shanghai Shipping Exchange) for SCFI; Market data for the Baltic Dry |

**Technology and AI.** Link window: 12 h before. The linked news is the tech digest, which includes Hacker News: an outage, a hack or an exploited vulnerability links to the stories there that name its vendor, network or country.

| Indicator | Feed | Default trigger | Label |
|---|---|---|---|
| Internet and power outages | `seed-internet-outages` (Cloudflare Radar; key `CLOUDFLARE_API_TOKEN`) | A new country or network outage. The card shows its type, scope and stated cause (power cut, cable cut, government shutdown), not a percentage drop: Cloudflare's outage notices and traffic anomalies carry none | Reported (Cloudflare) |
| Cloud and AI service outages | `infra:service-statuses:v1` from `server/worldmonitor/infrastructure/v1/list-service-statuses.ts` (public status pages of AWS, Azure, Google Cloud, Cloudflare, GitHub, OpenAI, Anthropic and others; no key). `seed-service-statuses` warms the upstream production URL, so the owner's deployment warms its own endpoint | A watched provider reports a partial or major outage | Official (provider status page) |
| Exploited vulnerabilities | `seed-cve-reference` (CISA KEV subset of NVD; key `NVD_API_KEY` optional) | A new known-exploited CVE, or one naming a watchlist vendor | Official (CISA) |
| Attack infrastructure | `seed-cyber-threats` (abuse.ch Feodo Tracker and URLhaus, AlienVault OTX, AbuseIPDB, C2IntelFeeds; keys `URLHAUS_AUTH_KEY`, `OTX_API_KEY`, `ABUSEIPDB_API_KEY`) | A spike against its 7-day average. Needs the count history in [Baselines](#baselines) | Reported (threat feeds) |
| Model and product releases | None yet ([gap 5](#gaps-to-build)) | — | — |
| Live power-grid outages | None yet; `seed-power-reliability` is per-country background, not live | — | — |
| Primary-source regulation | None yet; the policy list is hand-maintained (`src/config/ai-regulations.ts`) | — | Shown as SAMPLE (owner's choice) until a regulation feed exists |

### Baselines

Rules measured against a normal need history that some feeds do not keep. It is kept in Redis as rolling count keys with a TTL longer than the window, so no new datastore is needed (the Supabase gate covers history longer than Redis TTLs):

- **GDELT conflict events**: the row key holds only the last 24 h (`GDELT_ROLLING_WINDOW_MS`). Built in step 2a: the materializer keeps hourly conflict counts per country for 48 h beside the existing 30 daily buckets (`gdelt:bulk:country-events:v1`, same cursor, so a replayed cohort never counts twice), and publishes the compact projection `gdelt:bulk:conflict-counts:v1` (48 hourly and 30 daily buckets, each with its cohort count; 6 h TTL; seed-meta and activation marker; on-demand bootstrap key `gdeltConflictCounts`). Only live cohorts fill the hours; the archive repair rebuilds days. They feed the violence rule, the shading, the report histogram and the hotspot strip.
- **Attack infrastructure**: `seed-cyber-threats` keeps the latest snapshot. Keep daily counts per source and malware family for 30 days.
- **GPS interference**: keep the previous day's high cells.

Feeds that already keep history: Taiwan Strait activity, Treasury par yields (the curve against a week ago), chokepoint transits and the Hyperliquid baselines.

### Screen design

The owner's designs (2026-11-08). The design exports stay out of the repository.

**Indicator card.** One component on every screen: domain chip, name, time; value and change; the rule it crossed; label and source; linked-news count, or "No linked news found" with an accent. A feed with nothing fired shows a one-line state instead of a card:

- **Quiet**: live, nothing fired;
- **Stale**: late against its cadence;
- **Unavailable**: no access yet (for example "Airspace closures · awaiting FAA access").

Clicking a card focuses its marker on the map, and a marker opens the same card.

Built in step 1:

- **Components:** `src/lite/components/indicator.tsx` has the full card, the compact card (it expands in place to the full one; Escape collapses it), the state rows and the health dots.
- **Model:** `src/lite/data/indicators.ts` holds the indicator model and `feedState`. A failed or empty source is unavailable and names its seeder. Data older than twice its cadence is stale. A feed without a data timestamp never claims stale.
- **Linking:** `src/lite/data/news-link.ts` applies the news link rule.
- **Colours:** MARKET DATA, which the design system lacks, uses the muted ink with a chart icon. REPORTED uses `--color-reported`, and the no-link accent uses `--color-nolink`.
- **AI line:** shown only when the card has linked stories and a grounded "why", which no feed produces yet.

**Briefing.** A "Fired indicators" block at the top, newest first, with filters All, Watchlist and No linked news, and a feed-health strip (one dot per feed: fired, quiet, stale, unavailable). The watchlist parts are samples until the watchlist exists (open decision 1). The hourly brief, priority events, market pulse, escalation tracker and catalysts stay.

**Geopolitics.**

- The map's layers popover has three groups:
  - **Live layers**, filtered by the range: reported violence (GDELT, country shading by the 6 h ratio to the 7-day average), military aircraft (a badge at 5 or more near a hotspot), incidents at sea (UKMTO), GPS interference (hexagons), airspace closures (N/A until FAA access).
  - **Background and judgement**: UCDP as the verified background, always shown, with its newest date; curated hotspots with the live score.
  - **Context, optional**: shipping lanes; social OSINT (discovery only, never alerts; no source chosen yet).
- Range 6h, 24h, 7d, 30d, with a GDELT events-per-hour histogram.
- A region strip under the map (derived): the five curated hotspots with the highest live score. Each shows its level word (Critical, High, Elevated, Watch, Easing), the change in GDELT events in its countries over the last 24 h against the 7-day daily average, and daily bars for 14 days. A click selects the hotspot.
- The indicator panel beside the map; priority incidents, regional timeline and evidence mix below.

Built in step 2a: the range (6h, 24h, 7d, 30d), the GDELT shading and histogram, UCDP as the background, the hotspot strip and the indicator panel's violence feed (`src/lite/data/conflict.ts`, `LiteMap`'s `countries` prop). Step 2b adds the other layers, their indicators and the layers popover.

**Finance & Crypto.**

- A ticker strip (BTC, Brent, gold, S&P 500, US 10Y) with the 1D change only.
- A map, "Where markets are moving":
  - fired and quiet finance indicators pinned at the issuing central bank or exchange (`CENTRAL_BANKS`, `STOCK_EXCHANGES` in `src/config/finance-geo.ts`);
  - Geopolitics indicators near chokepoints, pipelines and commodity hubs, labelled with the price they moved;
  - chokepoints (red when a transit rule fires or an incident is linked);
  - shipping lanes, sanctions and financial centres as context.
  - The pin marks where a signal is issued, not where it is felt. Crypto stays off the map: ETF flows, depegs and positioning are cards.
- The indicator panel; market-moving events (each story shows the indicators that moved before or after it); macro calendar with forecast, actual and surprise (built with prior, actual and change until a forecast source exists); the US Treasury curve, today against a week ago.
- The chart widgets go: BTC volume bars, volatility, liquidations and the correlation matrix. Done in step 3b; funding, open interest and ETF flows remain as indicator cards.
- Built in step 3b: until the Geopolitics indicators exist, chokepoints carry the supply-chain disruption score and the map's "market-moving geopolitics" layer reads N/A. Quiet signal pins show their reading on hover; fired ones carry a name chip. Opening a card in the panel opens its pin, and a pin opens the same card.

**Technology & AI.**

- A map, "Infrastructure & cyber map":
  - DDoS targets (country shading, Cloudflare Radar with the same token);
  - attack servers (hexagons with counts and the main malware family);
  - outages (major, partial, minor);
  - cloud regions (`CLOUD_REGIONS` in `src/config/tech-geo.ts`): a region turns red only when the incident names it, otherwise all of the provider's regions show degraded;
  - AI data centres (`src/config/ai-datacenters.ts`), amber when an outage is in the same country;
  - undersea cables (cable health: OK, degraded, fault).
  - The map notes that DDoS shading shows who is attacked and the hexagons show where attackers' servers are.
- The indicator panel; material developments; the model and product tracker (SAMPLE); research radar; policy and governance; infrastructure tiles from real counts (active outages, providers degraded, exploited CVEs this week, threat indicators against their average); watched topics.

### Build order

Each step is its own PR with screenshots, and starts by running its seeders locally. Steps 2 to 4 depend only on step 1, not on one another:

1. The news link rule as one shared Lite module, with tests, used first by the existing Finance price links.
2. Geopolitics: the GDELT count history, then the violence layer on the map, filtered by the range; military aircraft, sea incidents and GPS interference as layers; chokepoint transits, Taiwan Strait activity and embassy alerts as indicators; the region strip; airspace closures once FAA access arrives. UCDP becomes the verified background layer.
3. Finance: macro release surprises, yield moves, bitcoin ETF flows, stablecoin depegs, perp positioning and freight, each with linked news; the "Where markets are moving" map. Done in code: step 3a (the indicators, 8-K filings and the Treasury curve) and step 3b (the map, the chart widgets removed, 1D tickers).
4. Technology and AI: the attack-infrastructure history; internet, cloud and AI service outages, exploited vulnerabilities and attack infrastructure (all keys in hand); the infrastructure and cyber map; then the model-release tracker.
5. The Briefing's fired-indicators block and feed-health strip, across Geopolitics, Finance and Technology.

## Removed or optional by default

All of these are `enabled: false` panel flags or layer booleans under the profile. None needs a code change.

| Category | Decision | IDs |
|---|---|---|
| General and regional news streams | Off; source layer for search only | `live-news`, `politics`, `us`, `europe`, `middleeast`, `africa`, `latam`, `asia`, `gov`, `thinktanks` |
| Webcams, clocks, aviation | Off | `live-webcams`, `world-clock`, `airline-intel` |
| Hazards and environment | Optional: enable per region or as a correlated alert | `satellite-fires`, `climate`, `disease-outbreaks`, `displacement`; layers `weather`, `natural`, `outages`, `ais` |
| Social trend and firehose | Off; at most a labelled discovery layer | `social-velocity`, `telegram-intel`, `x-intel`, `wsb-ticker-scanner` |
| Retail and consumer | Off | `consumer-prices`, `grocery-basket`, `bigmac`, `fuel-prices` |
| Commodities and supply chain | Off | `commodities`, `supply-chain`, `energy` |
| Long-tail crypto tokens | Never added to `full` | `defi-tokens`, `ai-tokens`, `other-tokens` |
| Repeated per-source widgets | Consolidate into event cards | — |

The proposal also listed sports, entertainment and celebrity streams. The catalog has none, so there is nothing to remove.

### Decision rule for optional modules

Enable an optional panel, layer or feed only if it meets at least one test:

- It is an early indicator for a core-domain event.
- It materially changes exposure for a defined watchlist.
- The owner requests it with a clear decision use.
- Its expected signal outweighs its maintenance, cost, licensing and distraction burden.

## Profile mechanism

- `VITE_LITE_PROFILE=true` at build time turns the profile on (`LITE_PROFILE_ENABLED` in `src/config/lite-profile.ts`). The module also holds the Lite panel order, the cross-variant panel list, and the desktop and mobile layer sets.
- Under the flag: Lite panel and layer defaults, the Lite mission preset, the Lite-only panels and features, the source-policy filter, and the Lite seeder allowlist.
- Without the flag: no behavior change. Lite-only code paths are flag-gated so upstream merges stay cheap.
- The variant stays `full`. A custom hostname already resolves to `full` (`src/config/variant.ts`), so the owner's domain needs no variant change.
- Panels taken from the `finance` variant (`crypto-news`, `centralbanks`) and the `tech` variant (`policy`, `ai-regulation`, `hardware`) join the `full` catalog only under the flag (`buildLitePanelCatalog`), so presets and panel enablement keep them. Their news comes from the other editions' digests. Upstream `full` does not change.
- Under the flag, the `full` catalog lists the Lite panels first and enabled, and every other `full` panel disabled but still available in Settings. Default map layers are exactly the Lite set (`buildLiteMapLayers`).
- The `lite-desk` mission preset (Lite Desk) re-applies the layout. It is always in the catalog, so preset ids, analytics and checkout attribution stay in sync, but it is offered only when the flag is on.
- Lite layers are all allowed on `full`. Finance and tech map layers (`stockExchanges`, `centralBanks`, `financialCenters`, `techHQs`) are not in the profile; adding one later needs `VARIANT_LAYER_ORDER.full`, or `sanitizeLayersForVariant` strips it.
- No Lite panel is premium on the web build (`cii` and `strategic-risk` are premium only in the desktop app), so Phase 1 needs no premium unlock.

## Lite UI (`/lite`)

The owner's front page: a sidebar, the cross-domain Briefing at `/lite` (home), and its three child screens, Geopolitics & Conflicts (`/lite/geopolitics`), Finance & Crypto (`/lite/finance`) and Technology & AI (`/lite/tech`). The Briefing links to each child through the sidebar, its events' domain tags and its panel headers. The design exports are kept out of the repository; their sample rows live in `src/lite/data/fixtures.ts`.

**Stack exception.** The dashboard has no framework. `src/lite/` alone uses Preact (JSX through `tsconfig.json`'s `jsxImportSource`) and Tailwind CSS 4 (`@tailwindcss/vite`, scoped to `src/lite/lite.css`), with Lucide icons and self-hosted IBM Plex fonts (the CSP allows no font host). `scripts/lint-boundaries.mjs` keeps it separate: `src/lite/` may import `config`, `services`, `utils`, `shared/` and generated clients, never `src/components/`, `src/app/` or `App.ts`, and nothing outside it may import `src/lite/`.

**Routing.**

| Request | Flag on | Flag off |
|---|---|---|
| `/` on the owner's host | `middleware.ts` 307s to `/lite` (legacy `/?lat=` map links still go to `/dashboard`) | Unchanged (404 on a custom host) |
| `/` in dev or Docker, `/dashboard` | The guard at the top of `src/main.ts` replaces the page with `/lite` unless the URL carries dashboard state | Unchanged |
| `/dashboard?full=1` | The dashboard; remembered for the tab (`sessionStorage` `wm-lite-full`) | The dashboard |
| `/lite`, `/lite/geopolitics`, `/lite/finance`, `/lite/tech` | The Lite UI | A notice that the profile is off, with a link to `/dashboard` |
| Installed PWA | Starts on `/lite` | Starts on `/dashboard` |

The rules are in `src/config/lite-route.ts`. `vercel.json`, `docker/nginx.conf*` and a Vite dev middleware serve `lite.html` for the four paths only, and `isKnownPublicPagePath` (`src/config/agent-not-found.ts`) lets exactly those four past the 404 gate. `npm run build:lite` (`vite.lite.config.ts`) builds the page on its own after the main build, so it shares no chunks with the dashboard.

**Data.** `src/lite/data/sources.ts` reads the same sources as the dashboard, without `App`: the bootstrap tiers once, then the generated RPC clients, and the news digest through its public CDN shape. It uses no premium path. Each widget is one of:

- **Real**: rendered from a source. An empty or failed source shows its own state and names its seeder. It never falls back to sample data.
- **Derived**: computed by a stated rule and tagged DERIVED with the rule in its tooltip.
- **Sample**: no source exists yet. It renders the design's values with a SAMPLE badge.

| Screen | Real | Derived | Sample |
|---|---|---|---|
| Briefing | Hourly AI brief: lead, cited lines and their sources (`insights`, seed-insights); market pulse tickers; macro calendar and AI regulation deadlines as catalysts | Priority events: each child screen's main list merged, importance ≥ 50, ranked by importance × credibility; momentum from story phase; the corroboration and attributed-claims columns from the dashboard's corroboration verdict; "since" counts; market regime (five 24h moves); escalation trend from CII history (±10% is stable); watch alerts from built-in rules (impact, BTC 2h move > 4σ, primary-source AI policy) | None. Open questions, Pin, Split cluster, Mute, Manage and Generate brief are SOON |
| Geopolitics | UCDP events on a MapLibre map (OpenFreeMap tiles, styled from the Lite tokens), clustered by zoom with event cards, shown at every range as the verified background; GDELT conflict counts; priority incidents (digest, medium threat and up) | Reported-violence country shading, only above each country's own normal and never by raw volume (6h and 24h against the 7-day average; 7d and 30d the last 7 complete days against the 22 before, since 30 days hold no earlier normal), with a card per shaded country; the violence indicator (×2 the 7-day average and ≥ 5 reports in 6 h) with its linked news; GDELT reports per hour or day over the range (6h, 24h, 7d, 30d), which also filters incidents, timeline and evidence mix; hotspot strip (the five highest live scores, GDELT change over 24 h, 14 daily bars); curated hotspots coloured by the dashboard's live escalation score (see Owner decisions); timeline tags and incident status from the dashboard's corroboration verdict, with tier 1 marked beside it; evidence mix by source class | Watchlist |
| Finance | Five 1D tickers (BTC, Brent, gold, S&P 500, US 10Y); market-moving stories (one copy per story, asset classes in turns, war stories left to Geopolitics unless the headline names a commodity, then marked "Linked to GEO"); macro calendar with prior and actual prints (yesterday to two weeks out); US Treasury curve, the newest against the newest a week or more older, with the 2s10s spread; on the "Where markets are moving" map, chokepoint status (`get-chokepoint-status`; every strategic waterway is drawn grey when it is not read), shipping lanes (`src/config/trade-routes.ts`), new OFAC designations by country (`sanctionsPressure`, shaded from `countries.geojson`) and financial centres | Indicators panel on the shared indicator card (`src/lite/data/finance-indicators.ts`, `finance-macro-indicators.ts`): BTC 24h move ≥ 4%, BTC perp funding ≥ 0.01%/h, a stablecoin more than 0.5% from $1, fear & greed ≤ 20 or ≥ 80, and the step 3 catalogue rows (macro print against the prior print, Treasury 2Y/10Y ±10 bp or a 2s10s flip, DE/GB/JP 10-year ±10 bp, 8 or more bitcoin ETFs the same way, Hyperliquid stress ≥ 60, SCFI ±5% w/w, Baltic Dry ±5% d/d, 8-K filings), each fired rule with its linked news; the calendar's change column (actual minus prior); map pins (`src/lite/data/markets-map.ts`): each non-crypto signal at its issuer (Fed, ECB, BoE, BoJ, NYSE, Shanghai Shipping Exchange, Baltic Exchange), filled when fired, and opening the same indicator card; a chokepoint red at disruption score 50, labelled with the price it moves (Brent for Hormuz, Bab el-Mandeb and Suez; wheat for the Black Sea straits; SCFI elsewhere); a lane amber when disrupted, high risk or through a red chokepoint; market-event price links (24h change of the instruments a headline names or its tickers, else asset-class benchmarks; "No price impact" under 0.25% or 3bp) | None. Market-moving geopolitics on the map is N/A until the Geopolitics indicators exist (step 2) |
| Technology & AI | Material developments (tech digest); policy actions (the curated `src/config/ai-regulations.ts` list); arXiv papers; funding and infrastructure stories | Evidence pills (corroboration verdict, "Primary source" when a tier-1 outlet reports alone); research signal (arXiv plus Hacker News); watched-topic counts | Model and product tracker; infrastructure KPI tiles |

The table describes the screens as built. The target screens are in [Screen design](#screen-design); each build step updates its rows.

**Corroboration.** Every Lite status, tag and pill comes from `assessCorroboration` in `server/_shared/corroboration.ts`, the rule the full dashboard's news and insights badges use, applied to each digest item (`corroborationOf` in `src/lite/data/transforms.ts`). It counts publisher families from the digest's origin-aware `corroborationCount`, so one newsroom's feeds and reprints count once:

- **Corroborated**: two or more publishers.
- **Single publisher**: one.
- **Low-tier only**: every publisher seen is a declared tier-4 outlet (aggregators and blogs).
- **No count**: the digest carried none. It never reads as a single source.

It describes coverage, not accuracy, so Lite never labels a headline "confirmed". Tier 1 (`isPrimarySource`) is shown beside the verdict and never upgrades it. Tier 1 in `shared/source-tiers.json` covers wires and official bodies and also some major outlets and public broadcasters. Confirmed facts need the event-analysis phase. `storyMeta.sourceCount` is report volume: Lite shows it as a report count and never as corroboration.

Alerts, Watchlists, Sources, Scoring rules, Settings and each screen's primary action are shown and marked SOON. They arrive with the phases that give them data.

## Platform map

| Upstream | Owner's stack | Notes |
|---|---|---|
| Vercel (SPA + Edge API) | Vercel | Same build and `vercel.json`. |
| Upstash Redis | Upstash | Same; Redis stays the only store the dashboard reads (`cachedFetchJson`, `seed-meta`). |
| Railway (seeders, relay, workers) | Render | Seeders are platform-neutral (`loadEnvFile`, `scripts/_bundle-runner.mjs`). Port the cron schedules from `scripts/railway-services.json` for the Lite allowlist only. Railway-specific watch paths and deploy-gate tests do not apply to Render. |
| Convex (accounts, prefs sync, alert rules, `intelHistory`, entitlements) | None by default | Single user: preferences stay in localStorage. Alert rules and delivery, `intelHistory`, and premium unlock need a non-Convex path or are dropped. |
| Clerk | None | No accounts. Access is the gate below. |
| — | Cloudflare | DNS, the access gate (Cloudflare Access, or Vercel Deployment Protection; verify plan limits), and R2 for raw archives. `scripts/_r2-storage.mjs` already supports Cloudflare and S3 modes and records sha256. |
| — | Supabase (Postgres) | Phase-gated, see below. |

### Phase gates for new stores

Do not add a datastore before its gate is met:

- **Supabase Postgres** when the build needs any of: an event store with timelines, history longer than Redis TTLs, alert rules or delivery state, or a replacement for `intelHistory` (pgvector). Template: `consumer-prices-core/` (`pg`, migrations, `raw_payload_json`, `raw_hash`).
- **R2 raw archive** when audit or replay of upstream payloads is required. Store the body, fetch time, canonical URL, source and content hash.

### Operations

- **Seeder allowlist.** Upstream runs about 250 seeders. The profile runs only those feeding Lite panels. This sets Render cost. It must include `seed-gdelt-bulk-materializer`: without ACLED it is the only realtime conflict input to the risk scores (see [Owner decisions](#owner-decisions)). The hotspots' live score also reads `seed-unrest-events` (runs on GDELT alone without ACLED), `seed-earthquakes` (USGS, no key) and `seed-military-flights` (adsb.lol by default; OpenSky and Wingbits are optional); without them it falls back to news, CII and the curated baseline, and each hotspot card names the missing inputs. Each [early indicator](#early-indicators) adds its seeder to the allowlist when it is built. Finance (step 3) adds `seed-economic-calendar`, `seed-bundle-macro` (Treasury par yields), `seed-bundle-yield-curves`, `seed-etf-flows`, `seed-hyperliquid-flow`, `seed-stablecoin-markets`, `seed-supply-chain-trade`, `seed-sec-8k-stream` and `seed-sanctions-pressure`; chokepoint status also reads the relay's navigational warnings and vessel snapshot.
- **Health.** `api/health.js` grades every registered key. Keys produced only by Railway services or Convex show as stale on the owner's stack, so the profile needs a health key subset matching the allowlist.
- **Licensing.** `shared/source-attribution-manifest.json` has 1,044 hosts: 735 `terms-review`, 189 `excluded`, 120 `reviewed`. Sixteen are licensed under "the World Monitor agreement", which does not cover the owner. The profile applies a source-policy filter from the manifest's `license` and `status` fields.
- **AGPL.** A private modified deployment that only the owner uses needs no source offer to others ([self-hosting](../../self-hosting.mdx)); the fork is public anyway.

## Intelligence layer

Goal: turn many reports into a few evidence-linked events, keep uncertainty visible, and never present generated text as verification.

### Reuse map

| Capability | Exists | Where |
|---|---|---|
| URL canonicalization | Partial (not at ingest) | `shared/article-identity.js` |
| Story similarity | Yes | `shared/story-identity.js` (server), `shared/news-clustering-core.js` (client and MCP), `scripts/lib/brief-dedup.mjs` (digest embeddings) |
| Syndication and publisher families | Yes | `shared/syndication.js`, `shared/publisher-families.js` |
| Source tier and credibility | Yes | `shared/source-tiers.json`, `shared/news-credibility.js`, `shared/source-provenance.ts` |
| Corroboration | Yes | `server/_shared/corroboration.ts` |
| Impact and importance | Yes (several) | `computeImportanceScore` in `server/worldmonitor/news/v1/list-feed-digest.ts`, `scoreImportance` in `scripts/_clustering.mjs`, CII, hotspot escalation |
| Momentum | Partial | `src/services/velocity.ts`, story lifecycle |
| Trend and anomaly | Yes | `shared/keyword-spike-core.js`, temporal-baseline z-scores |
| Grounded briefs with citations and abstention | Yes | country brief, `scripts/_insights-brief.mjs`, `shared/brief-llm-core.js`, `shared/brief-claim-rules.js` |
| LLM chain | Yes | `server/_shared/llm.ts` |

The three similarity definitions are separate on purpose (`shared/news-clustering-core.js` header). Do not merge them without a product decision.

### Gaps to build

1. A durable **event object**: multi-story, with an evidence timeline and a per-event confidence.
2. A **novelty** score. Only a console prototype exists in `src/services/parallel-analysis.ts`.
3. A per-source **track record**.
4. **Crypto risk alerts**: depeg notifications, volatility, funding and open-interest stress. Liquidation data has no source yet.
5. An **AI/tech event detector** and model-release tracker.
6. **Numeric alert thresholds** and an alert delivery path that does not need Convex. [Early indicators](#early-indicators) gives the default thresholds.
7. A **move-to-news linker**: from an indicator to the stories around it (see [News link rule](#news-link-rule)). Built for the Lite UI in `src/lite/data/news-link.ts` (step 1); the story-to-indicator direction exists for prices only.

### Scoring model

Keep component scores interpretable instead of one opaque "AI score": confidence, impact, relevance (watchlist), novelty, momentum. Start rule-based and adjust from feedback. Introduce learned ranking only after enough reviewed outcomes exist to measure false positives, missed events, bias and alert fatigue.

### Briefing contract

Each briefing states the development with its timestamp, keeps confirmed information and attributed claims separate, says what changed since the last brief and why it matters to the watchlist, gives confidence and open questions, and links its sources. AI does extraction, clustering help, summaries and question answering over cited records. It does not invent sources, silently merge conflicting events, make ungrounded forecasts, or take trading or operational decisions.

### Evaluation

| Area | Measure |
|---|---|
| Noise reduction | Headlines per retained event; duplicate suppression rate |
| Timeliness | Ingestion-to-display and alert latency against the domain targets |
| Cluster quality | Sampled precision and recall; merge and split corrections |
| Source quality | Corroboration rate; later correction rate |
| Ranking quality | Top-N relevance review; alert dismiss and mute rate |
| Briefing quality | Citation coverage; factual error rate; usefulness rating |

## Phase plan

| Phase | Scope | Exit condition |
|---|---|---|
| 0. Repository review | This document | Done |
| 1. Profile shell | `VITE_LITE_PROFILE`; Lite panel and layer defaults; Lite Desk preset; the five cross-variant panels; access gate at deploy time | Done in code: the dashboard boots into the Lite layout with the flag on and is unchanged with it off (`tests/lite-profile.test.mts`, `verify-worldmonitor` step `lite-profile.mjs`). The access gate is set up when deploying |
| 1b. Lite UI | `/lite`: the cross-domain Briefing home and three child screens, real data where a source exists, labelled samples elsewhere (see [Lite UI](#lite-ui-lite)) | Done in code: `tests/lite-ui.test.mts`, `tests/dom/lite-ui.test.mts`, `verify-worldmonitor` step `lite-ui.mjs` with the flag on and off |
| 1c. Early indicators | The [Early indicators](#early-indicators) catalogue, linked to the news, in its build order | Each indicator renders from its feed with its linked news or "No linked news found"; trigger rates reviewed with the owner |
| 2. Core feeds on the owner's stack | Render services for the seeder allowlist; health key subset; source-policy filter; verify how much general news the `full` digest still carries | Lite panels fresh in `/api/health`; no unlicensed sources |
| 3. Event intelligence | Event object and timeline, novelty, crypto-risk and AI-event detectors, non-Convex alerts (Supabase gate) | Sampled cluster and alert quality meet agreed targets |
| 4. Briefings and trends | Lite brief built on the existing citation-checked brief code | Briefing accuracy and usefulness reviewed |
| 5. Harden | Backups, R2 archive if replay is needed, cost review | Recovery and upgrade path tested |

## Corrections to the original proposal

- The domain scope, removals and most widgets are configuration of the existing `full` variant, not a rebuild.
- There are no sports, entertainment or celebrity feeds to remove.
- PostgreSQL, a work queue and an object store are not needed to start: every handler reads Redis. They enter at phase gates.
- Most of the intelligence layer exists. The real gaps are the event object, novelty, source track record, crypto and AI alerts, and non-Convex alerting.
- Without Convex, alerts, preference sync, `intelHistory` and entitlements do not work. The proposal did not account for this.
- "World Monitor Lite" may not be used as a public product name without permission.

## Rejected alternatives

- **A new `lite` variant.** About 30 registration points (variant list, CORS, Convex preference variants, digest editions, desktop download list, locales, SEO, e2e). About 21 `SITE_VARIANT === 'full'` checks gate CII, intelligence and theater loading (for example `src/app/data-loader.ts` CII refresh and the intelligence refresh in `src/App.ts`), so a new variant would silently lose that data. It also multiplies upstream merge conflicts.
- **A mission preset alone.** Presets are one-off rewrites of local state, not defaults, and cannot gate custom features or seeders. The profile still ships a preset for re-applying the layout.
