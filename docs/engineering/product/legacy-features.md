# Legacy features catalog

The vanilla-TypeScript dashboard, the desktop app, the blog and Pro sites, Convex and the non-`full` variants leave the repository in Phase 1 of the [refactor plan](../plans/2026-11-18-001-refactor-lite-monorepo-plan.md). Nothing is lost: the last commit that has all of them is tagged.

```bash
git show archive/legacy-dashboard-2026-11:src/components/PizzIntIndicator.ts   # read one file
git checkout archive/legacy-dashboard-2026-11 -- src/components/PizzIntIndicator.ts   # restore it
git worktree add ../wm-legacy archive/legacy-dashboard-2026-11   # run the old dashboard locally
```

Tag `archive/legacy-dashboard-2026-11` points at `3c01f573b` (main, 2026-11-18).

## What else left with the dashboard (Phase 1a)

Beyond the panels and layers inventoried below, Phase 1a removed:

- **Pages:** `index.html` (the dashboard), `embed.html`, `settings.html`, `live-channels.html`, `verify.html`, `desktop-sign-in.html`, `mcp-grant.html` (the MCP consent page), and the MCP App pages `plugin.html`, `market.html` and `country.html`. The MCP endpoints stay in `api/` until 1c.
- **Browser features with no Lite equivalent:** the PWA service worker, offline page and web push (`public/sw.js` now unregisters old workers), i18n beyond English, the command palette, saved layouts and the `lite-desk` preset, custom widgets, live video and webcams, country briefs and the export menu.
- **Checks:** the Playwright e2e and visual suites, bundle-size budgets, the panel-content and overlay-reload lints, locale sync and zh-TW conversion, and the daily MCP-preset and live-video audits.
- **Frozen, not deleted:** the product facts behind the `/pro` copy and the CLI's TUI catalog keep their last generated output; their generators read dashboard sources.

## How to bring a feature back to Lite

Most features are a pipeline, and only the UI leaves with the dashboard. Before porting, trace the chain at the tag:

1. **UI**: the panel or layer component (tables below). It is vanilla DOM code, so a Lite widget is rewritten in Preact, not copied.
2. **Browser service**: the `src/services/*` module the component imports. Port only what the widget needs into the client package.
3. **RPC**: the generated client method the service calls, defined in `proto/`. Contracts and handlers (`server/worldmonitor/<domain>/v1/`) stay in the repository.
4. **Redis key and producer**: the handler's key in `api/health.js` (`BOOTSTRAP_KEYS`, `STANDALONE_KEYS`, `SEED_META`), and the seeder or relay loop that writes it. Producers stay in the repository; a port adds the producer to the Lite seeder allowlist and its key to the health subset.
5. **Licence**: check the upstream host in `shared/source-attribution-manifest.json` against the spec's source policy.

Pages that explain how a number is computed (`docs/algorithms.mdx`, `docs/methodology/`, `docs/engineering/architecture/*`) stay even when their panel is gone.

## Port candidates

Features the owner has asked about, with the chain traced at the tag.

| Feature | What it showed | Domain | Redis key / RPC | Producer | UI at the tag | Licence | Blocker |
|---|---|---|---|---|---|---|---|
| PizzINT | Pentagon Pizza Index (late-night foot traffic near the Pentagon) and GDELT country-pair tension scores | Geopolitics | `intelligence:pizzint:seed:v1` / `IntelligenceService.GetPizzintStatus` (`server/worldmonitor/intelligence/v1/get-pizzint-status.ts`) | Relay loop in `scripts/ais-relay.cjs` (every 15 min; history in `scripts/shared/pizzint-history.cjs`, see `docs/engineering/architecture/pizzint-history.md`) | `src/components/PizzIntIndicator.ts` in `StatusPanel`; `src/services/pizzint.ts` | `www.pizzint.watch`, `besttime.app`: terms-review | Upstream blocks datacenter IPs; ran on Railway for that reason |
| USNI fleet tracker | US Navy carrier and amphibious group positions from USNI News | Geopolitics | `usni-fleet:sebuf:v1` (+ stale copy) / `MilitaryService.GetUsniFleetReport` (`server/worldmonitor/military/v1/get-usni-fleet-report.ts`) | Relay loop in `scripts/ais-relay.cjs` (every 6 h, parser `scripts/lib/usni-fleet-parser.cjs`) | `src/services/usni-fleet.ts`, merged with AIS in `src/services/country-qualified-military.ts` | Check `news.usni.org` in the manifest | Needs a fixed outbound IP (proxy allowlist) |
| AIS ship traffic | Live vessel positions, tankers, dark-ship (AIS gap) counts | Geopolitics, Finance (chokepoints) | Relay HTTP `/ais/snapshot` / `MaritimeService.GetVesselSnapshot` (`server/worldmonitor/maritime/v1/get-vessel-snapshot.ts`) | AIS WebSocket client in `scripts/ais-relay.cjs` (aisstream.io, WebSocket only) | Map layer `ais` | aisstream.io key | Needs a long-running process. Lite's chokepoint status already reads the snapshot |

## Inventory at the tag

Generated from `src/config/panels.ts`, `src/config/lite-profile.ts`, `src/config/map-layer-definitions.ts` and `src/app/panel-layout.ts` at the tag. "In Lite profile" means the panel or layer was in the flag-on dashboard layout (`LITE_PANEL_ORDER`, `LITE_CROSS_VARIANT_PANELS`, `LITE_MAP_LAYERS`), not that the Lite UI shows it. A blank component cell means the panel is built inline: grep its ID in `src/app/panel-layout.ts` at the tag.

### Panels (164)

| Panel ID | Name | Variants | In Lite profile | Component (lazy-loaded) |
|---|---|---|---|---|
| `aaii-sentiment` | AAII Sentiment | full, finance |  | `src/components/AaiiSentimentPanel.ts` |
| `accelerators` | Accelerators & Demo Days | tech |  | `NewsPanel (feed category)` |
| `africa` | Africa | full |  | `NewsPanel (feed category)` |
| `ai` | AI/ML | full, tech | yes | `NewsPanel (feed category)` |
| `ai-regulation` | AI Regulation Dashboard | tech | yes |  |
| `ai-tokens` | AI Tokens | finance |  |  |
| `airline-intel` | Airline Intelligence | full, tech, finance, commodity |  | `src/components/AirlineIntelPanel.ts` |
| `analysis` | Market Analysis | finance |  | `NewsPanel (feed category)` |
| `asia` | Asia-Pacific | full |  | `NewsPanel (feed category)` |
| `base-metals` | Base Metals | commodity |  | `NewsPanel (feed category)` |
| `bigmac` | Big Mac Index | full |  | `src/components/BigMacPanel.ts` |
| `bonds` | Fixed Income | finance |  | `NewsPanel (feed category)` |
| `breakthroughs` | Breakthroughs | happy |  |  |
| `cascade` | Infrastructure Cascade | full |  | `src/components/CascadePanel.ts` |
| `centralbanks` | Central Bank Watch | finance | yes | `NewsPanel (feed category)` |
| `chat-analyst` | WM Analyst | full |  | `src/components/ChatAnalystPanel.ts` |
| `china-activity-nowcast` | China Activity Nowcast | full, finance, commodity, energy |  | `src/components/ChinaActivityNowcastPanel.ts` |
| `china-corridors` | China Logistics Corridors | full, finance, commodity, energy |  |  |
| `chokepoint-strip` | Chokepoint Status | energy |  | `src/components/ChokepointStripPanel.ts` |
| `cii` | Country Instability | full | yes | `src/components/CiiPanel.ts` |
| `climate` | Climate Anomalies | full, energy |  |  |
| `climate-news` | Climate News | full |  | `src/components/ClimateNewsPanel.ts` |
| `cloud` | Cloud & Infrastructure | tech |  | `NewsPanel (feed category)` |
| `commodities` | Metals & Materials | full, finance, commodity, energy |  | `NewsPanel (feed category)` |
| `commodities-news` | Commodities News | finance |  |  |
| `commodity-news` | Commodity News | commodity |  | `NewsPanel (feed category)` |
| `commodity-regulation` | Regulation & Policy | commodity |  | `NewsPanel (feed category)` |
| `consumer-prices` | Consumer Prices | full, finance, commodity |  | `src/components/ConsumerPricesPanel.ts` |
| `cot-positioning` | COT Positioning | full, finance |  | `src/components/CotPositioningPanel.ts` |
| `counters` | Live Counters | happy |  | `src/components/CountersPanel.ts` |
| `critical-minerals` | Critical Minerals | commodity |  | `NewsPanel (feed category)` |
| `cross-source-signals` | Cross-Source Signals | full | yes | `src/components/CrossSourceSignalsPanel.ts` |
| `crypto` | Crypto | full, tech, finance | yes | `NewsPanel (feed category)` |
| `crypto-heatmap` | Crypto Sectors | finance |  |  |
| `crypto-news` | Crypto News | finance | yes |  |
| `daily-market-brief` | Daily Market Brief | full, finance |  | `src/components/DailyMarketBriefPanel.ts` |
| `deduction` | Deduct Situation | full |  | `src/components/DeductionPanel.ts` |
| `defense-patents` | R&D Signal | full |  | `src/components/DefensePatentsPanel.ts` |
| `defi-tokens` | DeFi Tokens | finance |  |  |
| `derivatives` | Derivatives & Options | finance |  | `NewsPanel (feed category)` |
| `dev` | Developer Community | tech |  | `NewsPanel (feed category)` |
| `digest` | 5 Good Things | happy |  |  |
| `disaster-correlation` | Disaster Cascade | full |  | `src/components/DisasterCorrelationPanel.ts` |
| `disease-outbreaks` | Disease Outbreaks | full |  | `src/components/DiseaseOutbreaksPanel.ts` |
| `displacement` | UNHCR Displacement | full |  | `src/components/DisplacementPanel.ts` |
| `earnings-calendar` | Earnings Calendar | full, finance |  | `src/components/EarningsCalendarPanel.ts` |
| `economic` | Macro Stress | full, tech, finance, commodity |  | `src/components/EconomicPanel.ts` |
| `economic-calendar` | Economic Calendar | full, finance | yes | `src/components/EconomicCalendarPanel.ts` |
| `economic-correlation` | Economic Warfare | full |  | `src/components/EconomicCorrelationPanel.ts` |
| `economic-news` | Economic News | finance |  |  |
| `energy` | Energy & Resources | full, commodity, energy |  | `NewsPanel (feed category)` |
| `energy-complex` | Energy Complex | full, finance, commodity, energy |  | `src/components/EnergyComplexPanel.ts` |
| `energy-crisis` | Energy Crisis Tracker | full, energy |  | `src/components/EnergyCrisisPanel.ts` |
| `energy-disruptions` | Energy Disruptions Log | full, energy |  | `src/components/EnergyDisruptionsPanel.ts` |
| `energy-risk-overview` | Global Energy Risk Overview | full, energy |  | `src/components/EnergyRiskOverviewPanel.ts` |
| `escalation-correlation` | Escalation Monitor | full | yes | `src/components/EscalationCorrelationPanel.ts` |
| `etf-flows` | BTC ETF Tracker | full, tech, finance | yes | `src/components/EtfFlowsPanel.ts` |
| `europe` | Europe | full |  | `NewsPanel (feed category)` |
| `events` | Tech Events | tech |  | `src/components/TechEventsPanel.ts` |
| `fao-food-price-index` | FAO Food Price Index | full |  | `src/components/FaoFoodPriceIndexPanel.ts` |
| `fear-greed` | Fear & Greed | full, finance | yes | `src/components/FearGreedPanel.ts` |
| `fin-regulation` | Financial Regulation | finance |  | `NewsPanel (feed category)` |
| `finance` | Financial | full, tech |  | `NewsPanel (feed category)` |
| `fintech` | Fintech & Trading Tech | finance |  | `NewsPanel (feed category)` |
| `forecast` | AI Forecasts | full |  | `src/components/ForecastPanel.ts` |
| `forex` | Forex & Currencies | finance |  | `NewsPanel (feed category)` |
| `fsi` | Financial Stress | full, finance |  | `src/components/FsiPanel.ts` |
| `fuel-prices` | Fuel Prices | full, energy |  | `src/components/FuelPricesPanel.ts` |
| `fuel-shortages` | Global Fuel Shortage Registry | full, energy |  | `src/components/FuelShortagePanel.ts` |
| `funding` | Funding & VC | tech |  | `NewsPanel (feed category)` |
| `fx` | FX Rates | full, finance |  | `src/components/FxPanel.ts` |
| `gcc-investments` | GCC Investments | finance, commodity, energy |  | `src/components/InvestmentsPanel.ts` |
| `gdelt-intel` | Live Intelligence | full |  | `src/components/GdeltIntelPanel.ts` |
| `geo-hubs` | Geopolitical Hubs | full |  | `src/components/GeoHubsPanel.ts` |
| `github` | GitHub Trending | tech |  | `NewsPanel (feed category)` |
| `giving` | Global Giving | full, happy |  | `src/components/GivingPanel.ts` |
| `global-procurement` | Global Procurement | full, tech, finance |  | `src/components/GlobalProcurementPanel.ts` |
| `gold-intelligence` | Gold Intelligence | full, finance, commodity |  | `src/components/GoldIntelligencePanel.ts` |
| `gold-silver` | Gold & Silver | commodity |  | `NewsPanel (feed category)` |
| `gov` | Government | full |  | `NewsPanel (feed category)` |
| `grocery-basket` | Grocery Index | full |  | `src/components/GroceryBasketPanel.ts` |
| `gulf-economies` | Gulf Economies | full, finance, commodity, energy |  | `src/components/GulfEconomiesPanel.ts` |
| `hardware` | Semiconductors & Hardware | tech | yes | `NewsPanel (feed category)` |
| `heatmap` | Sector Heatmap | full, finance, commodity |  |  |
| `hormuz-tracker` | Hormuz Trade Tracker | full, energy |  |  |
| `insights` | AI Insights | full, tech, finance, commodity, energy | yes | `src/components/InsightsPanel.ts` |
| `institutional` | Hedge Funds & PE | finance |  | `NewsPanel (feed category)` |
| `intel` | Intel Feed | full |  | `NewsPanel (feed category)` |
| `internet-disruptions` | Internet Disruptions | tech |  | `src/components/InternetDisruptionsPanel.ts` |
| `ipo` | IPO & SPAC | tech, finance |  | `NewsPanel (feed category)` |
| `latam` | Latin America | full |  | `NewsPanel (feed category)` |
| `latest-brief` | Latest Brief | full, tech, finance, commodity, energy |  | `src/components/LatestBriefPanel.ts` |
| `layoffs` | Layoffs Tracker | full, tech |  | `NewsPanel (feed category)` |
| `liquidity-shifts` | Liquidity Shifts | full, finance, commodity |  | `src/components/LiquidityShiftsPanel.ts` |
| `live-news` | Live News | full, tech, finance, commodity, energy |  | `src/components/LiveNewsPanel.ts` |
| `live-webcams` | Live Webcams | full, tech, finance |  | `src/components/LiveWebcamsPanel.ts` |
| `macro-signals` | Market Regime | full, tech, finance, commodity, energy | yes | `src/components/MacroSignalsPanel.ts` |
| `macro-tiles` | Macro Indicators | full, finance |  | `src/components/MacroTilesPanel.ts` |
| `map` | Global Map | full, tech, finance, happy, commodity, energy | yes | `src/components/Map.ts` |
| `market-breadth` | Market Breadth | full, finance |  | `src/components/MarketBreadthPanel.ts` |
| `market-implications` | AI Market Implications | full |  | `src/components/MarketImplicationsPanel.ts` |
| `markets` | Markets | full, tech, finance, commodity | yes | `NewsPanel (feed category)` |
| `markets-news` | Markets News | finance |  |  |
| `material-events` | SEC Material Events | full, finance |  | `src/components/MaterialEventsPanel.ts` |
| `middleeast` | Middle East | full |  | `NewsPanel (feed category)` |
| `military-correlation` | Force Posture | full |  | `src/components/MilitaryCorrelationPanel.ts` |
| `mining-companies` | Mining Companies | commodity |  | `NewsPanel (feed category)` |
| `mining-news` | Mining News | commodity |  | `NewsPanel (feed category)` |
| `monitors` | My Monitors | full, tech, finance, commodity, energy | yes |  |
| `national-debt` | Global Debt Clock | full |  | `src/components/NationalDebtPanel.ts` |
| `news-market-correlation` | News ↔ Markets | full, finance, commodity |  | `src/components/NewsMarketCorrelationPanel.ts` |
| `nq-catalysts` | NQ Catalysts | finance |  | `src/components/NqCatalystsPanel.ts` |
| `nq-news` | NQ News | finance |  | `NewsPanel (feed category)` |
| `nq-pulse` | NQ Pulse | finance |  | `src/components/NqPulsePanel.ts` |
| `oil-inventories` | Oil Inventories | full, commodity, energy |  | `src/components/OilInventoriesPanel.ts` |
| `oref-sirens` | Israel Sirens | full |  | `src/components/OrefSirensPanel.ts` |
| `other-tokens` | Alt Tokens | finance |  |  |
| `pipeline-status` | Oil & Gas Pipeline Status | full, finance, commodity, energy |  | `src/components/PipelineStatusPanel.ts` |
| `policy` | AI Policy & Regulation | tech | yes | `NewsPanel (feed category)` |
| `politics` | World News | full |  | `NewsPanel (feed category)` |
| `polymarket` | Predictions | full, tech, finance, commodity |  |  |
| `population-exposure` | Population Exposure | full |  | `src/components/PopulationExposurePanel.ts` |
| `positioning-247` | 24/7 Positioning | full, finance, commodity |  |  |
| `positive-feed` | Good News Feed | happy |  |  |
| `producthunt` | Product Hunt | tech |  | `NewsPanel (feed category)` |
| `progress` | Human Progress | happy |  |  |
| `radiation-watch` | Radiation Watch | full |  | `src/components/RadiationWatchPanel.ts` |
| `regional-intelligence` | Regional Intelligence | full |  | `src/components/RegionalIntelligenceBoard.ts` |
| `renewable` | Renewable Energy | happy, energy |  |  |
| `sanctions-pressure` | Sanctions Pressure | full, finance, commodity, energy |  | `src/components/SanctionsPressurePanel.ts` |
| `satellite-fires` | Fires | full |  | `src/components/SatelliteFiresPanel.ts` |
| `science` | Science | full |  | `NewsPanel (feed category)` |
| `security` | Cybersecurity | tech |  | `NewsPanel (feed category)` |
| `security-advisories` | Security Advisories | full |  | `src/components/SecurityAdvisoriesPanel.ts` |
| `service-status` | Service Status | tech |  | `src/components/ServiceStatusPanel.ts` |
| `social-velocity` | Social Velocity | full |  | `src/components/SocialVelocityPanel.ts` |
| `species` | Conservation Wins | happy |  |  |
| `stablecoins` | Stablecoins | full, tech, finance | yes |  |
| `startups` | Startups & VC | tech |  | `NewsPanel (feed category)` |
| `stock-analysis` | Stock Analysis | full, finance |  | `src/components/StockAnalysisPanel.ts` |
| `stock-backtest` | Backtesting | full, finance |  | `src/components/StockBacktestPanel.ts` |
| `storage-facility-map` | Strategic Storage Atlas | full, energy |  | `src/components/StorageFacilityMapPanel.ts` |
| `strategic-posture` | AI Strategic Posture | full | yes | `src/components/StrategicPosturePanel.ts` |
| `strategic-risk` | Strategic Risk Overview | full | yes | `src/components/StrategicRiskPanel.ts` |
| `supply-chain` | Supply Chain | full, finance, commodity, energy |  | `src/components/SupplyChainPanel.ts` |
| `tech` | Technology | full, tech | yes | `NewsPanel (feed category)` |
| `tech-hubs` | Hot Tech Hubs | full, tech |  | `src/components/TechHubsPanel.ts` |
| `tech-readiness` | Tech Readiness Index | full, tech | yes | `src/components/TechReadinessPanel.ts` |
| `telegram-intel` | Telegram Intel | full |  | `src/components/TelegramIntelPanel.ts` |
| `thermal-escalation` | Thermal Escalation | full |  | `src/components/ThermalEscalationPanel.ts` |
| `thinktanks` | Think Tanks | full |  | `NewsPanel (feed category)` |
| `threat-timeline` | Threat Timeline | full | yes | `src/components/ThreatTimelinePanel.ts` |
| `toronto-safety` | Toronto Safety | full |  | `src/components/TorontoSafetyPanel.ts` |
| `trade-policy` | Trade Policy | full, finance, commodity |  | `src/components/TradePolicyPanel.ts` |
| `ucdp-events` | UCDP Conflict Events | full | yes | `src/components/UcdpEventsPanel.ts` |
| `ukmto-incidents` | UKMTO Incidents | full |  | `src/components/UkmtoIncidentsPanel.ts` |
| `unicorns` | Unicorn Tracker | tech |  | `NewsPanel (feed category)` |
| `us` | United States | full |  | `NewsPanel (feed category)` |
| `vcblogs` | VC Insights & Essays | tech |  | `NewsPanel (feed category)` |
| `windy-webcams` | Windy Live Webcam | full, tech, finance |  |  |
| `world-clock` | World Clock | full, tech, finance, commodity, energy |  | `src/components/WorldClockPanel.ts` |
| `wsb-ticker-scanner` | WSB Ticker Scanner | full, finance |  | `src/components/WsbTickerScannerPanel.ts` |
| `x-intel` | X News Accounts | full |  | `src/components/XIntelPanel.ts` |
| `yield-curve` | Yield Curve | full, finance |  | `src/components/YieldCurvePanel.ts` |

### Map layers (60)

| Layer key | Label | In Lite profile |
|---|---|---|
| `accelerators` | Accelerators |  |
| `aircraftEmergencies` | Aircraft Emergencies |  |
| `ais` | Ship Traffic |  |
| `bases` | Military Bases |  |
| `cables` | Undersea Cables |  |
| `canadaAlerts` | Canada Alerts |  |
| `canadaRoads` | Canada Roads |  |
| `centralBanks` | Central Banks |  |
| `ciiChoropleth` | Country Instability | yes |
| `climate` | Climate Anomalies |  |
| `cloudRegions` | Cloud Regions |  |
| `commodityHubs` | Commodity Hubs |  |
| `commodityPorts` | Commodity Ports |  |
| `conflicts` | Conflict Zones | yes |
| `cyberThreats` | Cyber Threats |  |
| `datacenters` | AI Data Centers | yes |
| `dayNight` | Day/Night |  |
| `diseaseOutbreaks` | Disease Outbreaks |  |
| `displacement` | Displacement Flows |  |
| `economic` | Economic Centers |  |
| `financialCenters` | Financial Centers |  |
| `fires` | Fires |  |
| `flights` | Aviation |  |
| `fuelShortages` | Fuel Shortages |  |
| `gpsJamming` | GPS Jamming |  |
| `gulfInvestments` | GCC Investments |  |
| `happiness` | World Happiness |  |
| `hotspots` | Intel Hotspots | yes |
| `iranAttacks` | Middle East Strikes |  |
| `irradiators` | Gamma Irradiators |  |
| `kindness` | Acts of Kindness |  |
| `liveTankers` | Live Tanker Positions |  |
| `military` | Military Activity | yes |
| `minerals` | Critical Minerals |  |
| `miningSites` | Mining Sites |  |
| `natural` | Natural Events |  |
| `no2Activity` | Industrial Activity |  |
| `nuclear` | Nuclear Sites |  |
| `outages` | Internet Disruptions |  |
| `pipelines` | Pipelines |  |
| `positiveEvents` | Positive Events |  |
| `processingPlants` | Processing Plants |  |
| `protests` | Protests |  |
| `radiationWatch` | Radiation Watch |  |
| `renewableInstallations` | Clean Energy |  |
| `resilienceScore` | Country Resilience |  |
| `sanctions` | Sanctions | yes |
| `satellites` | Orbital Surveillance |  |
| `spaceports` | Spaceports |  |
| `speciesRecovery` | Species Recovery |  |
| `startupHubs` | Startup Hubs |  |
| `stockExchanges` | Stock Exchanges |  |
| `storageFacilities` | Storage Facilities |  |
| `techEvents` | Tech Events |  |
| `techHQs` | Tech HQs |  |
| `tradeRoutes` | Trade Routes |  |
| `ucdpEvents` | Armed Conflict Events | yes |
| `waterways` | Chokepoints |  |
| `weather` | Weather Alerts |  |
| `webcams` | Live Webcams |  |
