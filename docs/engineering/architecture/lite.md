# World Monitor Lite profile

Status: accepted scope and architecture, 2026-11-07. Phase 0 (repository review) is done. Phase 1 (profile shell) is implemented in code; the access gate is configured at deploy time.

**2026-11-18: Lite is the product.** The owner dropped upstream sync and keeps only World Monitor's ingestion architecture. The [refactor plan](../plans/2026-11-18-001-refactor-lite-monorepo-plan.md) removes the old dashboard, the flag-off paths and the surfaces Lite does not use, then moves the repository to npm workspaces with Turborepo and the web app to Vite 8. Hosting is decided last. Phase 1 removed the dashboard (1a), the unused surfaces (1b, 1c) and the profile flag and site variants (1d), so the Lite UI is the only web app and needs no flag. Sections below that describe the flag, upstream parity or dashboard panel IDs record the original scoping; [Legacy features](../product/legacy-features.md) catalogues what leaves and how to bring it back.

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
| Name and branding | Keep "World Monitor". The instance is private and gated to the owner, not offered to others (the trademark policy, `docs/trademark-policy.mdx` in git history before refactor 1c-3). If it is ever opened to other people, switch to a distinct name with "Based on World Monitor" attribution. |
| Variant | No site variants. The original decision kept the `full` variant and added no `lite` variant; refactor Phase 1d removed `VITE_VARIANT`, `SITE_VARIANT` and the variant-host redirects. |
| Upstream sync | Dropped (2026-11-07). The owner builds their own dashboard and keeps World Monitor's ingestion architecture: seeders and relay → Upstash Redis → API handlers, the proto contracts and the `packages/shared/` intelligence modules. Merge cost with upstream no longer constrains structure. |
| Lite mechanism | A deployment profile: one build/deploy env flag on the owner's deployment turns on the three-domain defaults and the owner's custom features. With the flag off, behavior is identical to upstream. Superseded by the upstream-sync decision: refactor Phase 1d removed the flag (`VITE_LITE_PROFILE`) and its flag-off paths; Lite work needs no flag. |
| Repository layout | npm workspaces + Turborepo (`apps/web`, `apps/ingest`, `apps/relay`, `packages/contracts`, `packages/server`, `packages/shared`, `packages/client`), per the [refactor plan](../plans/2026-11-18-001-refactor-lite-monorepo-plan.md) (2026-11-18). |
| Web bundler | Vite 8 (Rolldown) with `@preact/preset-vite` (2026-11-18). Not Turbopack: it is Next.js-only and needs React. |
| "For me only" | An access gate in front of the owner's domain. |
| Hosting | The owner's managed stack (see [Platform map](#platform-map)). The Docker compose stack stays a secondary option. Revisited last in the refactor (Phase 4): the owner pays for Vercel Pro and wants free tiers elsewhere, with an Oracle Cloud Always Free VPS replacing anything Render or Cloudflare would charge for. |
| AI models | External APIs allowed, through the existing chain in `packages/server/_shared/llm.ts`. Keys and per-call cost are an operating concern. Local Ollama stays optional. |
| Conflict data | No ACLED (2026-11-07): API access is hard to obtain. UCDP (`seed-ucdp-events`, `UCDP_ACCESS_TOKEN`) supplies the map events and each country's conflict floor. GDELT country events (`seed-gdelt-bulk-materializer`, no key) supply the realtime conflict and unrest signal; `get-risk-scores.ts` scores them whenever ACLED returns no events. UCDP alone cannot do this, because it is an annual release. Health reports ACLED as `not_configured`, which is not a failure, and the `[CII] ACLED returned 0 events` log line is expected. |
| Lite map | MapLibre on OpenFreeMap vector tiles, solid land (2026-11-07): free, no key, no usage limits, and already the dashboard's fallback basemap. The style (`apps/web/src/lite/map/style.ts`) draws only land, water, country borders and place names, colored from the Lite `@theme` tokens; markers, the popup a marker click opens, zoom buttons and the OpenStreetMap credit are Tailwind-styled HTML. No popup is open until a marker is clicked. A card shows every line in full, never clamped; past 340 px it scrolls under an overlay scrollbar (2026-11-10). On every Lite map the marks carry no name beside them and the legend stays closed behind a "Legend" button, so nothing covers the map until the user clicks (owner's decision, 2026-11-08); the map body has a top border under the card header. MapLibre loads only when a screen with a map opens (Geopolitics, Finance or Technology). If OpenFreeMap is down, the map shows the background with markers still placed. Data shading (the reported-violence country fill, GPS-interference hexagons, DDoS shading) is a MapLibre fill layer coloured from the theme tokens (owner's decision, 2026-11-08); every marker follows the map marker grammar below; the country shapes come from `/data/countries.geojson`. Markers, cards, controls and credits stay Preact. |
| Conflict map design | The owner's design (2026-11-08). UCDP locations are background aggregates (faint red circles) sized by deaths, clustered by zoom (`supercluster`) with the toll printed inside; a click zooms a cluster in or opens a location's event card. Curated hotspots are diamonds, coloured by the dashboard's live escalation score (`apps/web/src/lite/data/escalation.ts` over `packages/shared/analysis-hotspot-escalation.ts`: news in the last 2 h, CII, unrest, earthquake and military-flight convergence within 150 km, flights within 200 km; no vessels or session history). All curated hotspots are drawn, as on the dashboard, as 16 px judgement diamonds; from 3/5 (elevated) they are amber (red at 5/5) and drawn on top, and below it they are grey diamonds under the UCDP circles, labelled watch or stable in their card; the name is in the card, not beside the diamond. Cards open on click beside the marker with a leader line. The time range 6h, 24h and 7d (default 7d; 30d dropped 2026-11-10, see [Screen design](#screen-design)) sits on the map. It filters the digest-driven parts of the screen and the UCDP events, all counted back from now (owner's choice, for consistency across the screen). UCDP dates events by day, so an event counts when any part of its day falls inside the range. UCDP is a delayed release (GED Candidate, monthly, up to a month behind), so short ranges are often empty; the map's subtitle then names UCDP's newest date. The indicator designs supersede the range and UCDP parts of this row: see Indicator screens below; the code follows in build step 2. A point with two or more UCDP events gets a summary card (date span, violence types, actor pairs, sources), and UCDP's `XXX` codes for actors it cannot identify read "Unidentified group (UCDP XXX100)". |
| Map marker grammar | The owner's design "Spec — Map markers" (2026-11-10): one grammar for the Geopolitics, Finance and Technology maps, so a reader who learns one map can read the other two. **Geometry** is how we know the place: exact coordinates get a marker, a country or region an area, routes and cables a line; a country-level fact is never pinned to a point. **Shape** is what kind of thing it is: an event (16 px rounded square, 10 px Lucide glyph in dark ink: one thing happened here), an asset (14 px outlined square, 9 px glyph: a place we watch), an aggregate (circle, area ∝ count, 12–40 px on a square-root scale, the count printed from 22 px: many things) or a judgement (16 px diamond with a centre dot: an analyst's call). **Fill** is how sure we are, for aggregates: reported (20% fill with the outline: unverified) or background (10% fill, 30% outline: verified but weeks old). An event is always solid in its state colour under a dark glyph, and its card says how sure we are ("reported by transponder", an ended or dated notice): a translucent event under the dark glyph could not be seen on the dark map (owner's decision, 2026-11-19). **Colour** is state, never domain: grey normal, amber elevated, red critical; the domain lives on the card chip. Selected adds a 2 px white ring; a late feed draws its markers at 45% opacity. An asset in its normal state is background: it sits under every other mark until a signal turns it amber or red (2026-11-10, Technology map). Intensity areas (GDELT reported violence, DDoS share) share one blue ramp; status areas (sanctions, GPS cells) use a state-colour outline; lines take state colour. Tokens are `--color-mark-normal` `#9aa2ae`, `--color-mark-elev` `#e8c547`, `--color-mark-crit` `#f2555a`, `--color-mark-ink` `#0a0c0f`, `--color-mark-ring` `#ffffff` and `--color-ramp-1..4` `#26385a` `#3e6bb0` `#7fb2ff` `#cfe2ff` (`apps/web/src/lite/lite.css`); the components and the glyph catalogue are in `apps/web/src/lite/map/marks.tsx`, and every legend and layers-popover row draws its swatch with them, states in the order normal, elevated, critical. Do: one glyph per marker with the detail in the card; label only the selected marker and the top few by impact; collapse overlapping markers of one type into an aggregate with a count. Don't: colour a marker by domain, invent a new shape for a new layer (pick one of the four, add a glyph), pin a country-level fact to a point, or use red for anything not critical. Owner's answers the same day: a curated hotspot is red at 5/5, amber at 3–4 (orange folds into amber) and grey below; Finance's "market-moving geopolitics" layer stays N/A, with only its swatch in the grammar. |
| Early indicators | The owner's priority (2026-11-08): indicators that arrive first, each linked to the news around it, so a price move or an event can be understood, not only seen. Each indicator has a written trigger rule, its source and timestamp, and a "reported" or "verified" label. Without linked news it says "No linked news found" and never guesses a cause. The catalogue, the defaults and the build order are in [Early indicators](#early-indicators). |
| Indicator sources | The owner holds free keys for Cloudflare Radar, NVD, abuse.ch, AbuseIPDB and AlienVault OTX (2026-11-08), so the Technology and AI indicators can be built. FAA NOTAM access is not self-service and has been requested; airspace closures wait for it. Keys live in the deployment's env and, for local seeder runs, in `.env.local`; they are never committed or printed. |
| Indicator screens | The owner's designs (2026-11-08) for the Briefing, Geopolitics, Finance & Crypto, Technology & AI and the layers popover. Every domain screen has a map with a layers popover, an indicator panel beside it and its domain panels below; the Briefing has a fired-indicators block with a feed-health strip. Owner answers: VERIFIED is kept for independently verified datasets (UCDP), and prices are labelled MARKET DATA; a stablecoin fires at 0.5% from $1; Finance shows the 1D range only; the Geopolitics range is 6h, 24h and 7d (12 months dropped; 30d dropped 2026-11-10 because its shading repeated 7d), and UCDP shows as the verified background whatever the range; "Primary-source regulation" stays a labelled sample until a regulation feed exists. Details in [Screen design](#screen-design). |
| Watchlist stand-in | Until the watchlist exists (open decision 1), the indicators that fire "for a watchlist country" read the curated hotspots' countries (`packages/shared/hotspot-country-map.ts`) instead, and say so (owner's decision, 2026-11-08). Embassy security alerts are the first. |
| Decision tiers | The owner reads Lite as an investor and board member (2026-11-19): every indicator states the decision it informs and is tagged **check daily** or **check weekly**. Analyst-level inputs (military aircraft, GPS interference, attack infrastructure) feed the region and infrastructure views instead of standing as decisions of their own. The work runs in two milestones: Phase 1 improves the indicators from data the repository already fetches (issues #113–#121), then Phase 2 adds new sources (#122–#142). See [Decision tiers](#decision-tiers). |
| Indicator sources and priority | New indicator sources are free (2026-11-19). An issue is high priority when its decision value is high and it needs no key, or a key the owner already holds, because it builds fast; a new free key, a weekly or monthly signal or a fragile source makes it medium; scraping, an unclear licence or low value makes it low. Sources free only for non-commercial use (OpenSanctions, ransomware.live, ACLED) are left out, because board use may count as commercial. See [Sources left out](#sources-left-out). |
| Geopolitics indicator panel | Grouped by the region strip's regions (`ESCALATION_REGIONS`), not one flat list (2026-11-19): every Geopolitics indicator is tied to a country, a hotspot or a sea area, so several cards often describe one situation, and a decision-maker reads it as one. Built in #116; see [Screen design](#screen-design). |
| Taiwan Strait trigger | PLA aircraft sorties or PLAN ships at 1.5 times their 30-day median or more, with at least 10 aircraft or 5 ships (owner's choice, 2026-11-09). The seeder keeps the median of prior reporting days, not an average, and above the median alone would fire about every other day. |
| Sources screen | The owner's design (2026-11-08) for "Sources & ingestion", trimmed by the owner: the KPI strip (reports, duplicates merged, ingest-to-display latency, stale feeds, archive size), the 24-hour volume bars, rate limits and quotas, retries, request logs and runbooks, and every action (retry, pause, add source, edit policy) are left out. The screen is read-only, and its status comes from data the Lite UI already reads, with no new endpoint. Details in [Screen design](#screen-design). |
| Front page | A dedicated Lite UI at `/lite`, built from the owner's designs with Preact and Tailwind CSS. It is the only web app since refactor Phase 1 removed the dashboard (2026-11-18). See [Lite UI](#lite-ui-lite). |

### Open decisions

These were open in the proposal and are still open:

1. The initial watchlist: countries, conflicts, assets, institutions, companies, AI topics.
2. Alert latency and false-positive tolerance per domain. [Early indicators](#early-indicators) sets default triggers for the owner to adjust.
3. Budget and licensing posture for market, news and specialist data.
4. Who reviews source policy, corrections and high-impact alert rules (default: the owner).

## Scope by domain

Panel and layer IDs are the keys in `src/config/panels.ts` and `packages/client/config/map-layer-definitions.ts`. "Missing from `full`" means the panel exists only in another variant and must be added to `FULL_PANELS` before the profile can show it.

### Geopolitics and conflicts

Event-centric, not headline-centric. Refresh target: 5 to 15 minutes.

| Proposal widget | Existing building blocks | Gap |
|---|---|---|
| Priority event feed | `insights`, `strategic-posture`, `cross-source-signals` | No durable event object (see [Intelligence layer](#intelligence-layer)) |
| Conflict map | layers `conflicts`, `hotspots`, `military`, `ciiChoropleth`, `sanctions`, `ucdpEvents` | — |
| Escalation tracker | `cii`, `strategic-risk`, `escalation-correlation`, `ucdp-events` | 24h/7d change exists for CII; not per event |
| Regional timeline | `threat-timeline`, story lifecycle (`packages/shared/story-phase.js`) | No multi-story event timeline |
| Watchlists and alerts | followed countries, `monitors` | Alert delivery depends on Convex (see [Platform map](#platform-map)) |

### Finance and crypto

Contextual monitoring, not a trading terminal. Refresh target: 1 to 5 minutes for prices, event-driven for news.

| Proposal widget | Existing building blocks | Gap |
|---|---|---|
| Market pulse | `markets`, `macro-signals`, `fear-greed` | — |
| BTC/crypto detail | `crypto`, `etf-flows`, `stablecoins`; Hyperliquid positioning stress (`scripts/seed-hyperliquid-flow.mjs`) | `crypto-news` missing from `full`; no liquidation data |
| Macro and calendar | `economic-calendar`, `macro-signals` | `centralbanks` missing from `full` |
| Market-moving events | market news in the digest; seeded crypto, stock, index, commodity and FX quotes for the price links; freight indices (`supply_chain:shipping:v2`) | Rows are deduplicated stories, not clustered events; the freight indices are not linked to shipping stories yet |
| Risk alerts | stablecoin depeg status (`packages/shared/stablecoin-classifier.cjs`), relay `market_alert` on 24h moves | Depeg never notifies; funding and open interest are display-only; no volatility model |

Market commentary is labelled as analysis, not investment advice. Price and derivatives data must be licensed and fit provider rate limits.

### Technology and AI

Material capability, policy and business changes, not product marketing. Refresh target: 15 to 60 minutes.

| Proposal widget | Existing building blocks | Gap |
|---|---|---|
| AI/tech event feed | `ai`, `tech` | Not grouped into events |
| Model and product tracker | `seed-ai-models` (#126) | Built: the Tech model tracker reads it |
| Policy and governance | `policy` (AI Policy & Regulation news), `ai-regulation`, `packages/client/config/ai-regulations.ts` | Both missing from `full`. `full` has `trade-policy`, a different panel |
| Research radar | research service (`packages/server/worldmonitor/research/v1/`: arXiv, Hacker News, trending repos) | Data exists; no panel on `full` |
| Infrastructure and business | `hardware`, `tech-readiness`, layer `datacenters`, `packages/client/config/ai-datacenters.ts` | `hardware` missing from `full` |

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
  - the instrument or its tickers (`packages/shared/ticker-extract.js`, `namedInstruments` in `apps/web/src/lite/data/prices.ts`);
  - the instrument's named drivers, from a fixed list per instrument (for example the 10-year yield: Fed, Treasury, CPI, PCE, payrolls, auction);
  - the country or hotspot (`packages/shared/country-headline-match.ts`, the hotspot keywords used by the escalation score);
  - named entities (`packages/shared/entity-registry.js`).

  Matches rank by match strength, then closeness in time, then corroboration (`assessCorroboration`). The panel reads "Reported around the move", never "caused by".
- **News → indicator.** A story shows the indicators that moved around it. Finance already does this for prices (market-event price links); the same link extends to yields, macro releases and the Geopolitics and Tech indicators.
- **No link.** An indicator with no matching story says "No linked news found". An unexplained move is a signal in itself, so it is not hidden.
- **AI summaries.** A one-line "why" may be generated only from the linked stories, with citations, through the grounded brief code (`packages/shared/brief-llm-core.js`, `packages/shared/brief-claim-rules.js`), and labelled as model inference.

### Decision tiers

The owner's view (2026-11-19): an indicator earns its place by the decision it informs. **Check daily** indicators can need action the same day; **check weekly** indicators shape plans. Some feeds are inputs, not decisions: military aircraft, GPS interference and reported violence feed the region level, and attack infrastructure stays for the security view. "Built" means the indicator renders today; an issue number means it is planned, with its rule in the [Catalogue](#catalogue).

**Geopolitics and conflicts.**

| Indicator | Tier | Decision it informs | Status |
|---|---|---|---|
| Chokepoint transits | Daily | Reroute freight, build inventory, hedge oil | Built |
| Region escalation level | Daily | Hold back exposure to a region, or keep watching | Region strip, panel grouped by region (#116) and indicator (#117) built |
| New sanctions | Daily | Review customers, suppliers and partners in the country | OFAC indicator built (#118; the data also shades the Finance map); EU built (#129); UK #140 |
| Export controls and tariffs | Daily | Change sourcing and pricing; check a product can still be sold | Built (#122); new restricted parties built (#123) |
| Taiwan Strait activity | Daily | Semiconductor supply and Asia exposure | Built |
| Travel advisories and embassy alerts | Daily | Staff safety and travel freezes | Embassy alerts built (four countries); travel advisory changes built (#124) |
| Elections and changes of government | Weekly | Political risk where the owner has exposure | #141 |

**Finance and crypto.**

| Indicator | Tier | Decision it informs | Status |
|---|---|---|---|
| Treasury yields and the 2s10s spread | Daily | Cost of capital, valuations, when to refinance | Built |
| Credit spreads | Daily | The earliest sign of credit stress: hold more cash, delay raising money | Built (#114) |
| VIX and dollar index | Daily | Risk appetite; a strong dollar squeezes foreign revenue | Built (#115) |
| Macro release surprise | Daily | The expected rate path | Built (#128): against the Kalshi forecast for CPI and payrolls, the prior print for PCE |
| Rate decisions and expectations | Daily | Hedging and debt timing | Fed decision odds built (#125); Fed and ECB decisions built (#130) |
| Price moves (Brent, gold, S&P 500, BTC) | Daily | Input costs, safe-haven demand, risk appetite | Built |
| Crypto health (ETF flows, depegs, perp positioning) | Weekly | Crypto exposure | Built; stablecoin supply #137 |
| Freight (SCFI, Baltic Dry) | Weekly | Goods inflation ahead | Built |
| Company material events and earnings dates | Weekly | Peer and supplier risk | 8-K filings built; earnings dates #138 |
| Fed liquidity | Weekly | The liquidity behind risk assets | #136 |
| US oil inventories | Weekly | Energy cost | #139 |

**Technology and AI.**

| Indicator | Tier | Decision it informs | Status |
|---|---|---|---|
| Cloud and AI service outages | Daily | Continuity, dependence on one vendor, service credits | Built |
| Exploited vulnerabilities in the owner's vendors | Daily | Patch now, accept the risk, or ask the vendor | KEV built; starter vendor watchlist built (#119) |
| Breaches at peers and suppliers | Daily | Third-party risk, insurance, questions to suppliers | 8-K item 1.05 on Tech built (#120); HIBP breach list built (#131) |
| Internet outages and cable cuts | Daily | Regional continuity | Built |
| AI model releases and prices | Weekly | Build or buy, vendor choice, cost assumptions | Built (#126); open-weight releases built (#132); lab announcements built (#133) |
| AI and data regulation | Weekly | Compliance timeline | Built (#127); the curated list stays as background milestones |
| Chip supply and export controls | Weekly | Semiconductor supply | TSMC revenue built (#134); controls through #122 |
| Hyperscaler capex and AI funding | Weekly | Where AI money is going | #135; Form D filings #142 |

The Briefing gets a "Daily check" filter (#121). Phase 1 (#113–#121) uses data the repository already fetches, or keys the owner holds; Phase 2 (#122–#142) adds the free sources, high priority first (see [Owner decisions](#owner-decisions)). Each Phase 2 host still passes the source-policy filter (`packages/shared/source-attribution-manifest.json`) in its build PR.

### Catalogue

Defaults are a starting point (open decision 2). Each build PR runs its seeders locally first and reports how often the trigger would have fired. "Key" names the credential the seeder needs; none is printed or committed. A row whose feed starts "Planned" is not built yet: it names its issue, and its trigger is a default for the owner to confirm. The free sources were checked with a live request on 2026-11-19 unless the row says otherwise.

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
| GPS interference | `fetch-gpsjam` (gpsjam.org, daily map cells of about 1,800 km² with the share of aircraft reporting bad GPS; medium 2–10%, high above 10%; no key). The previous day's high cells are kept in `intelligence:gpsjam:high-cells:v1` ([Baselines](#baselines)) | A high cell within 200 km of a curated hotspot that had none the day before, or a region's high cells up 50% or more on the day (at least 5). Without the calendar day before it reads "Building history", never quiet | Reported (gpsjam.org, aircraft transponders) |
| Airspace closures | `seed-notam-nms` (FAA NOTAM service; key `NOTAM_KEY`, `NOTAM_SECRET`; access requested from the FAA, so built last in step 2) | A new closure over a watchlist country or a curated hotspot | Official notice |
| Incidents at sea | `seed-ukmto-incidents` (UKMTO; no key) | Any new incident: one reported in the last 24 h | Official notice |
| Taiwan Strait activity | `seed-cross-strait-activity` (Taiwan MND daily report) | PLA aircraft sorties or PLAN ships at 1.5 times their median over the prior 30 reporting days, with at least 10 aircraft or 5 ships (see Owner decisions). Fewer than 30 reporting days reads "Building history" | Official report |
| Embassy security alerts | `seed-security-advisories` (US embassies) | An alert in the last 24 h for a watchlist country (until the watchlist exists, a curated hotspot's country; see Owner decisions). The seeder reads 13 embassy feeds, which cover four hotspot countries (Ukraine, Mexico, Pakistan, the UAE); the quiet line names the covered ones | Official notice |
| Verified violence | `seed-ucdp-events` | None: background, released monthly up to a month behind (GED Candidate) | Verified (UCDP) |
| Region escalation | The region strip's level: the region's highest live hotspot score, rounded (`apps/web/src/lite/data/escalation.ts`; rule in `apps/web/src/lite/data/region-escalation.ts`). No server keeps past levels yet, so the earlier readings live in the viewer's browser (one per 15 min, kept 24 h); the card says so. A reading is kept only once the risk scores and the news have loaded, and compares only with readings missing the same score inputs, so a partial score never reads as a rise | A region's level rises one step or more and reaches Elevated or higher, against the earliest reading this browser kept in the last 24 h that is at least 30 min old. The card names the hotspot that leads and the score inputs that moved 5 points or more | Estimated (derived score) |
| New sanctions | Built for OFAC (#118): `seed-sanctions-pressure` (bootstrap key `sanctionsPressure`, every 6 h; SDN and Consolidated lists only; the feed carries the 60 newest entries, and a card says when a batch was cut short); one card per country, naming the programmes, the count and the first names, with news that names the country and sanctions. Built for the EU (#129): `seed-eu-sanctions` (every 6 h), key `sanctions:eu-additions:v1` (on-demand bootstrap `euSanctions`): the European Commission's consolidated list of persons, groups and entities subject to EU financial sanctions (Financial Sanctions Files, XML v1.1, behind the public token the Commission publishes on data.europa.eu; no key; Commission reuse policy, the host stays in terms review in the manifest). Each run compares the list's entity ids with the last run's: an id not seen before is a new listing, dated by the run that first saw it; the first run only sets the baseline, and a cut-off file (no closing tag; the 26 MB file can take two minutes) or a list much shorter than the last one fails the run, so a broken download never resets it. One card per country, naming the regimes, the count, the first names and the regulation. Planned: the UK OFSI list (its old public link refused access, so the current one is found first; #140) | OFAC: a designation first seen on the seeder's latest run, or dated in the last 24 h, for a country. EU: a listing first seen in the last 24 h for a curated hotspot's country (the watchlist stand-in), or every country's once 5 or more arrived in 24 h. UK, compared day by day: a new listing for a watchlist country, or 5 or more in a day | Official |
| Export controls and tariffs | `seed-federal-register` (#122, every 2 h): the Federal Register API, documents of the Bureau of Industry and Security and the US Trade Representative over the last 30 days (no key; US government works, public domain), key `policy:federal-register:v1` (on-demand bootstrap `federalRegister`). It keeps rules, proposed rules, and notices that change controls or tariffs (Entity List and EAR notices; Section 301/232 actions, exclusions, modifications), and drops routine notices (information collection, meetings, rosters, advisory committees). The same key is meant to serve AI rules (#127) | A kept document published in the last 3 days, one card each: the source carries a date, not a time, so the owner's 24 h default becomes 3 days to cover a weekend. A country named in the title places the card under its region; linked news must use the document's trade or export-control words and name that country | Official notice |
| Restricted parties | Built (#123), on `seed-sanctions-pressure` (every 6 h), which already downloads the trade.gov Consolidated Screening List (about 34 MB, no key; US government data; the ITA Data API terms ask for the notice the Sources row shows) and keeps a run-to-run change history (`sanctions:changes:v1`, 90 days, with a hold when more than 5% of a list would vanish and a gap record when a list fails). After each history write it projects the last 7 days of additions to the BIS lists (Entity List, Denied Persons, Unverified, Military End User) and the State Department lists (ITAR debarred, nonproliferation) into `sanctions:csl-additions:v1` (on-demand bootstrap `cslAdditions`; at most 500 additions), with each list's size, source date and current gaps. OFAC additions stay on the New sanctions row. trade.gov lags the agencies: on 2026-11-20 its Entity List was last updated on 21 Aug 2026, months behind the latest BIS rules, which the Export controls row shows from the Federal Register | Any Entity List addition, or 5 or more additions for one country on one list, first seen in the last 24 h; one card per country (a party with addresses in several countries counts for each). News must name the country (or its adjective) and listing words. The quiet line names the Entity List's size and date, and any list not compared on the last run | Official |
| Travel advisories | `seed-travel-advisories` (#124, every 2 h), key `intelligence:travel-levels:v1` (on-demand bootstrap `travelLevels`; 14 days of changes, at most 300). US: the State Department travel advisory RSS register, read directly (no key; the JSON API at cadataapi.state.gov answered the same 218 advisories, but with FIPS country codes, so the register's names are mapped instead); a register naming fewer than 150 countries counts as a failed read. UK: the GOV.UK Content API (no key; Crown copyright, Open Government Licence): one index request lists every country page and its last update, and only pages updated since the last run are fetched for their `alert_status` flags, at most 40 a run, so the first baseline fills over about six runs. The previous levels live in `intelligence:travel-levels:state:v1` (30 days). A country seen for the first time sets its baseline (and "newly listed" counts only against a stored register of about the same size); a failed source, or a GOV.UK page without its flags, keeps its stored levels. The feed is as fresh as the older source's last good read: a source unread for more than 6 h fails the run, so health turns stale rather than the other source keeping it live. `seed-security-advisories` still keeps the current level per country for the risk scores | For a hotspot country (the watchlist stand-in): a US level that rises, or a country new to the register at Level 3 or 4; UK advice that adds a warning against all or all but essential travel (to the whole country or to parts); first seen in the last 24 h. One card per source and country. News must use travel-advice words. The quiet line names the US Level 4 count and any source not read or baseline still filling | Official notice |
| Elections | Planned (#141): IFES ElectionGuide (HTML only, no feed) or a curated list | An election within 30 days in a watchlist country | Reported (IFES) or curated |

**Finance and crypto.** Link window: 6 h before.

| Indicator | Feed | Default trigger | Label |
|---|---|---|---|
| Macro release surprise | `seed-economic-calendar`, actuals from FRED (`scripts/_econ-actuals.mjs`: CPI, PCE (`PCEPI`) and others); `seed-us-cpi` (key `FRED_API_KEY`). Forecast: `seed-macro-forecasts` (#128, hourly), key `economic:macro-forecasts:v1` (on-demand bootstrap `macroForecasts`): Kalshi's public market data (no key; the host `seed-rate-odds` reads; API terms under review in the source manifest), series `KXCPI` (headline CPI month on month) and `KXPAYROLLS` (the nonfarm payrolls change). Each release's "above X" ladder gives the implied median, interpolated between the rungs either side of 50%, with each strike read half a print step higher (CPI prints in 0.1 pt steps, so "above 0.3" means "0.4 or more"). A release counts only with 4 or more priced rungs and 5,000 or more contracts traded; the markets close a minute before the release, so the key is a 45-day log that keeps each release's last snapshot. A series with no open market (Kalshi answers a withdrawn series with an empty list) fails the run, so health turns stale; the card names the next release's forecast only from a read in the last 3 h, and judges a CPI or payrolls print only once the forecasts have loaded. Kalshi has no headline PCE market (only core), so PCE keeps the prior print | CPI 0.1 pt or more from the forecast, payrolls 50k or more, released in the last 3 days, when the forecast was read in the 24 h before the release. Without one (always for PCE), the prior print stands in (owner's choice, 2026-11-08): 0.2 pt or more from the prior print for CPI or PCE, 100k or more for payrolls, labelled with the reason. The card says which rule fired. Backtest on the last 12 settled releases (Kalshi prices an hour before close against the settled print): CPI fired 2 of 11 (October and June 2026), payrolls 8 of 11; the owner may want a wider payrolls trigger | Official data; the forecast is market data (Kalshi, implied forecast) |
| Treasury yields | `seed-us-treasury-par-yield` (daily; no key); the intraday 10-year from the `^TNX` quote | The 2-year or 10-year moves 10 bp or more in a day, or the 2s10s spread changes sign | Official data |
| Other government bonds | `seed-yield-curve-*` (DE, GB, JP and others) | A 10-year moves 10 bp or more in a day | Official data |
| Price moves | Seeded quotes (the existing risk alerts) | The existing fixed thresholds and BTC 2 h move over 4σ | Market data |
| Company material events | `seed-sec-8k-stream` (SEC 8-K filings; no key) | A filing in the last 24 h by a watchlist company. Until the watchlist exists (owner's choice, 2026-11-08): a company in the dashboard's default stock list (`packages/shared/stocks.json`, matched by name, since filings carry no ticker), or any filer reporting item 1.03 (bankruptcy), 1.05 (cyber incident), 2.04 (debt default) or 4.02 (restatement) | Official filing |
| Bitcoin ETF flows | `seed-etf-flows` (10 US spot bitcoin ETFs from `scripts/shared/etfs.json`, Yahoo daily bars; `ALPHA_VANTAGE_API_KEY` optional) | 8 or more of the ETFs flow the same way in a day | Estimated (from price and volume, not issuer-reported flows) |
| Stablecoin depeg | `seed-stablecoin-markets` (USDT, USDC, DAI, FDUSD, USDe; CoinGecko, CoinPaprika fallback; no key) | A tracked stablecoin more than 0.5% from $1 (owner's choice): the classifier's `SLIGHT DEPEG` or `DEPEGGED` (`scripts/shared/stablecoins.json`) | Market data |
| Perp positioning | `seed-hyperliquid-flow` (one venue, every 5 min: BTC, ETH, SOL, PAXG, oil, metals, natural gas, EUR, JPY; stress score from funding 30%, volume 25%, open interest 25%, basis 20%) | Stress score 60 or more (the seeder's `ALERT_THRESHOLD`) | Market data (Hyperliquid, one venue). No liquidation figures: no source has them |
| Container and bulk freight | `seed-supply-chain-trade` (`supply_chain:shipping:v2`: SCFI weekly on Fridays, Baltic Dry daily) | SCFI 5% or more week on week, or the Baltic Dry 5% or more in a day | Official (Shanghai Shipping Exchange) for SCFI; Market data for the Baltic Dry |
| Credit spreads | `seed-fred-rates` (FRED `BAMLH0A0HYM2` high yield and `BAMLC0A0CM` investment grade, the last 120 daily observations; key `FRED_API_KEY`), read through `GetFredSeriesBatch`. `seed-fear-greed` reads the same keys | High yield widens 20 bp or more in a day, or 50 bp or more in 5 trading days; investment grade widens 5 bp or more in a day | Market data (ICE BofA via FRED) |
| VIX and dollar index | `seed-commodity-quotes` (Yahoo `^VIX` in the commodity quotes, and `DX-Y.NYB` in the gold drivers, `market:gold-extended`; no key). When the quote has no `^VIX`, the VIX reads the latest FRED `VIXCLS` close from `seed-fred-rates` and names its date | VIX at 25 or above, or up 20% or more on the prior close (a fall never fires); the dollar index moves 1% or more either way in a day | Market data (Cboe via Yahoo, or via FRED; ICE dollar index via Yahoo) |
| Rate expectations | `seed-rate-odds` (#125, hourly), key `economic:rate-odds:v1` (on-demand bootstrap `rateOdds`, about 3 KB). Kalshi's public market data, series `KXFED` (no key; the host `seed-prediction-markets` already reads; Kalshi's API terms are under review in the source manifest): for the next three meetings, the ladder of "upper bound above X%" markets gives the probability of each outcome, from the last trade and from Kalshi's previous (day-earlier) price, so a one-day shift needs no stored history. A rung that trades out of order is capped by the rung below it. FRED `DFEDTARU` (the current upper bound; `FRED_API_KEY`) tells a hold from a move; a failed FRED read keeps the last known value, and the target's date is the key's content age (5 days), so a target carried that long reads as stale content in health. When the ladder has no outcome at the current target, the move odds are not shown. One venue, a free stand-in for CME FedWatch | For the next meeting: the probability of a move (anything but the current upper bound) changes 15 points or more against Kalshi's previous price, or the most likely outcome changes. Outcomes read "Hold", "Cut 25 bp", "Hike 50 bp". Without the current target only the most-likely rule can fire, and the quiet line says so | Market data (Kalshi, one venue) |
| Central bank decisions | Built (#130): `seed-central-bank-decisions` (every 30 min), key `economic:central-bank-decisions:v1` (on-demand bootstrap `cbDecisions`, a few KB). The meeting dates were already in `seed-economic-calendar` (its FOMC and ECB rows), so this seeder reads only the decisions: the Federal Reserve's monetary policy press release RSS (each "FOMC statement" item) and the ECB's press RSS (each "Monetary policy decisions" item); no key; both hosts are in terms review in the manifest. It reads each new statement page for the action, the move in bp and the new rate (the Fed's target range, the ECB's deposit facility rate), and for the Fed the vote and any dissent. The ECB feed holds only two to three weeks, so the decisions are kept as a log (ten per bank). A page that cannot be read or whose wording is not recognised is kept as "decision out" and read again on later runs for three days (a page a run never reached is read on the next one). A 200 answer with no RSS items counts as a failed read. One feed failing keeps its decisions for one health budget (90 min); past that the run fails, so health follows the older feed, and the Lite card dates the feed by its older read. The macro calendar shows each meeting's decision (ACTUAL the rate it set, PRIOR the bank's decision before it, "—" if that one was not read, CHANGE the move) and keeps the next FOMC and ECB meeting listed while it is inside the calendar's 31 days | A Fed or ECB decision published in the last 24 h: one card per bank, naming the move and the new rate, the statement's decision sentence, and for the Fed the vote and dissent; a fired card pins at the bank on the Finance map. The quiet line names each bank's last decision and next meeting (or that it is beyond the calendar's 31 days), and a feed that could not be read; a fired card names the other bank's unread feed too | Official |
| Fed liquidity | Planned (#136): NY Fed Markets API (reverse repo; no key) and FRED `WALCL` (balance sheet, already read by `seed-fear-greed`) | The balance sheet moves 50 bn USD or more in a week, or the reverse repo 100 bn USD or more in a day | Official data |
| Stablecoin supply | Planned (#137): DefiLlama stablecoins API (no key) | Total supply moves 2% or more in 7 days, or a top-5 coin 5% or more | Market data (DefiLlama) |
| Earnings dates | Planned (#138): `seed-earnings-calendar` (Finnhub; key `FINNHUB_API_KEY`, new) joins the Lite seeders | None: the next two weeks for the default stock list (the watchlist stand-in) | Reported (Finnhub) |
| US oil inventories | Planned (#139): EIA API, weekly petroleum status (key `EIA_API_KEY`, new; not tested without a key) | Crude stocks change 5 million barrels or more in a week | Official data (EIA) |

**Technology and AI.** Link window: 12 h before. The linked news is the tech digest, which includes Hacker News: an outage, a hack or an exploited vulnerability links to the stories there that name its vendor, network or country.

| Indicator | Feed | Default trigger | Label |
|---|---|---|---|
| Internet and power outages | `seed-internet-outages` (Cloudflare Radar; key `CLOUDFLARE_API_TOKEN`) | A new country or network outage. The card shows its type, scope and stated cause (power cut, cable cut, government shutdown), not a percentage drop: Cloudflare's outage notices and traffic anomalies carry none | Reported (Cloudflare) |
| Cloud and AI service outages | `infra:service-statuses:v1` from `packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts` (public status pages of AWS, Azure, Google Cloud, Cloudflare, GitHub, OpenAI, Anthropic and others; no key). `seed-service-statuses` warms the upstream production URL, so the owner's deployment warms its own endpoint | A watched provider reports a partial or major outage | Official (provider status page) |
| Exploited vulnerabilities | `seed-cve-reference` (CISA KEV subset of NVD; key `NVD_API_KEY` optional) | A new known-exploited CVE (added in the last 3 days). Since #119 an addition whose vendor is on the starter vendor list (`packages/client/config/vendor-watchlist.ts`, the stand-in until the owner's watchlist exists; the card says so) ranks first and is marked. The vendor is KEV's own `vendorProject`, which `seed-cve-reference` reads from the CISA KEV catalog (cisa.gov, or its GitHub copy `cisagov/kev-data` when cisa.gov refuses), because NVD's CPE vendor stays empty until NVD analyses the CVE; NVD's vendor is the fallback. Catalog additions NVD has not flagged yet also show, without a CVSS score | Official (CISA) |
| Peer and supplier cyber incidents | `seed-sec-8k-stream`, item 1.05: its own Tech indicator since #120 (it also fires on Finance as a key 8-K item). Every filer counts, since third-party risk reaches beyond the stock list; a filer on the default stock list is named as such, and news links by the company | Any 8-K reporting item 1.05 in the last 24 h | Official filing |
| Data breaches | Built (#131): `seed-breaches` (every 3 h), key `cyber:breaches:v1` (on-demand bootstrap `dataBreaches`, a few KB). Have I Been Pwned's breach catalogue (`/api/v3/breaches`, no key; CC BY 4.0: name HIBP as the source and link to haveibeenpwned.com; the host stays in terms review in the manifest until the owner marks it reviewed). The seeder reads the whole catalogue (about 1,050 breaches) and keeps those listed in the last 30 days; a catalogue under 500 breaches or an answer that is not JSON fails the run. Breaches are often listed days or years late, so the card shows both dates. The vendor domains are on the starter vendor list (`packages/client/config/vendor-watchlist.ts`, the stand-in until the owner's watchlist exists) | A breach listed in the last 3 days with 1 million or more accounts, or at a starter-list vendor's domain or a subdomain of it; spam lists and fabricated breaches never fire. One card per breach (six at most), naming the accounts, both dates, the domain, the data exposed and whether HIBP verified it; the full card's source line links the breach's HIBP page (the CC BY attribution); news must name the site and a breach or leak | Reported (HIBP) |
| Chip demand | Built (#134): `seed-chip-revenue` (every 6 h), key `tech:chip-revenue:v1` (on-demand bootstrap `chipRevenue`, about 3 KB). TSMC's (2330) monthly revenue from the Taiwan Stock Exchange open data API (`t187ap05_L`: every listed company's latest month, with the month before and the same month a year earlier; amounts in thousand NT$, dates in the ROC calendar), no key. The API carries only the latest month, so the months before are read from the same filings' monthly tables on mopsov.twse.com.tw (static HTML, cp950; at most 4 a run, the month before first) and kept as a 13-month log merged run to run. A MOPS row is read by column position, so it is stored only when its growth figures match its amounts and its revenue equals the following month's "previous month" figure; a month is never re-read. A month is dated by when it could first have been read (the later of the run before and its due date, so an outage does not re-date it), or, on the first run and for backfilled months, by the 10th of the next month (TSMC's filing deadline); the API's own date is when the exchange generated its table. Both hosts stay in terms review in the manifest. An API answer under 500 companies, or with growth figures that disagree with its amounts, fails the run; one without TSMC fails it too, except while the table has moved to a new month that TSMC has not filed yet (until 2 days past the due date), when the log is kept. Backtest on 26 months of MOPS filings (2024-08 to 2026-09): the rule fired 12 times, 8 of them in the last 12 months, because TSMC's year-on-year growth swings with the Lunar New Year and shipment timing; a 3-month year-on-year rule would be smoother if the owner wants fewer cards | Year-on-year growth moves 10 points or more from the month before, or revenue falls year on year, for the month filed in the last 7 days. One card naming the revenue, the growth and the shift, month on month and year to date; news must name TSMC. The quiet line names the latest month, its growth and the shift | Official (company filing via TWSE) |
| Hyperscaler capex | Planned (#135): SEC EDGAR company facts for Microsoft, Alphabet, Amazon and Meta (no key; a descriptive User-Agent is required) | A new quarter whose capex growth year on year changes 15 points or more from the previous quarter | Official filing |
| AI funding rounds | Planned (#142): SEC EDGAR full-text search for Form D filings that mention AI (no key; US only, noisy) | A Form D offering of 100 million USD or more in the last 7 days | Official filing |
| Attack infrastructure | `seed-cyber-threats` (abuse.ch Feodo Tracker and URLhaus, AlienVault OTX, AbuseIPDB, C2IntelFeeds; keys `URLHAUS_AUTH_KEY`, `OTX_API_KEY`, `ABUSEIPDB_API_KEY`) | A spike against its 7-day average. Needs the count history in [Baselines](#baselines) | Reported (threat feeds) |
| Model and product releases | `seed-ai-models` (#126, [gap 5](#gaps-to-build), every 6 h), key `tech:ai-models:v1` (on-demand bootstrap `aiModels`, about 10 KB; up to about 25 KB in a month with many open-weight releases): the OpenRouter models API (no key): listing time, context length and price per token. Kept: the watched labs' own models (OpenAI, Anthropic, Google, Meta, Mistral, xAI, DeepSeek, Qwen), without provider variants (`:batch`, `:free`), routers or aliases; the last 90 days (at most 60) and 30 days of price changes. A listing time is usually the release, but OpenRouter sometimes lists an older model late, so the UI says "listed". Prices are compared with the stored previous prices (`tech:ai-models:state:v1`); a model seen for the first time sets its baseline. A change is cross-checked against LiteLLM's price file (MIT; read only when a change is found). Open-weight releases (#132): the same seeder reads the Hugging Face Hub's newest 50 models for Meta, Mistral, Qwen, DeepSeek and Google (`/api/models?author=…&sort=createdAt`, no key; the host stays in terms review in the manifest; each model's own licence is shown). Format variants (FP8, NVFP4, GGUF, AWQ, MLX and the like, and quantized or adapter repos) and tasks no paid API stands for (classifiers, time series, detection, segmentation) are left out. A repo is often created privately and made public later, so a model is dated by the run that first saw it (`hfSeen` in the state key, kept while the lab still lists it), but only when its repo is under 90 days old: an older repo reappearing is dated by creation, never new. Each lab's first read dates its backlog by creation. A lab that fails, or answers with an empty list, keeps its models and dates from the last good read (at most 40 models kept); the Hub unread for one health budget (18 h) fails the run, and the Lite row dates itself by the older source. Lab announcements (#133): `seed-ai-lab-news` (every 3 h), key `tech:ai-lab-news:v1` (on-demand bootstrap `aiLabNews`, about 15 KB): the labs' own sites, no key, the hosts in terms review. OpenAI's news RSS, Google's AI blog RSS and Google DeepMind's blog RSS; Anthropic publishes no feed (its old RSS answers 404), so its sitemap's `/news/` pages are read, dated by the run that first saw each one (the sitemap's lastmod is an edit time: a site edit re-dated dozens of old pages on 13 Nov 2026), with the headline read from the new page itself (retried on later runs while it stays unread); the first read only records the pages already there, a sitemap listing under half the last read's news pages is a failed read, and a page leaves the record only after the sitemap has not listed it for 400 days, so an old page never comes back as new. Qwen's blog stopped in 2025 and DeepSeek's feed is empty, so neither is read. A post is a release announcement when its title introduces, launches or makes available something and names a model or product (GPT, Gemini, Gemma, Claude, Codex, Sora, Veo, Genie and others, or "model"). Each source keeps its posts from the last good read; a feed without items or a sitemap listing under 20 news pages is a failed read, and a source unread for one health budget (9 h) fails the run, so the row dates itself by the oldest source | A model from a watched lab listed in the last 7 days (one card per lab), or a release announced on OpenAI's, Google's, Google DeepMind's or Anthropic's own site in the last 7 days (one card per lab, naming the products and the posts, linked to the newest post; news must name a product), or a price change of 20% or more, input or output, on one of its models (one card per model, with the LiteLLM check). Open weights: a model from Meta, Mistral, Qwen, DeepSeek or Google first seen on the Hub in the last 7 days with 100 or more likes or 10,000 or more downloads (one card per lab, naming each model's task, licence, likes and downloads, linked to its Hub page); the quiet line names the newest release on the Hub | Reported (OpenRouter listing; Hugging Face Hub); Official (the lab's own site) |
| Live power-grid outages | None yet; `seed-power-reliability` is per-country background, not live | — | — |
| Primary-source regulation | `seed-ai-regulation` (#127, every 2 h), key `policy:ai-regulation:v1` (on-demand bootstrap `aiRegulation`): the European Commission's digital-strategy news feed, the EUR-Lex feeds of Commission proposals (rssId 161) and Official Journal L acts (rssId 165), and the Federal Register API (the one #122 reads) searched for "artificial intelligence" rules and proposed rules over 30 days (all no key; EU documents under the Commission's reuse policy, US documents public domain; the hosts stay in terms review in the manifest). Kept: documents whose title (for the Federal Register, title or abstract; a full-text match alone pulls in Medicare rules) names AI or data rules (the AI Act, Regulation 2024/1689, general-purpose AI, the Data Act, the Data Governance Act, data protection); EU news must also name an instrument (an act, guidelines, an implementing or delegated act, a code of practice), which drops events and funding calls. The feeds show only their newest items, so the key is a rolling 60-day log, merged run to run. The proposals feed gives no item dates, so a proposal is dated by its first sighting and shown as "first seen"; the proposals already in the feed on its first good read are only remembered (`undatedSeen`), so they never read as new. Each source keeps its last good read; the feed is as fresh as the oldest, and a source unread for more than 6 h fails the run. The Tech policy panel shows the newest three above the curated milestones (`packages/client/config/ai-regulations.ts`, now background) | An EU act, implementing act or guidelines on AI or data, or a US final or proposed rule on AI, published in the last 7 days; one card per document (at most four). News must use AI or data-rule words | Official |

### Sources left out

Checked on 2026-11-19 against the owner's free-sources rule (see [Owner decisions](#owner-decisions)):

- **Free for non-commercial use only.** OpenSanctions (compliance screening counts as commercial), ransomware.live (the free tier excludes corporate use) and ACLED (registration, limited tiers; see Owner decisions). The OFAC, trade.gov, EU and UK lists, 8-K item 1.05, and GDELT with UCDP cover the same ground.
- **Blocked or fragile.** OPEC (403 to scripted clients) and China's MOFCOM lists (Chinese HTML only). The news digest covers both.
- **Low decision value.** Congress.gov (free key; bills move slowly), the Epoch AI models dataset (background only) and regulator enforcement actions (`seed-regulatory-actions`, not a board-level decision).
- **No free source.** Consensus forecasts for macro releases: the prior print and the Kalshi stand-in (#128) remain.
- **Not reachable from the test machine.** Polymarket and CBOE timed out; Kalshi covers rate expectations, and Yahoo with FRED covers the VIX.

### Baselines

Rules measured against a normal need history that some feeds do not keep. It is kept in Redis as rolling count keys with a TTL longer than the window, so no new datastore is needed (the Supabase gate covers history longer than Redis TTLs):

- **GDELT conflict events**: the row key holds only the last 24 h (`GDELT_ROLLING_WINDOW_MS`). Built in step 2a: the materializer keeps hourly conflict counts per country for 48 h beside the existing 30 daily buckets (`gdelt:bulk:country-events:v1`, same cursor, so a replayed cohort never counts twice), and publishes the compact projection `gdelt:bulk:conflict-counts:v1` (48 hourly and 30 daily buckets, each with its cohort count; 6 h TTL; seed-meta and activation marker; on-demand bootstrap key `gdeltConflictCounts`). Only live cohorts fill the hours; the archive repair rebuilds days. They feed the violence rule, the shading, the report histogram and the region strip.
- **Attack infrastructure** (built in step 4a): after each snapshot, `seed-cyber-threats` folds the run's counts into `cyber:threats:history:v1` (`scripts/_cyber-threat-history.mjs`). It keeps the total, the count per feed and the top 10 malware families for each of the last 30 UTC days, with the larger count of two runs on the same day. Families come from Feodo, URLhaus and C2Intel only: OTX carries a pulse title in that field and AbuseIPDB leaves it empty. A failed read of the previous history skips the write rather than replace the stored days.
- **GPS interference**: built in step 2b. After each daily run `fetch-gpsjam` publishes `intelligence:gpsjam:high-cells:v1`: today's high cells beside the previous day's, each with its H3 id and centre (a new date moves the stored day back; a rerun of the same date keeps it; 4-day TTL; seed-meta and activation marker; on-demand bootstrap key `gpsHighCells`). The first run has no previous day, so the indicator fires from the second.

Feeds that already keep history: Taiwan Strait activity, Treasury par yields (the curve against a week ago), chokepoint transits and the Hyperliquid baselines.

### Screen design

The owner's designs (2026-11-08). The design exports stay out of the repository.

**Indicator card.** One component on every screen: domain chip, name, time; value and change; the rule it crossed; label and source; linked-news count, or "No linked news found" with an accent. A feed with nothing fired shows a one-line state instead of a card:

- **Quiet**: live, nothing fired;
- **Stale**: late against its cadence;
- **Unavailable**: no access yet (for example "Airspace closures · awaiting FAA access").

Clicking a card focuses its marker on the map. A marker opens the plain map card every marker uses, one line per signal; the full indicator card, with its source and linked news, stays in the panel (owner's decision, 2026-11-10).

Built in step 1:

- **Components:** `apps/web/src/lite/components/indicator.tsx` has the full card, the compact card (it expands in place to the full one; Escape collapses it), the state rows and the health dots.
- **Model:** `apps/web/src/lite/data/indicators.ts` holds the indicator model and `feedState`. A failed or empty source is unavailable and names its seeder. Data older than twice its cadence is stale. A feed without a data timestamp never claims stale.
- **Linking:** `apps/web/src/lite/data/news-link.ts` applies the news link rule.
- **Colours:** MARKET DATA, which the design system lacks, uses the muted ink with a chart icon. REPORTED uses `--color-reported`, and the no-link accent uses `--color-nolink`.
- **AI line:** shown only when the card has linked stories and a grounded "why", which no feed produces yet.
- **Detail line** (step 4a): an optional line of facts from the feed, such as scope, stated cause or counts per feed. It never states a guessed cause.

**Briefing.** A "Fired indicators" block at the top, newest first, with filters All, Watchlist and No linked news, and a feed-health strip (one dot per feed: fired, quiet, stale, unavailable). The watchlist parts are samples until the watchlist exists (open decision 1). The hourly brief, priority events, market pulse, escalation tracker and catalysts stay. Built (#121): the block collects every domain's feeds through shared hooks (`apps/web/src/lite/data/domain-feeds.ts`), and a "Daily check" filter shows only the check-daily indicators ([Decision tiers](#decision-tiers); the tier per feed is `feedTier` in `apps/web/src/lite/data/indicators.ts`). Analyst inputs (military aircraft, GPS interference, attack infrastructure, and the violence and sea-incident layers that feed the region view) carry no tier. The Watchlist filter stays SOON until the watchlist exists.

**Geopolitics.**

- The map's layers popover has three groups:
  - **Live layers**: reported violence (GDELT, country shading by the 6 h ratio to the 7-day average), military aircraft (grouped into an aggregate at 5 or more near a hotspot), incidents at sea (UKMTO), GPS interference (hexagons), airspace closures (N/A until FAA access).
  - **Background and judgement**: UCDP as the verified background, always shown, with its newest date; curated hotspots with the live score.
  - **Context, optional**: shipping lanes; social OSINT (discovery only, never alerts; no source chosen yet).
- Range 6h, 24h and 7d, with a GDELT events-per-hour histogram. Each range button says what it is for: 6h, is something spiking now; 24h, what happened today; 7d, a sudden spike or a week-long build-up.
- A region strip under the map (derived): one tile per named region in `ESCALATION_REGIONS` (`apps/web/src/lite/data/regions.ts`): Red Sea / Aden, Eastern Europe, Levant, Gulf / Iran, Sahel and Taiwan Strait (owner's decision, 2026-11-10; it replaced the five highest-scoring curated hotspots, which split one war across two tiles and listed cities outside any conflict). Each region sits inside one area of the region selector (Middle East, Europe, Africa, Asia-Pacific); the selector has no Americas area. Each tile shows its level word (Critical, High, Elevated, Watch, Stable, Easing) from the highest live score among the curated hotspots in its countries, the change in GDELT reports over its countries in the last 24 complete hours against the 7-day daily average ("—" while any of those hours is incomplete), and daily bars for 14 days. A selected area dims the tiles outside it. A click zooms the map to the region and a second click zooms back out; a dimmed tile also switches the selector to its area. The Briefing's escalation tracker reads the same list.
- The indicator panel beside the map; priority incidents, regional timeline and evidence mix below. Since #116 (owner's decision 2026-11-19) the panel groups fired indicators by region (`ESCALATION_REGIONS`): an indicator belongs to the first region listing one of its countries, else to the smallest region whose map view holds its point (`regionOfPlace` in `apps/web/src/lite/data/regions.ts`). The region with the highest live hotspot score comes first (the strip's level, shown in the heading; ties keep the strip's order), newest first inside a region; an indicator outside every region goes under "Other" (a region-wide GPS rise has no single place), and the quiet, stale and unavailable rows stay one compact block after the groups.

Built in step 2a: the range (then 6h, 24h, 7d and 30d), the GDELT shading and histogram, UCDP as the background, the strip (then of hotspots) and the indicator panel's violence feed (`apps/web/src/lite/data/conflict.ts`, `LiteMap`'s `countries` prop).

Built in step 2b (`apps/web/src/lite/data/geo-layers.ts`):

- **Layers popover** with the design's three groups; the old side panel is gone. GPS interference joins the live layers (the design left it out; the catalogue has it). Airspace closures and social OSINT read N/A.
- **Military aircraft**: airborne aircraft within 200 km of a hotspot as solid grey plane events whose card says the position is reported by transponder (the heading is in the card); at 5 or more near one hotspot they collapse into one grey aggregate with the count, whose card lists them (map marker grammar, 2026-11-10). A live snapshot: the range cannot show past positions.
- **Incidents at sea**: UKMTO notices as solid ship events, filtered by the range, coloured by state: red for an attack, hijack, boarding or explosion, amber for suspicious activity, grey for an advisory. An older notice keeps its solid mark; the card dates it.
- **GPS interference**: the latest gpsjam day's medium and high cells as hexagons through `LiteMap`'s `overlays` (h3-js loads with the layer). gpsjam publishes one file per UTC day and only the latest day is kept, so the range does not change it.
- **Range and the layers** (owner's decision, 2026-11-10): the range is 6h, 24h and 7d. 30d was dropped: its shading was the 7d comparison again, and UCDP already covers the long view. Each row in the layers popover says what it shows at the selected range (`layerRangeNote` in `apps/web/src/lite/data/geo-layers.ts`):

  | Layer | 6h | 24h | 7d |
  |---|---|---|---|
  | Reported violence | last 6 h against the 7-day average: sudden spikes | last 24 h against the 7-day average | last 7 days against the 22 before: slow build-ups |
  | Incidents at sea | notices from the last 6 h | from the last 24 h | from the last 7 days |
  | Military aircraft | positions now; the range does not apply | same | same |
  | GPS interference | latest gpsjam day; the range does not apply | same | same |
  | Verified · UCDP | released monthly, a month or more behind; the range does not apply | same | same |
  | Curated hotspots | score now; the range does not apply | same | same |

  Range history for aircraft and GPS (gpsjam's daily archive, a per-hotspot aircraft count) was considered and not built: the indicators fire on now against yesterday or the 7-day normal and need no longer history.
- **Shipping lanes**: optional context, off by default.
- **Indicators**: aircraft, sea and GPS feeds join the violence feed, and the airspace row reads "Awaiting FAA access". A card opens its hotspot or incident on the map.
- **Legend**: behind a "Legend" button on the map, closed by default, listing the layers that are on.

Built in step 2c (`apps/web/src/lite/data/geo-watch.ts`):

- **Indicators**: chokepoint transits (the Finance map's `chokepoints` source: PortWatch 7-day transits against the year-earlier normal, and the tanker-flow `disrupted` flag; the card shows the PortWatch day), Taiwan Strait activity (slow bootstrap key `crossStraitActivity`, kept across refreshes because it has no RPC) and US embassy alerts for the hotspot countries (`securityAdvisories`, else the RPC). The Taiwan card opens the Taipei hotspot and an embassy card its hotspot; chokepoints have no marker on this map.
- **Watchlist**: the design sample is gone. Watch rules arrive with the alerts phase.

**Finance & Crypto.**

- A ticker strip (BTC, Brent, gold, S&P 500, US 10Y) with the 1D change only.
- A map, "Where markets are moving":
  - fired and quiet finance indicators pinned at the issuing central bank or exchange (`CENTRAL_BANKS`, `STOCK_EXCHANGES` in `packages/client/config/finance-geo.ts`);
  - Geopolitics indicators near chokepoints, pipelines and commodity hubs, with the price they moved in their card;
  - chokepoints (red when a transit rule fires or an incident is linked);
  - shipping lanes, sanctions and financial centres as context. A financial centre opens a plain card from the curated list (`packages/client/config/finance-geo.ts`): type, place, GFCI rank, specialties and description, labelled "Context only: curated reference list, no live signal" (owner's request, 2026-11-10).
  - The pin marks where a signal is issued, not where it is felt. Crypto stays off the map: ETF flows, depegs and positioning are cards.
- The indicator panel; market-moving events (each story shows the indicators that moved before or after it); macro calendar with forecast, actual and surprise (built with prior, actual and change until a forecast source exists); the US Treasury curve, today against a week ago.
- The chart widgets go: BTC volume bars, volatility, liquidations and the correlation matrix. Done in step 3b; funding, open interest and ETF flows remain as indicator cards.
- Marks (map marker grammar, 2026-11-10): a fired signal is an amber event (the landmark for a central bank, the candlestick for an exchange, the filing glyph for an 8-K); a quiet issuer is an asset (landmark for a central bank, building for an exchange); chokepoints are anchor assets, red when an incident is linked; financial centres are grey building assets that open a context card.
- Built in step 3b: until the Geopolitics indicators exist, chokepoints carry the supply-chain disruption score and the map's "market-moving geopolitics" layer reads N/A. A pin shows its reading on hover and opens a plain map card on click, one line per signal, while the full indicator card stays in the panel (owner's decision, 2026-11-10); no pin carries a name chip, and the legend opens from its button. Opening a card in the panel opens its pin.

**Technology & AI.**

- A map, "Infrastructure & cyber map":
  - DDoS targets (country shading, Cloudflare Radar with the same token);
  - attack servers (grey aggregates with counts; the card names the main malware families);
  - outages (major, partial, minor);
  - cloud regions (`CLOUD_REGIONS` in `packages/client/config/tech-geo.ts`): a region turns red only when the incident names it, otherwise all of the provider's regions show degraded;
  - AI data centres (`packages/client/config/ai-datacenters.ts`), amber when an outage is in the same country;
  - undersea cables (cable health: OK, degraded, fault).
  - The map notes that DDoS shading shows who is attacked and the grey circles show where attackers' servers are.
- The indicator panel; material developments; the model tracker (OpenRouter listing of the watched labs, #126); research radar; policy and governance; infrastructure tiles from real counts (active outages, providers degraded, exploited CVEs this week, threat indicators against their average); watched topics.

Built in step 4a (`apps/web/src/lite/data/tech-indicators.ts`):

| Feed | Fires when | Label | Read path |
|---|---|---|---|
| Internet outages | A Cloudflare outage that is ongoing or was detected in the last 24 h. The card shows scope (nationwide, regional, network) and the stated cause | Reported (Cloudflare Radar) | `ListInternetOutages` (carries `fetchedAt`) |
| Cloud and AI services | AWS, Azure, Google Cloud, Cloudflare, GitHub, Vercel, OpenAI, Anthropic or Replicate reports a partial or major outage; degraded shows in the quiet line | Official (status page) | `serviceStatuses` bootstrap, else `ListServiceStatuses` |
| Exploited vulnerabilities | CISA added a CVE to KEV in the last 3 days. A date-only feed: the link window runs from 12 h before the added day to its end | Official (CISA KEV) | on-demand bootstrap key `kevRecent` (`cyber:kev-recent:v1`, the last 30 days of additions, an extra key of `seed-cve-reference`) |
| Attack infrastructure | The latest run's indicators reach 2× the average of up to 7 complete days before today. It needs 3 days of history, and until then reads "building baseline" | Reported (threat feeds) | on-demand bootstrap key `cyberThreatHistory` (`cyber:threats:history:v1`) |

Built in step 4b (`apps/web/src/lite/data/tech-map.ts`): the "Infrastructure & cyber map", with the shared layers popover.

- **DDoS targets:** Cloudflare Radar's top layer 3 target countries over the selected range. Countries are shaded on the shared blue ramp, four steps by share of the busiest target (an `overlays.fills` feature with a `ramp-1` to `ramp-4` tone), and the top five carry their share as a neutral label.
- **Attack servers:** located threat indicators binned into 8° cells. Each cell is a grey aggregate, full size at the busiest cell, with its count printed once it is large enough. The card names the main families, from Feodo, URLhaus and C2Intel only. Locations come from GeoIP or the country centroid, and the card says so.
- **Outages:** Cloudflare outages active in the selected range at the country centroid, as events with the cause's glyph (power, cable cut, government shutdown, military action, cyberattack, otherwise the internet outage glyph): red for a nationwide or regional outage, amber for a network one. An ended outage keeps its solid mark; the card says when it ended.
- **Cloud regions:** `CLOUD_REGIONS`, one cloud asset per city at the worst status of its regions; the card lists each provider's region there. When a provider reports a partial or major outage, its cities turn amber. A city turns red only when the incident text names a region's code or place there, which status pages rarely do.
- **AI data centres:** existing sites with 20,000 chips or more (38 sites), as chip assets. A site turns amber when an internet outage is live in its country (the worst one there when there are several).
- **Undersea cables:** `UNDERSEA_CABLES` as `overlays.lines`, coloured by `GetCableHealth` (NGA navigational warnings). A degraded or faulted cable gets a cable event at its middle carrying its evidence.

Expanding a fired indicator opens the card of its marker: the outage, the provider's worst city, or the busiest attack cell. The geometry configs load on the map's first use.

**Range and the layers** (owner's decision, 2026-11-10), the same logic as Geopolitics: the map carries the shared 6h, 24h and 7d buttons (`apps/web/src/lite/components/TimeRange.tsx`, default 7d). The popover groups the layers as "Live layers", which follow the range, and "Background & status", which show their state now. Each row says what it shows at the selected range (`techLayerRangeNote` in `apps/web/src/lite/data/tech-map.ts`):

| Layer | 6h | 24h | 7d |
|---|---|---|---|
| DDoS targets | share of attack traffic, last 6 h | last 24 h | last 7 days |
| Attack servers | indicators seen in the last 6 h | last 24 h | last 7 days |
| Internet outages | outages active in the last 6 h | last 24 h | last 7 days |
| Cloud regions | status now; the range does not apply | same | same |
| AI data centres | status now; the range does not apply | same | same |
| Undersea cables | warnings in force now; the range does not apply | same | same |

- **DDoS windows.** 7d is Cloudflare's 7-day aggregate (`cf:radar:ddos:v1`). 6h and 24h come from `cf:radar:ddos-windows:v1`, which `seed-internet-outages` publishes beside it as a third Radar companion: `dateRange=1d` for 24 h, and `dateStart`/`dateEnd` for 6 h, since Radar has no hourly `dateRange`. It is an on-demand bootstrap key (`ddosWindows`), loaded only once the range leaves 7d. A window that failed is absent and recorded on seed-meta (`degradedWindows`); the map then names the source and shades nothing, never another window's data. Each window is a fresh snapshot, not a history.
- **Attack servers** keep indicators last seen inside the range (first seen when there is no last-seen time); an indicator with no time stays at every range. **Outages** show when ongoing or ended inside the range.
- **Background assets.** Cloud regions and AI data centres are assets in their normal state, grey and drawn under every other mark (a quiet asset is `z-0` in `markerLayer`, `apps/web/src/lite/map/LiteMap.tsx`), until a signal turns them amber or red and lifts them on top. A data centre's only signal is a live internet outage in its country: amber, never red, because no source names the site itself; its card names the outage's type and stated cause (for example "nationwide, power outage") and says the signal is the country, not the site.

The two cyber keys use the on-demand bootstrap path, not new RPCs. Two more operations would push the public `openapi.json` past its 950 KB scanner budget. The watchlist-vendor part of the KEV rule waits for the watchlist.

Trigger rates measured on 2026-11-08, when the seeders first ran on the owner's stack:

- Cloudflare listed 9 outages in 28 days, about one every three days, and none in the last 24 h.
- CISA added 30 CVEs in 30 days, on 14 separate days, so the 3-day rule fires on most days.
- The threat feeds held 1,045 deduplicated indicators: AbuseIPDB 500, OTX 319 and C2Intel 226. Feodo and URLhaus contributed none in that run. The spike rule needs 3 days of history before it can fire.

**Sources** (`/lite/sources`, built 2026-11-08). A read-only screen of the connectors Lite reads. `apps/web/src/lite/data/connectors.ts` lists each connector with its domain, kind, method, producer, health check, upstream hosts and the widgets that use it. `tests/lite-ui.test.mts` keeps the health check names and max ages equal to `SEED_META` in `api/health.js`, and each host's licence equal to `packages/shared/source-attribution-manifest.json`.

- **Status.** A seeded connector reads the compact health check (`/api/health?compact=1`). It lists only problem and pending checks, so a listed error, missing or empty check is failing, any other listed problem is degraded, and an unlisted or pending check is live. A connector whose health check is unavailable reads unknown, never live. While the check answers 503 `REFRESH_PENDING` (a verdict is being built), the Lite UI retries as `retryAfterSeconds` says, up to three attempts, before calling it unavailable. A news digest connector reads the digest itself: failed is failing, empty is degraded, and live shows its feed coverage.
- **Table.** Sorted by status, then domain: source, method, max age (the health check's `maxStaleMin`), last update (the check's seed age when it is listed, else "within" the max age), and status. All and Degraded filter it, and the search box matches names, hosts and producers.
- **Detail.** The selected connector, first the worst one: last update, max age, records or feed coverage, the health status, error code and consecutive failures when the check carries them, its producer, the widgets that may show partial data, and its upstream hosts with their licence status.
- **Licensing.** Distinct upstream hosts per manifest status (reviewed, terms review, excluded). The digests' publishers are not counted.
- **Tier policy.** The four declared tiers from `packages/shared/source-tiers.json` (with the Telegram and X overlays): meaning, outlet count and how Lite uses the tier.

### Build order

Each step is its own PR with screenshots, and starts by running its seeders locally. Steps 2 to 4 depend only on step 1, not on one another:

1. The news link rule as one shared Lite module, with tests, used first by the existing Finance price links.
2. Geopolitics: the GDELT count history, then the violence layer on the map, filtered by the range; military aircraft, sea incidents and GPS interference as layers; chokepoint transits, Taiwan Strait activity and embassy alerts as indicators; the region strip; airspace closures once FAA access arrives. UCDP becomes the verified background layer.
3. Finance: macro release surprises, yield moves, bitcoin ETF flows, stablecoin depegs, perp positioning and freight, each with linked news; the "Where markets are moving" map. Done in code: step 3a (the indicators, 8-K filings and the Treasury curve) and step 3b (the map, the chart widgets removed, 1D tickers).
4. Technology and AI: the attack-infrastructure history; internet, cloud and AI service outages, exploited vulnerabilities and attack infrastructure (all keys in hand); the infrastructure and cyber map; then the model-release tracker.
5. The Briefing's fired-indicators block and feed-health strip, across Geopolitics, Finance and Technology. Done in #121, with the Daily check filter.
6. Decision tiers, Phase 1 (milestone "Lite indicators · Phase 1: improve existing indicators", #113–#121): the [Decision tiers](#decision-tiers) from data the repository already fetches.
7. Decision tiers, Phase 2 (milestone "Lite indicators · Phase 2: new data ingestion", #122–#142): the free sources, high priority first. Starts after step 6.

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

History: how the profile worked on the old dashboard. Refactor Phase 1a deleted the dashboard, its panels and layers, and Phase 1d deleted the flag with `src/config/lite-profile.ts` and `src/config/variant.ts`, so none of this is in the code now.

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

The owner's front page: a sidebar, the cross-domain Briefing at `/lite` (home), and its three child screens, Geopolitics & Conflicts (`/lite/geopolitics`), Finance & Crypto (`/lite/finance`) and Technology & AI (`/lite/tech`), plus the read-only Sources screen (`/lite/sources`). The Briefing links to each child through the sidebar, its events' domain tags and its panel headers. The design exports are kept out of the repository; no design sample rows remain in the app (the model tracker's were the last, replaced by real data in #126).

**Stack.** The Lite UI is the only web app, the `@wm/web` workspace in `apps/web/` (refactor PR 2.5). It uses Preact (JSX through `apps/web/tsconfig.json`'s `jsxImportSource`, from `tsconfig.base.json`) and Tailwind CSS 4 (`@tailwindcss/vite`, scoped to `apps/web/src/lite/lite.css`), with Lucide icons, self-hosted IBM Plex fonts (the CSP allows no font host), and OverlayScrollbars (`overlayscrollbars`) for overlay scrollbars that take no width and show only while the pointer is over the scroll area (owner's decision, 2026-11-08). `scripts/lint-boundaries.mjs` keeps it separate: `apps/web/src/lite/` may import `config`, `services`, `utils`, `packages/client/shared/`, `@wm/shared`, `@wm/server/_shared/` and generated clients, and nothing outside it may import `apps/web/src/lite/`; nothing under `packages/` imports `apps/`.

**Routing.** Refactor Phase 1a (2026-11-18) removed the dashboard, its `?full=1` escape and the profile-off notice; Phase 1d removed the flag, the middleware's root redirects (the profile 307 and the legacy map-state 308 to `/dashboard`) and the variant-host and preview-host `/` to `/dashboard` redirects. `/` opens `/lite` on every host:

| Request | Result |
|---|---|
| `/` and `/dashboard` with any query (a shared map link, the old `?full=1`), `/dashboard/`, `/stocks`, `/stocks/:symbol`, `/story` | A temporary redirect (307) to `/lite` that keeps the query string: `vercel.json` on Vercel (its redirects run before `middleware.ts`, which has no route logic), `docker/nginx.conf*` in Docker, `liteDevRoutePlugin` (`vite.dev-api.ts`) in dev. 307, not 308, because `/lite` moves in the deployment phase and browsers cache a permanent redirect. `tests/deploy-config.test.mjs` pins all three |
| `/lite`, `/lite/geopolitics`, `/lite/finance`, `/lite/tech`, `/lite/sources` | The Lite UI (`apps/web/lite.html`, served as `/lite.html`) |
| Installed PWA | Starts on `/lite` (static `public/manifest.webmanifest`) |

`vercel.json`, `docker/nginx.conf*` and the dev middleware serve `lite.html` for the five paths only, and `isKnownPublicPagePath` (`packages/server/_shared/agent-not-found.ts`) lets exactly those five past the 404 gate. `npm run build` runs the web app's build, which builds `apps/web/lite.html` into the repository root's `dist/` (`apps/web/vite.config.ts`: Vite root `apps/web`, the root `.env*` and `public/`). `public/sw.js` replaces the old dashboard's service worker with one that clears its caches and unregisters itself.

**Data.** `apps/web/src/lite/data/sources.ts` reads the same sources as the dashboard, without `App`: the bootstrap tiers once, then the generated RPC clients, and the news digest through its public CDN shape. It uses no premium path. Each widget is one of:

- **Real**: rendered from a source. An empty or failed source shows its own state and names its seeder. It never falls back to sample data.
- **Derived**: computed by a stated rule and tagged DERIVED with the rule in its tooltip.
- **Sample**: no source exists yet. It renders the design's values with a SAMPLE badge.

| Screen | Real | Derived | Sample |
|---|---|---|---|
| Briefing | Hourly AI brief: lead, cited lines and their sources (`insights`, seed-insights); market pulse tickers; macro calendar and AI regulation deadlines as catalysts | Fired indicators (#121): every domain's indicator feeds (the same rules as the Geopolitics, Finance and Technology panels), newest first, with a feed-health strip and the filters All, Daily check (the check-daily tier) and No linked news; Watchlist is SOON until the watchlist exists. Priority events: each child screen's main list merged, importance ≥ 50, ranked by importance × credibility; momentum from story phase; the corroboration and attributed-claims columns from the dashboard's corroboration verdict; "since" counts; market regime (five 24h moves); escalation trend from CII history (±10% is stable); watch alerts from built-in rules (impact, BTC 2h move > 4σ, primary-source AI policy) | None. Open questions, Pin, Split cluster, Mute, Manage and Generate brief are SOON |
| Geopolitics | UCDP events on a MapLibre map (OpenFreeMap tiles, styled from the Lite tokens), clustered by zoom with event cards, shown at every range as the verified background; GDELT conflict counts; priority incidents (digest, medium threat and up) | Reported-violence country shading, only above each country's own normal and never by raw volume (6h and 24h against the 7-day average; 7d the last 7 complete days against the 22 before), with a card per shaded country; the violence indicator (×2 the 7-day average and ≥ 5 reports in 6 h) with its linked news; GDELT reports per hour or day over the range (6h, 24h, 7d), which also filters incidents, timeline and evidence mix; region strip (the named regions, level from their hotspots' live score, GDELT change over 24 h, 14 daily bars, zoom on click); curated hotspots coloured by the dashboard's live escalation score (see Owner decisions); military aircraft near hotspots (badge at 5 or more), UKMTO incidents and GPS-interference hexagons as layers in the layers popover, each with its indicator, and the airspace row unavailable until FAA access; chokepoint transits, Taiwan Strait activity and US embassy alerts for the hotspot countries as indicators; timeline tags and incident status from the dashboard's corroboration verdict, with tier 1 marked beside it; evidence mix by source class | None |
| Finance | Five 1D tickers (BTC, Brent, gold, S&P 500, US 10Y); market-moving stories (one copy per story, asset classes in turns, war stories left to Geopolitics unless the headline names a commodity, then marked "Linked to GEO"); macro calendar with prior and actual prints (yesterday to two weeks out), the Fed and ECB decisions on their meeting rows, and the next FOMC and ECB meeting kept listed when it falls in the calendar's 31 days (#130); US Treasury curve, the newest against the newest a week or more older, with the 2s10s spread; on the "Where markets are moving" map, chokepoint status (`get-chokepoint-status`; every strategic waterway is drawn grey when it is not read), shipping lanes (`packages/client/config/trade-routes.ts`), new OFAC designations by country (`sanctionsPressure`, shaded from `countries.geojson`) and financial centres | Indicators panel on the shared indicator card (`apps/web/src/lite/data/finance-indicators.ts`, `finance-macro-indicators.ts`): BTC 24h move ≥ 4%, BTC perp funding ≥ 0.01%/h, a stablecoin more than 0.5% from $1, fear & greed ≤ 20 or ≥ 80, and the step 3 catalogue rows (macro print against the prior print, Treasury 2Y/10Y ±10 bp or a 2s10s flip, DE/GB/JP 10-year ±10 bp, 8 or more bitcoin ETFs the same way, Hyperliquid stress ≥ 60, SCFI ±5% w/w, Baltic Dry ±5% d/d, 8-K filings), each fired rule with its linked news; the calendar's change column (actual minus prior); map pins (`apps/web/src/lite/data/markets-map.ts`): each non-crypto signal at its issuer (Fed, ECB, BoE, BoJ, NYSE, Shanghai Shipping Exchange, Baltic Exchange), filled when fired, and opening a plain map card with one line per signal (the full indicator card stays in the panel); a chokepoint red at disruption score 50, labelled with the price it moves (Brent for Hormuz, Bab el-Mandeb and Suez; wheat for the Black Sea straits; SCFI elsewhere); a lane amber when disrupted, high risk or through a red chokepoint; market-event price links (24h change of the instruments a headline names or its tickers, else asset-class benchmarks; "No price impact" under 0.25% or 3bp) | None. Market-moving geopolitics on the map is N/A until the Geopolitics indicators exist (step 2) |
| Sources | Connector status from the compact health check and the digests; feed coverage; error codes; upstream hosts and their licence status (attribution manifest); tier policy (`packages/shared/source-tiers.json`) | None | None |
| Technology & AI | Infrastructure & cyber map: DDoS target shading, attack-server aggregates, outages, cloud regions, AI data centres and undersea cables; material developments (tech digest); policy actions (the newest EU and US AI and data rules from seed-ai-regulation, #127, above the curated `packages/client/config/ai-regulations.ts` milestones); arXiv papers; funding and infrastructure stories; the model tracker (the watched AI labs' newest models on OpenRouter, with listing date, context and price; #126) | Indicators panel on the shared indicator card, each fired rule with its linked tech-digest news (rules below); infrastructure tiles from the same feeds (active outages, providers degraded, exploited CVEs this week against last, threat indicators against their 7-day average); evidence pills (corroboration verdict, "Primary source" when a tier-1 outlet reports alone); research signal (arXiv plus Hacker News); watched-topic counts | — |

The table describes the screens as built. The target screens are in [Screen design](#screen-design); each build step updates its rows.

**Corroboration.** Every Lite status, tag and pill comes from `assessCorroboration` in `packages/server/_shared/corroboration.ts`, the rule the full dashboard's news and insights badges use, applied to each digest item (`corroborationOf` in `apps/web/src/lite/data/transforms.ts`). It counts publisher families from the digest's origin-aware `corroborationCount`, so one newsroom's feeds and reprints count once:

- **Corroborated**: two or more publishers.
- **Single publisher**: one.
- **Low-tier only**: every publisher seen is a declared tier-4 outlet (aggregators and blogs).
- **No count**: the digest carried none. It never reads as a single source.

It describes coverage, not accuracy, so Lite never labels a headline "confirmed". Tier 1 (`isPrimarySource`) is shown beside the verdict and never upgrades it. Tier 1 in `packages/shared/source-tiers.json` covers wires and official bodies and also some major outlets and public broadcasters. Confirmed facts need the event-analysis phase. `storyMeta.sourceCount` is report volume: Lite shows it as a report count and never as corroboration.

Alerts, Watchlists, Scoring rules, Settings and each domain screen's primary action are shown and marked SOON. They arrive with the phases that give them data.

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

- **Supabase Postgres** when the build needs any of: an event store with timelines, history longer than Redis TTLs, alert rules or delivery state, or a replacement for `intelHistory` (pgvector). Template: the removed `consumer-prices-core/` service (`pg`, migrations, `raw_payload_json`, `raw_hash`), in git history before the 2026-11 Lite-only cleanup.
- **R2 raw archive** when audit or replay of upstream payloads is required. Store the body, fetch time, canonical URL, source and content hash.

### Operations

- **Seeder allowlist.** Upstream runs about 250 seeders. The profile runs only those feeding Lite panels. This sets Render cost. It must include `seed-gdelt-bulk-materializer`: without ACLED it is the only realtime conflict input to the risk scores (see [Owner decisions](#owner-decisions)). The hotspots' live score also reads `seed-unrest-events` (runs on GDELT alone without ACLED), `seed-earthquakes` (USGS, no key) and `seed-military-flights` (adsb.lol by default; OpenSky and Wingbits are optional); without them it falls back to news, CII and the curated baseline, and each hotspot card names the missing inputs. Each [early indicator](#early-indicators) adds its seeder to the allowlist when it is built. Geopolitics Phase 2 adds `seed-federal-register` (#122), `seed-travel-advisories` (#124) and `seed-eu-sanctions` (#129). Finance Phase 2 adds `seed-rate-odds` (#125), `seed-macro-forecasts` (#128) and `seed-central-bank-decisions` (#130). Technology Phase 2 adds `seed-ai-models` (#126), `seed-ai-regulation` (#127), `seed-breaches` (#131), `seed-ai-lab-news` (#133) and `seed-chip-revenue` (#134). Finance (step 3) adds `seed-economic-calendar`, `seed-fred-rates` (the credit-spread indicator, #114, and the fear & greed inputs), `seed-bundle-macro` (Treasury par yields), `seed-bundle-yield-curves`, `seed-etf-flows`, `seed-hyperliquid-flow`, `seed-stablecoin-markets`, `seed-supply-chain-trade`, `seed-sec-8k-stream` and `seed-sanctions-pressure`; chokepoint status also reads the relay's navigational warnings and vessel snapshot. Step 4a adds `seed-internet-outages` (Cloudflare Radar, every 30 min; it also publishes the Tech map's 6 h and 24 h DDoS windows), `seed-cyber-threats` (every 2 h) and `seed-cve-reference` (daily). Service statuses need no seeder: the handler fetches the status pages on a cache miss, so the Lite page's own request fills `infra:service-statuses:v1`. Geopolitics step 2b adds `seed-ukmto-incidents` and `fetch-gpsjam`; step 2c adds `seed-portwatch` (through `seed-bundle-portwatch`), `seed-cross-strait-activity` (through `seed-bundle-derived-signals`) and `seed-security-advisories`, and reads the relay's `seed-chokepoint-flows` and transit summaries. Locally, `npm run seed:lite:watch` runs this allowlist against the Redis in `.env.local` (`scripts/run-lite-seeders.mjs`): every 5 minutes it runs each seeder whose seed-meta is past its interval, so keys the relay keeps fresh are skipped; `npm run seed:lite:status` shows what is due without writing anything.
- **Health.** `api/health.js` grades every registered key. Keys produced only by Railway services or Convex show as stale on the owner's stack, so the profile needs a health key subset matching the allowlist.
- **Licensing.** `packages/shared/source-attribution-manifest.json` has 1,056 hosts: 740 `terms-review`, 196 `excluded`, 120 `reviewed`. Sixteen are licensed under "the World Monitor agreement", which does not cover the owner. The profile applies a source-policy filter from the manifest's `license` and `status` fields.
- **AGPL.** A private modified deployment that only the owner uses needs no source offer to others ([self-hosting](../../../SELF_HOSTING.md)); the fork is public anyway.

## Intelligence layer

Goal: turn many reports into a few evidence-linked events, keep uncertainty visible, and never present generated text as verification.

### Reuse map

| Capability | Exists | Where |
|---|---|---|
| URL canonicalization | Partial (not at ingest) | `packages/shared/article-identity.js` |
| Story similarity | Yes | `packages/shared/story-identity.js` (server), `packages/shared/news-clustering-core.js` (client and MCP), `scripts/lib/brief-dedup.mjs` (digest embeddings) |
| Syndication and publisher families | Yes | `packages/shared/syndication.js`, `packages/shared/publisher-families.js` |
| Source tier and credibility | Yes | `packages/shared/source-tiers.json`, `packages/shared/news-credibility.js`, `packages/shared/source-provenance.ts` |
| Corroboration | Yes | `packages/server/_shared/corroboration.ts` |
| Impact and importance | Yes (several) | `computeImportanceScore` in `packages/server/worldmonitor/news/v1/list-feed-digest.ts`, `scoreImportance` in `scripts/_clustering.mjs`, CII, hotspot escalation |
| Momentum | Partial | `src/services/velocity.ts`, story lifecycle |
| Trend and anomaly | Yes | `packages/shared/keyword-spike-core.js`, temporal-baseline z-scores |
| Grounded briefs with citations and abstention | Yes | country brief, `scripts/_insights-brief.mjs`, `packages/shared/brief-llm-core.js`, `packages/shared/brief-claim-rules.js` |
| LLM chain | Yes | `packages/server/_shared/llm.ts` |

The three similarity definitions are separate on purpose (`packages/shared/news-clustering-core.js` header). Do not merge them without a product decision.

### Gaps to build

1. A durable **event object**: multi-story, with an evidence timeline and a per-event confidence.
2. A **novelty** score. Only a console prototype exists in `src/services/parallel-analysis.ts`.
3. A per-source **track record**.
4. **Crypto risk alerts**: depeg notifications, volatility, funding and open-interest stress. Liquidation data has no source yet.
5. An **AI/tech event detector** and model-release tracker. The model-release source is built (#126; see the [Catalogue](#catalogue)).
6. **Numeric alert thresholds** and an alert delivery path that does not need Convex. [Early indicators](#early-indicators) gives the default thresholds.
7. A **move-to-news linker**: from an indicator to the stories around it (see [News link rule](#news-link-rule)). Built for the Lite UI in `apps/web/src/lite/data/news-link.ts` (step 1); the story-to-indicator direction exists for prices only.

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
| 1. Profile shell | `VITE_LITE_PROFILE`; Lite panel and layer defaults; Lite Desk preset; the five cross-variant panels; access gate at deploy time | Done, then superseded: the Lite UI replaced the dashboard layout, and refactor Phase 1d removed the flag. The access gate is set up when deploying |
| 1b. Lite UI | `/lite`: the cross-domain Briefing home and three child screens, real data where a source exists, labelled samples elsewhere (see [Lite UI](#lite-ui-lite)) | Done in code: `tests/lite-ui.test.mts`, `tests/dom/lite-ui.test.mts`, `verify-worldmonitor` step `lite-ui.mjs` |
| R. Repository refactor | The [refactor plan](../plans/2026-11-18-001-refactor-lite-monorepo-plan.md): record decisions and the legacy catalog; delete the dashboard and unused surfaces; npm workspaces + Turborepo; Vite 8 + `@preact/preset-vite`; hosting last | Each refactor phase merged with the Lite checks green; hosting chosen from measurements |
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

- **A new `lite` variant.** About 30 registration points (variant list, CORS, Convex preference variants, digest editions, desktop download list, locales, SEO, e2e). About 21 `SITE_VARIANT === 'full'` checks gate CII, intelligence and theater loading (for example `src/app/data-loader.ts` CII refresh and the intelligence refresh in `src/App.ts`), so a new variant would silently lose that data. It also multiplies upstream merge conflicts. (Moot since refactor Phase 1d: there are no site variants.)
- **Turbopack for the web app** (2026-11-18). Turbopack ships inside Next.js and needs React; Preact on Next relies on unsupported `preact/compat` aliasing. Vite 8 with Rolldown gives the Rust-bundler speed-up and keeps Preact.
- **A mission preset alone.** Presets are one-off rewrites of local state, not defaults, and cannot gate custom features or seeders. The profile still ships a preset for re-applying the layout.
