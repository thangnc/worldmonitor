# Source Attribution

Machine-generated inventory of every source host World Monitor uses: provider
identity, observed surface, and source references. The Lite UI's Sources screen
(`apps/web/src/lite/screens/Sources.tsx`) reads the same manifest.

The inventory is **generated, not hand-written**: `scripts/source-attribution.mjs`
scans source declarations in `scripts/`, `packages/server/`, `api/`, `apps/web/src/` and
`packages/client/`, and joins them against the committed manifest
(`packages/shared/source-attribution-manifest.json`). Run `npm run sources:generate` after
adding or removing a host; `npm run sources:check` fails when this page or the
manifest is stale. Do not edit the table by hand.

## Observed Source Inventory

{/* BEGIN GENERATED SOURCE ATTRIBUTION */}
This generated inventory covers **849 active source hosts** representing **829 active providers** (**365 structured/API**, **468 feed**, and **30 operational-status** hosts). It is derived from source declarations in `scripts/`, `packages/server/`, `api/`, `apps/web/src/`, and `packages/client/`. Each row shows the configured provider identity and where the source is referenced. Syndication transports such as FeedBurner and Google News remain listed as hosts and are not counted as publishers.

| Provider | Observed surface |
| --- | --- |
| +972 Magazine (www.972mag.com) | feed — packages/shared/news-catalog.json |
| 14ymedio (www.14ymedio.com) | feed — packages/shared/news-catalog.json |
| 24.hu (24.hu) | feed — packages/shared/news-catalog.json |
| 247preview.foxnews.com (247preview.foxnews.com) | feed — packages/client/config/live-video-sources.ts |
| 36kr.com (36kr.com) | feed — packages/shared/news-catalog.json |
| 444.hu (444.hu) | feed — packages/shared/news-catalog.json |
| a16z.com (a16z.com) | feed — packages/shared/news-catalog.json |
| abacus.worldmonitor.app (abacus.worldmonitor.app) | Excluded / candidate — No current fetch observed |
| abc-iview-mediapackagestreams-2.akamaized.net (abc-iview-mediapackagestreams-2.akamaized.net) | feed — packages/client/config/live-video-sources.ts |
| abplivetv.pc.cdn.bitgravity.com (abplivetv.pc.cdn.bitgravity.com) | Excluded / candidate — No current fetch observed |
| acleddata.com (acleddata.com) | structured — packages/server/_shared/acled-auth.ts, packages/server/_shared/acled.ts, scripts/seed-conflict-intel.mjs, scripts/seed-unrest-events.mjs, +1 more |
| actualite.cd (actualite.cd) | feed — packages/shared/news-catalog.json |
| ActuNiger (actuniger.com) | feed — packages/shared/news-catalog.json |
| admin.gse.com.ge (admin.gse.com.ge) | structured — scripts/shared/regional-energy-feeds.json |
| adsb.fi Open Data (opendata.adsb.fi) | structured — scripts/seed-military-flights.mjs |
| adsb.lol (api.adsb.lol) | structured — scripts/ais-relay.cjs, scripts/seed-military-flights.mjs |
| ae.usembassy.gov (ae.usembassy.gov) | structured — scripts/seed-security-advisories.mjs |
| aerotime.aero (aerotime.aero) | structured — scripts/seed-aviation.mjs |
| agentskills.io (agentskills.io) | Excluded / candidate — No current fetch observed |
| agsi.gie.eu (agsi.gie.eu) | structured — scripts/seed-gas-storage-countries.mjs, scripts/seed-gie-gas-storage.mjs |
| Aïr Info (airinfoagadez.com) | feed — packages/shared/news-catalog.json |
| airlinegeeks.com (airlinegeeks.com) | structured — scripts/seed-aviation.mjs |
| airplanes.live (api.airplanes.live) | structured — scripts/seed-military-flights.mjs |
| Al Jazeera (aljazeera.com) | feed — packages/shared/news-catalog.json |
| Al Jazeera (www.aljazeera.com) | feed — packages/shared/news-catalog.json |
| Alberta 511 (511.alberta.ca) | structured — scripts/lib/provincial-511.mjs |
| Alberta Emergency Alert (www.alberta.ca) | structured — scripts/lib/alberta-emergency-alert.mjs, scripts/source-attribution.mjs |
| Alternative.me Fear & Greed Index (api.alternative.me) | structured — scripts/seed-economy.mjs |
| Alwihda Info (www.alwihdainfo.com) | feed — packages/shared/news-catalog.json |
| amdlive-ch01-ctnd-com.akamaized.net (amdlive-ch01-ctnd-com.akamaized.net) | feed — packages/client/config/live-video-sources.ts |
| amg00106-france24-france24-samsunguk-qvpp8.amagi.tv (amg00106-france24-france24-samsunguk-qvpp8.amagi.tv) | feed — packages/client/config/live-video-sources.ts |
| ammancity.gov.jo (ammancity.gov.jo) | structured — scripts/lib/food-prices-adapters/amman.mjs |
| amna.gr (amna.gr) | feed — packages/shared/news-catalog.json |
| Amu TV (amu.tv) | feed — packages/shared/news-catalog.json |
| angellist.com (angellist.com) | feed — packages/shared/news-catalog.json |
| Annahar (annahar.com) | feed — packages/shared/news-catalog.json |
| api-nms.aim.faa.gov (api-nms.aim.faa.gov) | structured — scripts/seed-notam-nms.mjs |
| api.abuseipdb.com (api.abuseipdb.com) | structured — scripts/ais-relay.cjs, scripts/seed-cyber-threats.mjs |
| api.anthropic.com (api.anthropic.com) | structured — packages/server/_shared/llm-anthropic.ts |
| api.aviationstack.com (api.aviationstack.com) | structured — scripts/ais-relay.cjs, scripts/seed-aviation.mjs |
| api.axios.com (api.axios.com) | feed — packages/shared/news-catalog.json |
| api.cammesa.com (api.cammesa.com) | structured — scripts/_regional-energy-source.mjs, scripts/shared/regional-energy-feeds.json |
| api.cloudflare.com (api.cloudflare.com) | structured — scripts/_kv-storage.mjs, scripts/_r2-storage.mjs, scripts/seed-internet-outages.mjs, scripts/seed-military-bases.mjs |
| api.coingecko.com (api.coingecko.com) | structured — scripts/ais-relay.cjs |
| api.data.gov.my (api.data.gov.my) | structured — scripts/_dosm-product-demand.mjs, scripts/backfill-fuel-prices-prev.mjs, scripts/seed-fuel-prices.mjs |
| api.datos.gob.mx (api.datos.gob.mx) | structured — scripts/backfill-fuel-prices-prev.mjs |
| api.e-stat.go.jp (api.e-stat.go.jp) | structured — scripts/seed-world-cpi-estat.mjs |
| api.eia.gov (api.eia.gov) | structured — scripts/backfill-fuel-prices-prev.mjs, scripts/seed-economy.mjs, scripts/seed-eia-petroleum.mjs, scripts/seed-electricity-prices.mjs, +2 more |
| api.exa.ai (api.exa.ai) | structured — packages/server/worldmonitor/market/v1/stock-news-search.ts, scripts/ais-relay.cjs, scripts/lib/company-monitoring-exa.mjs, scripts/seed-bigmac.mjs, +1 more |
| api.fiscaldata.treasury.gov (api.fiscaldata.treasury.gov) | structured — scripts/seed-national-debt.mjs, scripts/seed-supply-chain-trade.mjs |
| api.gdeltproject.org (api.gdeltproject.org) | structured — scripts/seed-gdelt-intel.mjs, scripts/seed-unrest-events.mjs |
| api.gdeltproject.org (storage.googleapis.com) | structured — scripts/_conflict-gdelt-bulk.mjs, scripts/_gdelt-bulk-materializer.mjs |
| api.github.com (api.github.com) | structured — scripts/resolve-railway-reconcile-control.mjs, scripts/seed-fuel-prices.mjs, scripts/seed-research.mjs |
| api.groq.com (api.groq.com) | Excluded / candidate — No current fetch observed |
| api.iea.org (api.iea.org) | structured — scripts/seed-iea-oil-stocks.mjs |
| api.imf.org (api.imf.org) | structured — scripts/_seed-utils.mjs, scripts/backtest-capital-flow-episodes.mjs, scripts/seed-capital-flows.mjs, scripts/seed-gold-cb-reserves.mjs, +1 more |
| api.indexnow.org (api.indexnow.org) | Excluded / candidate — No current fetch observed |
| api.mercadopublico.cl (api.mercadopublico.cl) | structured — scripts/_global-tender-feeds.mjs |
| api.ossinsight.io (api.ossinsight.io) | structured — scripts/seed-research.mjs |
| api.planespotters.net (api.planespotters.net) | structured — packages/server/worldmonitor/military/v1/get-wingbits-live-flight.ts |
| api.rainviewer.com (api.rainviewer.com) | Excluded / candidate — No current fetch observed |
| api.riksbank.se (api.riksbank.se) | structured — scripts/seed-yield-curve-se.mjs |
| api.sam.gov (api.sam.gov) | structured — scripts/seed-global-tenders.mjs |
| api.scrapecreators.com (api.scrapecreators.com) | structured — scripts/ais-relay.cjs |
| api.spdrgoldshares.com (api.spdrgoldshares.com) | structured — scripts/seed-gold-etf-flows.mjs |
| api.statistiken.bundesbank.de (api.statistiken.bundesbank.de) | structured — scripts/seed-yield-curve-de.mjs |
| api.stlouisfed.org (api.stlouisfed.org) | structured — scripts/seed-economic-calendar.mjs, scripts/seed-rate-odds.mjs, scripts/seed-us-cpi.mjs, scripts/seed-us-interest-rates.mjs |
| api.ted.europa.eu (api.ted.europa.eu) | structured — scripts/seed-global-tenders.mjs |
| api.telegram.org (api.telegram.org) | Excluded / candidate — No current fetch observed |
| api.typesafe.ai (api.typesafe.ai) | structured — scripts/lib/internal-links.mjs |
| api.tzevaadom.co.il (api.tzevaadom.co.il) | structured — scripts/ais-relay.cjs |
| api.unhcr.org (api.unhcr.org) | structured — scripts/seed-displacement-summary.mjs |
| api.usaspending.gov (api.usaspending.gov) | structured — scripts/ais-relay.cjs, scripts/seed-usa-spending.mjs |
| api.weather.gov (api.weather.gov) | structured — scripts/_weather-alert-select.mjs |
| api.windy.com (api.windy.com) | structured — scripts/seed-webcams.mjs |
| api.wto.org (api.wto.org) | structured — scripts/seed-supply-chain-trade.mjs |
| apnews.com (apnews.com) | feed — packages/shared/news-catalog.json |
| arabianbusiness.com (arabianbusiness.com) | feed — packages/shared/news-catalog.json |
| arabnews.com (arabnews.com) | feed — packages/shared/news-catalog.json |
| archive-api.open-meteo.com (archive-api.open-meteo.com) | structured — scripts/_open-meteo-archive.mjs |
| arctictoday.com (arctictoday.com) | feed — packages/shared/news-catalog.json |
| armenpress.am (armenpress.am) | feed — packages/shared/news-catalog.json |
| armscontrol.org (armscontrol.org) | feed — packages/shared/news-catalog.json |
| arxiv.org (arxiv.org) | structured — scripts/seed-research.mjs |
| asharq.com (asharq.com) | feed — packages/shared/news-catalog.json |
| asharqbusiness.com (asharqbusiness.com) | feed — packages/shared/news-catalog.json |
| asia.nikkei.com (asia.nikkei.com) | feed — packages/shared/news-catalog.json |
| asianews.it (asianews.it) | feed — packages/shared/news-catalog.json |
| astanatimes.com (astanatimes.com) | feed — packages/shared/news-catalog.json |
| AusTender (www.tenders.gov.au) | structured — scripts/seed-global-tenders.mjs |
| av.alarabiya.net (av.alarabiya.net) | feed — packages/client/config/live-video-sources.ts |
| aws.amazon.com (aws.amazon.com) | Excluded / candidate — No current fetch observed |
| Axiom telemetry (api.axiom.co) | structured — api/_usage-telemetry.js, packages/server/_shared/usage.ts, scripts/deploy-error-canary.mjs, scripts/lib/llm-telemetry.cjs, +1 more |
| AyiboPost (ayibopost.com) | feed — packages/shared/news-catalog.json |
| azertag.az (azertag.az) | feed — packages/shared/news-catalog.json |
| azure.status.microsoft (azure.status.microsoft) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| B.C. Evacuation Orders and Alerts (catalogue.data.gov.bc.ca) | structured — scripts/lib/bc-emergency-info.mjs |
| B.C. Evacuation Orders and Alerts (services6.arcgis.com) | structured — scripts/lib/bc-emergency-info.mjs |
| balkaninsight.com (balkaninsight.com) | feed — packages/shared/news-catalog.json |
| bangkokpost.com (bangkokpost.com) | feed — packages/shared/news-catalog.json |
| Bank of Canada (www.bankofcanada.ca) | structured — scripts/lib/boc-valet.mjs, scripts/seed-yield-curve-ca.mjs |
| Barchart (www.barchart.com) | structured — scripts/seed-fear-greed.mjs |
| basemaps.cartocdn.com (basemaps.cartocdn.com) | Excluded / candidate — No current fetch observed |
| BBC (feeds.bbci.co.uk) | feed — packages/shared/news-catalog.json |
| BBC (www.bbc.com) | feed — packages/shared/news-catalog.json |
| BC Open511 (api.open511.gov.bc.ca) | structured — scripts/lib/open511.mjs |
| BC Wildfire Service (OpenMaps) (openmaps.gov.bc.ca) | structured — scripts/wildfire/bc-fire-points.mjs |
| bcovlive-a.akamaihd.net (bcovlive-a.akamaihd.net) | Excluded / candidate — No current fetch observed |
| bd.usembassy.gov (bd.usembassy.gov) | structured — scripts/seed-security-advisories.mjs |
| bellingcat.com (bellingcat.com) | feed — packages/shared/news-catalog.json |
| besttime.app (besttime.app) | structured — scripts/ais-relay.cjs |
| bihus.info (bihus.info) | feed — packages/shared/news-catalog.json |
| Binance (binance.com) | feed — packages/shared/news-catalog.json |
| bitbucket.status.atlassian.com (bitbucket.status.atlassian.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| bitcoinmagazine.com (bitcoinmagazine.com) | feed — packages/shared/news-catalog.json |
| bloomberg.com (bloomberg.com) | feed — packages/client/config/live-video-sources.ts, packages/shared/news-catalog.json |
| bothsidesofthetable.com (bothsidesofthetable.com) | Excluded / candidate — No current fetch observed |
| Brave Search API (api.search.brave.com) | structured — packages/server/worldmonitor/market/v1/stock-news-search.ts, scripts/ais-relay.cjs |
| breakingdefense.com (breakingdefense.com) | feed — packages/shared/news-catalog.json |
| British Geological Survey World Mineral Statistics (ogcapi.bgs.ac.uk) | structured — scripts/seed-mineral-production.mjs |
| British Geological Survey World Mineral Statistics (www.bgs.ac.uk) | structured — scripts/seed-supply-vulnerability.mjs |
| brookings.edu (brookings.edu) | feed — packages/shared/news-catalog.json |
| budgetlab.yale.edu (budgetlab.yale.edu) | structured — scripts/_trade-parse-utils.mjs |
| Business Insider (www.businessinsider.com) | feed — packages/shared/news-catalog.json |
| Business Wire (feed.businesswire.com) | feed — packages/shared/news-catalog.json |
| calgaryherald.com (calgaryherald.com) | feed — packages/shared/news-catalog.json |
| canadabuys.canada.ca (canadabuys.canada.ca) | structured — scripts/seed-global-tenders.mjs |
| Caracas Chronicles (www.caracaschronicles.com) | feed — packages/shared/news-catalog.json |
| carnegieendowment.org (carnegieendowment.org) | feed — packages/shared/news-catalog.json |
| cbcnewshd-f.akamaihd.net (cbcnewshd-f.akamaihd.net) | Excluded / candidate — No current fetch observed |
| cbinsights.com (cbinsights.com) | feed — packages/shared/news-catalog.json |
| cbsn-us.cbsnstream.cbsnews.com (cbsn-us.cbsnstream.cbsnews.com) | feed — packages/client/config/live-video-sources.ts |
| cdc.gov (cdc.gov) | feed — packages/shared/news-catalog.json |
| cdn-ca2-na.lncnetworks.host (cdn-ca2-na.lncnetworks.host) | Excluded / candidate — No current fetch observed |
| cdn-uw2-prod.tsv2.amagi.tv (cdn-uw2-prod.tsv2.amagi.tv) | feed — packages/client/config/live-video-sources.ts |
| cdn.debugbear.com (cdn.debugbear.com) | structured — packages/client/bootstrap/debugbear-rum.ts |
| cdnlive.presstv.ir (cdnlive.presstv.ir) | Excluded / candidate — No current fetch observed |
| celestrak.org (celestrak.org) | structured — scripts/ais-relay.cjs |
| CFTC Commitments of Traders (publicreporting.cftc.gov) | structured — scripts/seed-cot.mjs |
| CFTC public notices (www.cftc.gov) | structured — scripts/seed-regulatory-actions.mjs |
| Chainwire (chainwire.org) | feed — packages/shared/news-catalog.json |
| challenges.cloudflare.com (challenges.cloudflare.com) | structured — packages/server/_shared/turnstile.ts |
| changelog.com (changelog.com) | feed — packages/shared/news-catalog.json |
| ChatGPT link (chatgpt.com) | Excluded / candidate — No current fetch observed |
| chathamhouse.org (chathamhouse.org) | feed — packages/shared/news-catalog.json |
| citinewsroom.com (citinewsroom.com) | feed — packages/shared/news-catalog.json |
| City of Toronto Open Data (ckan0.cf.opendata.inter.prod-toronto.ca) | structured — scripts/lib/tps-open-data.mjs |
| City of Toronto Open Data (open.toronto.ca) | structured — scripts/lib/tps-open-data.mjs |
| City of Toronto Open Data (secure.toronto.ca) | structured — scripts/lib/toronto-road-restrictions.mjs |
| civil.ge (civil.ge) | feed — packages/shared/news-catalog.json |
| Claude link (claude.ai) | Excluded / candidate — No current fetch observed |
| Clerk identity service (api.clerk.com) | Excluded / candidate — No current fetch observed |
| climate.copernicus.eu (climate.copernicus.eu) | structured — scripts/seed-climate-news.mjs |
| Cloudflare Browser MCP (browser.mcp.cloudflare.com) | Excluded / candidate — No current fetch observed |
| Cloudflare Radar MCP (radar.mcp.cloudflare.com) | Excluded / candidate — No current fetch observed |
| cloudflare-dns.com (cloudflare-dns.com) | structured — api/_notification-webhook-ssrf.ts |
| cnas.org (cnas.org) | feed — packages/shared/news-catalog.json |
| cnbc.com (cnbc.com) | feed — packages/shared/news-catalog.json |
| cnn.com (cnn.com) | feed — packages/shared/news-catalog.json |
| cnn.gr (cnn.gr) | feed — packages/shared/news-catalog.json |
| co.usembassy.gov (co.usembassy.gov) | structured — scripts/seed-security-advisories.mjs |
| Coinbase (coinbase.com) | feed — packages/shared/news-catalog.json |
| CoinPaprika (api.coinpaprika.com) | structured — packages/server/worldmonitor/market/v1/_shared.ts, scripts/_seed-utils.mjs, scripts/ais-relay.cjs |
| cointelegraph.com (cointelegraph.com) | feed — packages/shared/news-catalog.json |
| collisionconf.com (collisionconf.com) | Excluded / candidate — No current fetch observed |
| commodity.worldmonitor.app (commodity.worldmonitor.app) | Excluded / candidate — No current fetch observed |
| comtradeapi.un.org (comtradeapi.un.org) | structured — packages/server/worldmonitor/supply-chain/v1/_bilateral-hs4-lazy.ts, scripts/seed-comtrade-bilateral-hs4.mjs, scripts/seed-oil-trade-series.mjs, scripts/seed-recovery-import-hhi.mjs, +3 more |
| confluence.status.atlassian.com (confluence.status.atlassian.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| conservationoptimism.org (conservationoptimism.org) | feed — packages/shared/news-catalog.json |
| contxto.com (contxto.com) | Excluded / candidate — No current fetch observed |
| correctiv.org (correctiv.org) | feed — packages/shared/news-catalog.json |
| corridorrisk.io (corridorrisk.io) | structured — scripts/ais-relay.cjs |
| corriere.it (corriere.it) | feed — packages/shared/news-catalog.json |
| cp24.com (cp24.com) | feed — packages/shared/news-catalog.json |
| creativecommons.org (creativecommons.org) | structured — packages/server/worldmonitor/displacement/v1/cross-border-data.ts |
| creg.gov.co (creg.gov.co) | structured — scripts/lib/regional-fuel-feeds.mjs, scripts/shared/regional-energy-feeds.json |
| cryptoslate.com (cryptoslate.com) | feed — packages/shared/news-catalog.json |
| csis.org (csis.org) | feed — packages/shared/news-catalog.json |
| ctvnews.ca (ctvnews.ca) | feed — packages/shared/news-catalog.json |
| customer.dodopayments.com (customer.dodopayments.com) | Excluded / candidate — No current fetch observed |
| CWFIS / CWFIF (NRCan) (geoserver.cwfif.nrcan.gc.ca) | structured — scripts/wildfire/cwfis-wfs.mjs |
| dados.ons.org.br (dados.ons.org.br) | structured — scripts/shared/regional-energy-feeds.json |
| dai2.xumo.com (dai2.xumo.com) | Excluded / candidate — No current fetch observed |
| Daily Nation (nation.africa) | feed — packages/shared/news-catalog.json |
| dailytrust.com (dailytrust.com) | feed — packages/shared/news-catalog.json |
| dash4.antik.sk (dash4.antik.sk) | feed — packages/client/config/live-video-sources.ts |
| data-api.ecb.europa.eu (data-api.ecb.europa.eu) | structured — scripts/lib/yield-curves/oecd-lt.mjs, scripts/seed-ecb-fx-rates.mjs, scripts/seed-ecb-short-rates.mjs, scripts/seed-yield-curve-eu.mjs |
| data.1212.mn (data.1212.mn) | structured — scripts/lib/food-prices-adapters/nsomn.mjs |
| data.api.abs.gov.au (data.api.abs.gov.au) | structured — scripts/seed-world-cpi-abs.mjs |
| data.ecb.europa.eu (data.ecb.europa.eu) | structured — scripts/seed-fsi-eu.mjs |
| data.humdata.org (data.humdata.org) | structured — scripts/_conflict-hapi.mjs, scripts/benchmark-resilience-external.mjs, scripts/seed-idmc-idu-displacement.mjs, scripts/seed-resilience-static.mjs |
| data.norges-bank.no (data.norges-bank.no) | structured — scripts/seed-yield-curve-no.mjs |
| data.snb.ch (data.snb.ch) | structured — scripts/seed-yield-curve-ch.mjs |
| data.ssb.no (data.ssb.no) | structured — scripts/seed-fuel-prices.mjs |
| data.stats.gov.cn (data.stats.gov.cn) | structured — scripts/china-macro/extract-nbs-national-data.mjs |
| data.unhcr.org (data.unhcr.org) | structured — packages/server/worldmonitor/displacement/v1/cross-border-data.ts, scripts/seed-cross-border-arrivals.mjs |
| data.weather.gov.hk (data.weather.gov.hk) | structured — scripts/natural/western-pacific-cyclones.mjs |
| data.worldbank.org (data.worldbank.org) | structured — scripts/seed-education-attainment.mjs, scripts/seed-wb-external-debt.mjs |
| datalab.wto.org (datalab.wto.org) | structured — scripts/seed-hormuz.mjs |
| dataservices.icao.int (dataservices.icao.int) | structured — scripts/ais-relay.cjs, scripts/seed-aviation.mjs |
| datosabiertos.dgcp.gob.do (datosabiertos.dgcp.gob.do) | structured — scripts/_global-tender-feeds.mjs |
| de.euronews.com (de.euronews.com) | feed — packages/shared/news-catalog.json |
| de.usembassy.gov (de.usembassy.gov) | structured — scripts/seed-security-advisories.mjs |
| decrypt.co (decrypt.co) | feed — packages/shared/news-catalog.json |
| defense.gov (defense.gov) | Excluded / candidate — No current fetch observed |
| dev.events (dev.events) | structured — packages/server/worldmonitor/research/v1/list-tech-events.ts, scripts/ais-relay.cjs, scripts/seed-research.mjs |
| dev.to (dev.to) | feed — packages/shared/news-catalog.json |
| devops.com (devops.com) | feed — packages/shared/news-catalog.json |
| dfrlab.org (dfrlab.org) | feed — packages/shared/news-catalog.json |
| Dhaka Tribune (dhakatribune.com) | feed — packages/shared/news-catalog.json |
| dhs.gov (dhs.gov) | feed — packages/shared/news-catalog.json |
| digital-strategy.ec.europa.eu (digital-strategy.ec.europa.eu) | structured — scripts/seed-ai-regulation.mjs |
| discord.com (discord.com) | Excluded / candidate — No current fetch observed |
| discord.gg (discord.gg) | Excluded / candidate — No current fetch observed |
| discordstatus.com (discordstatus.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| disrupt-africa.com (disrupt-africa.com) | Excluded / candidate — No current fetch observed |
| dlnews.com (dlnews.com) | feed — packages/shared/news-catalog.json |
| do.usembassy.gov (do.usembassy.gov) | structured — scripts/seed-security-advisories.mjs |
| doe.gov.ph (d24qbtp4vooyzi.cloudfront.net) | structured — scripts/lib/regional-fuel-feeds.mjs |
| doe.gov.ph (doe.gov.ph) | structured — scripts/shared/regional-energy-feeds.json |
| drmkc.jrc.ec.europa.eu (drmkc.jrc.ec.europa.eu) | structured — scripts/benchmark-resilience-external.mjs |
| dtmapi.iom.int (dtmapi.iom.int) | structured — scripts/seed-dtm-displacement.mjs |
| dw.com (dw.com) | feed — packages/shared/news-catalog.json |
| dwamdstream103.akamaized.net (dwamdstream103.akamaized.net) | feed — packages/client/config/live-video-sources.ts |
| dwamdstream104.akamaized.net (dwamdstream104.akamaized.net) | feed — packages/client/config/live-video-sources.ts |
| e00-elmundo.uecdn.es (e00-elmundo.uecdn.es) | feed — packages/shared/news-catalog.json |
| earthobservatory.nasa.gov (earthobservatory.nasa.gov) | structured — scripts/seed-climate-news.mjs |
| earthquake.usgs.gov (earthquake.usgs.gov) | structured — scripts/seed-earthquakes.mjs |
| Earthquakes Canada (NRCan) (www.earthquakescanada.nrcan.gc.ca) | structured — scripts/seismology/nrcan-atom.mjs |
| ec.europa.eu (ec.europa.eu) | feed+structured — packages/server/worldmonitor/resilience/v1/_indicator-source-policy.ts, packages/shared/news-catalog.json, scripts/_eurostat-utils.mjs, scripts/seed-economic-calendar.mjs, +2 more |
| ecfr.eu (ecfr.eu) | feed — packages/shared/news-catalog.json |
| edmontonjournal.com (edmontonjournal.com) | feed — packages/shared/news-catalog.json |
| Efecto Cocuyo (efectococuyo.com) | feed — packages/shared/news-catalog.json |
| eff.org (eff.org) | feed — packages/shared/news-catalog.json |
| Egypt Independent (www.egyptindependent.com) | feed — packages/shared/news-catalog.json |
| eia.gov (eia.gov) | feed — packages/shared/news-catalog.json |
| Element84 Earth Search STAC (earth-search.aws.element84.com) | Excluded / candidate — No current fetch observed |
| Ember electricity data (files.ember-energy.org) | structured — scripts/seed-ember-electricity.mjs |
| en.irna.ir (en.irna.ir) | feed — packages/shared/news-catalog.json |
| en.mehrnews.com (en.mehrnews.com) | feed — packages/shared/news-catalog.json |
| en.sge.com.cn (en.sge.com.cn) | structured — scripts/seed-physical-premiums.mjs |
| en.sse.net.cn (en.sse.net.cn) | structured — scripts/seed-supply-chain-trade.mjs |
| en.wikipedia.org (en.wikipedia.org) | structured — packages/server/worldmonitor/intelligence/v1/get-country-facts.ts, scripts/seed-sovereign-wealth.mjs |
| Enab Baladi English (english.enabbaladi.net) | feed — packages/shared/news-catalog.json |
| energy.ec.europa.eu (energy.ec.europa.eu) | structured — scripts/backfill-fuel-prices-prev.mjs, scripts/seed-fuel-prices.mjs |
| energy.worldmonitor.app (energy.worldmonitor.app) | Excluded / candidate — No current fetch observed |
| eng.lsm.lv (eng.lsm.lv) | feed — packages/shared/news-catalog.json |
| english-livebkali.cgtn.com (english-livebkali.cgtn.com) | feed — packages/client/config/live-video-sources.ts |
| english.alarabiya.net (english.alarabiya.net) | feed — packages/shared/news-catalog.json |
| english.customs.gov.cn (english.customs.gov.cn) | structured — scripts/china-macro/source-contracts.mjs |
| english.nv.ua (english.nv.ua) | feed — packages/shared/news-catalog.json |
| ENTSO-E Transparency Platform (web-api.tp.entsoe.eu) | structured — scripts/seed-electricity-prices.mjs |
| Environment and Climate Change Canada (ECCC) (api.weather.gc.ca) | structured — scripts/_weather-alert-select.mjs |
| eonet.gsfc.nasa.gov (eonet.gsfc.nasa.gov) | structured — scripts/seed-natural-events.mjs |
| EPA RadNet (radnet.epa.gov) | structured — scripts/seed-radiation-watch.mjs |
| epads.gov.pk (epads.gov.pk) | structured — scripts/_global-tender-feeds.mjs |
| epms.ppra.gov.pk (epms.ppra.gov.pk) | structured — scripts/_global-tender-feeds.mjs |
| erp.powergrid.gov.bd (erp.powergrid.gov.bd) | structured — scripts/shared/regional-energy-feeds.json |
| ert-ucdn.broadpeak-aas.com (ert-ucdn.broadpeak-aas.com) | feed — packages/client/config/live-video-sources.ts |
| ert.gr (ert.gr) | feed — packages/shared/news-catalog.json |
| ertflix.ascdn.broadpeak.io (ertflix.ascdn.broadpeak.io) | Excluded / candidate — No current fetch observed |
| es.euronews.com (es.euronews.com) | feed — packages/shared/news-catalog.json |
| eu-startups.com (eu-startups.com) | feed — packages/shared/news-catalog.json |
| eur-lex.europa.eu (eur-lex.europa.eu) | structured — scripts/seed-ai-regulation.mjs |
| euractiv.com (euractiv.com) | Excluded / candidate — No current fetch observed |
| eurasianet.org (eurasianet.org) | feed — packages/shared/news-catalog.json |
| euromaidanpress.com (euromaidanpress.com) | feed — packages/shared/news-catalog.json |
| evn.com.vn (evn.com.vn) | structured — scripts/shared/regional-energy-feeds.json |
| Example domain placeholder (example.com) | structured — scripts/openapi-inject-examples.mjs |
| export.arxiv.org (export.arxiv.org) | feed+structured — packages/shared/news-catalog.json, scripts/seed-research.mjs |
| ezamowienia.gov.pl (ezamowienia.gov.pl) | structured — scripts/_global-tender-feeds.mjs |
| factchecktools.googleapis.com (factchecktools.googleapis.com) | structured — packages/server/_shared/fact-checks.ts |
| fao.org (fao.org) | feed — packages/shared/news-catalog.json |
| FAOSTAT (api.data.apps.fao.org) | structured — scripts/seed-food-stocks.mjs |
| FAOSTAT (data.apps.fao.org) | structured — scripts/seed-food-stocks.mjs |
| FAOSTAT (fenixservices.fao.org) | Excluded / candidate — No current fetch observed |
| farsnews.ir (farsnews.ir) | feed — packages/shared/news-catalog.json |
| fas.org (fas.org) | feed — packages/shared/news-catalog.json |
| fc.yahoo.com (fc.yahoo.com) | structured — scripts/_yahoo-sector-valuations.cjs |
| fccc.gov.fj (fccc.gov.fj) | structured — scripts/shared/regional-energy-feeds.json |
| feed.infoq.com (feed.infoq.com) | feed — packages/shared/news-catalog.json |
| feeds.abcnews.com (feeds.abcnews.com) | feed — packages/shared/news-catalog.json |
| feeds.arstechnica.com (feeds.arstechnica.com) | feed — packages/shared/news-catalog.json |
| feeds.content.dowjones.io (feeds.content.dowjones.io) | feed — packages/shared/news-catalog.json |
| feeds.elpais.com (feeds.elpais.com) | feed — packages/shared/news-catalog.json |
| feeds.feedburner.com (feeds.feedburner.com) | feed (syndication transport) — packages/shared/news-catalog.json |
| feeds.folha.uol.com.br (feeds.folha.uol.com.br) | feed — packages/shared/news-catalog.json |
| feeds.megaphone.fm (feeds.megaphone.fm) | feed — packages/shared/news-catalog.json |
| feeds.nbcnews.com (feeds.nbcnews.com) | feed — packages/shared/news-catalog.json |
| feeds.news24.com (feeds.news24.com) | feed — packages/shared/news-catalog.json |
| feeds.nos.nl (feeds.nos.nl) | feed — packages/shared/news-catalog.json |
| feeds.npr.org (feeds.npr.org) | feed — packages/shared/news-catalog.json |
| fema.gov (fema.gov) | feed — packages/shared/news-catalog.json |
| feodotracker.abuse.ch (feodotracker.abuse.ch) | structured — scripts/seed-cyber-threats.mjs |
| finance.worldmonitor.app (finance.worldmonitor.app) | Excluded / candidate — No current fetch observed |
| finance.yahoo.com (finance.yahoo.com) | feed — packages/shared/news-catalog.json |
| Financial Action Task Force (FATF) (www.fatf-gafi.org) | structured — scripts/seed-fatf-listing.mjs |
| financialpost.com (financialpost.com) | feed — packages/shared/news-catalog.json |
| finnhub.io (finnhub.io) | structured — packages/server/worldmonitor/intelligence/v1/_company-shared.ts, packages/server/worldmonitor/market/v1/_quote-provider.ts, packages/server/worldmonitor/market/v1/get-insider-transactions.ts, scripts/ais-relay.cjs, +3 more |
| FINRA (feeds.finra.org) | structured — scripts/seed-regulatory-actions.mjs |
| Fintraffic Digitraffic (not-currently-wired) | Excluded / candidate — No current fetch observed |
| Firecrawl (api.firecrawl.dev) | structured — scripts/ais-relay.cjs, scripts/seed-grocery-basket.mjs |
| focustaiwan.tw (focustaiwan.tw) | feed — packages/shared/news-catalog.json |
| fonts.googleapis.com (fonts.googleapis.com) | Excluded / candidate — No current fetch observed |
| foreignpolicy.com (foreignpolicy.com) | feed — packages/shared/news-catalog.json |
| Fox Business (moxie.foxbusiness.com) | feed — packages/shared/news-catalog.json |
| fpri.org (fpri.org) | feed — packages/shared/news-catalog.json |
| fr.africanews.com (fr.africanews.com) | feed — packages/shared/news-catalog.json |
| fr.euronews.com (fr.euronews.com) | feed — packages/shared/news-catalog.json |
| fred.stlouisfed.org (fred.stlouisfed.org) | structured — scripts/seed-oecd-lt-rates.mjs |
| freeipapi.com (freeipapi.com) | structured — scripts/seed-cyber-threats.mjs |
| ft.com (ft.com) | feed — packages/shared/news-catalog.json |
| fwdstart.me (fwdstart.me) | feed — packages/shared/news-catalog.json |
| fxempire.com (fxempire.com) | feed — packages/shared/news-catalog.json |
| gain.nd.edu (gain.nd.edu) | structured — scripts/benchmark-resilience-external.mjs |
| gamma-api.polymarket.com (gamma-api.polymarket.com) | structured — scripts/_forecast-market-settlements.mjs, scripts/ais-relay.cjs, scripts/seed-prediction-markets.mjs |
| Gazeta Wyborcza (wyborcza.pl) | feed — packages/shared/news-catalog.json |
| gcaptain.com (gcaptain.com) | feed — packages/shared/news-catalog.json |
| geo.tv (geo.tv) | feed — packages/shared/news-catalog.json |
| geospatial-usace.opendata.arcgis.com (geospatial-usace.opendata.arcgis.com) | structured — scripts/fetch-mirta-bases.mjs |
| ghoapi.azureedge.net (ghoapi.azureedge.net) | structured — scripts/seed-resilience-static.mjs |
| github.blog (github.blog) | feed — packages/shared/news-catalog.json |
| github.com (github.com) | structured — api/health.js, scripts/build-plane-alert-watchlist.mjs, scripts/generate-airline-codes.mjs, scripts/seed-research.mjs |
| Global Affairs Canada (SEMA consolidated sanctions) (www.international.gc.ca) | structured — scripts/_sema-sanctions.mjs |
| Global Energy Monitor (globalenergymonitor.org) | structured — scripts/import-gem-pipelines.mjs |
| globalinitiative.net (globalinitiative.net) | feed — packages/shared/news-catalog.json |
| globalnews.ca (globalnews.ca) | feed — packages/shared/news-catalog.json |
| GlobeNewswire (www.globenewswire.com) | feed — packages/shared/news-catalog.json |
| gmfus.org (gmfus.org) | feed — packages/shared/news-catalog.json |
| gml.noaa.gov (gml.noaa.gov) | structured — scripts/seed-co2-monitoring.mjs |
| goldsilverworlds.com (goldsilverworlds.com) | feed — packages/shared/news-catalog.json |
| Google account sign-in (accounts.google.com) | Excluded / candidate — No current fetch observed |
| gpsjam.org (gpsjam.org) | structured — scripts/fetch-gpsjam.mjs |
| gr.euronews.com (gr.euronews.com) | feed — packages/shared/news-catalog.json |
| greatergood.berkeley.edu (greatergood.berkeley.edu) | feed — packages/shared/news-catalog.json |
| GTA Update (gtaupdate.com) | structured — scripts/lib/gta-update.mjs |
| haaretz.com (haaretz.com) | feed — packages/shared/news-catalog.json |
| hacker-news.firebaseio.com (hacker-news.firebaseio.com) | structured — scripts/seed-research.mjs |
| hai.stanford.edu (hai.stanford.edu) | feed — packages/shared/news-catalog.json |
| HaitiLibre English (www.haitilibre.com) | feed — packages/shared/news-catalog.json |
| Handelsblatt (www.handelsblatt.com) | feed — packages/shared/news-catalog.json |
| hapi.humdata.org (hapi.humdata.org) | structured — scripts/_conflict-hapi.mjs |
| happy.worldmonitor.app (happy.worldmonitor.app) | Excluded / candidate — No current fetch observed |
| Havana Times (havanatimes.org) | feed — packages/shared/news-catalog.json |
| health.aws.amazon.com (health.aws.amazon.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| hiiraan.com (hiiraan.com) | feed — packages/shared/news-catalog.json |
| hirado.hu (hirado.hu) | feed — packages/shared/news-catalog.json |
| hnrss.org (hnrss.org) | feed — packages/shared/news-catalog.json |
| home.treasury.gov (home.treasury.gov) | structured — scripts/seed-us-treasury-par-yield.mjs |
| hormuz.data-tracking.net (hormuz.data-tracking.net) | structured — scripts/seed-ukmto-incidents.mjs |
| hromadske.ua (hromadske.ua) | feed — packages/shared/news-catalog.json |
| hts.usitc.gov (hts.usitc.gov) | structured — scripts/seed-supply-chain-trade.mjs |
| hub.arcgis.com (hub.arcgis.com) | structured — scripts/seed-portwatch.mjs |
| humanprogress.org (humanprogress.org) | feed — packages/shared/news-catalog.json |
| hvg.hu (hvg.hu) | feed — packages/shared/news-catalog.json |
| Hyperliquid (api.hyperliquid.xyz) | structured — scripts/seed-hyperliquid-flow.mjs |
| i24newshebrew-cdn.encoders.immergo.tv (i24newshebrew-cdn.encoders.immergo.tv) | feed — packages/client/config/live-video-sources.ts |
| iccc.gov.pg (iccc.gov.pg) | structured — scripts/lib/regional-energy-feeds.mjs, scripts/shared/regional-energy-feeds.json |
| ici.radio-canada.ca (ici.radio-canada.ca) | feed — packages/shared/news-catalog.json |
| identity.dataspace.copernicus.eu (identity.dataspace.copernicus.eu) | structured — scripts/seed-no2-activity.mjs |
| iea.org (iea.org) | feed — packages/shared/news-catalog.json |
| ILOSTAT (sdmx.ilo.org) | structured — scripts/_demographics-capability-source.mjs |
| in.usembassy.gov (in.usembassy.gov) | structured — scripts/seed-security-advisories.mjs |
| inc42.com (inc42.com) | feed — packages/shared/news-catalog.json |
| index.hu (index.hu) | feed — packages/shared/news-catalog.json |
| India Meteorological Department (api.imd.gov.in) | structured — scripts/lib/imd-cyclone-marine.mjs |
| India Meteorological Department (mausam.imd.gov.in) | structured — scripts/lib/imd-cyclone-marine.mjs |
| India Meteorological Department (rsmcnewdelhi.imd.gov.in) | structured — scripts/lib/imd-cyclone-marine.mjs |
| indianexpress.com (indianexpress.com) | feed — packages/shared/news-catalog.json |
| indiatodaylive.akamaized.net (indiatodaylive.akamaized.net) | feed — packages/client/config/live-video-sources.ts |
| insideclimatenews.org (insideclimatenews.org) | Excluded / candidate — No current fetch observed |
| insightcrime.org (insightcrime.org) | feed — packages/shared/news-catalog.json |
| Interfax (interfax.com) | feed — packages/shared/news-catalog.json |
| Interfax (www.interfax.ru) | feed — packages/shared/news-catalog.json |
| Internal example placeholder (internal.example.com) | Excluded / candidate — No current fetch observed |
| International Forum of Sovereign Wealth Funds (www.ifswf.org) | structured — scripts/seed-sovereign-wealth.mjs |
| International Trade Administration (US Consolidated Screening List) (data.trade.gov) | structured — scripts/_csl-sanctions.mjs |
| investing.com (investing.com) | feed — packages/shared/news-catalog.json |
| ipinfo.io (ipinfo.io) | structured — scripts/seed-cyber-threats.mjs |
| iranintl.com (iranintl.com) | feed — packages/shared/news-catalog.json |
| iseas.edu.sg (iseas.edu.sg) | feed — packages/shared/news-catalog.json |
| islandtimes.org (islandtimes.org) | feed — packages/shared/news-catalog.json |
| iss.europa.eu (iss.europa.eu) | feed — packages/shared/news-catalog.json |
| iss.moex.com (iss.moex.com) | structured — scripts/_country-stock-index-moex.mjs |
| it.euronews.com (it.euronews.com) | feed — packages/shared/news-catalog.json |
| it.usembassy.gov (it.usembassy.gov) | structured — scripts/seed-security-advisories.mjs |
| jam-news.net (jam-news.net) | feed — packages/shared/news-catalog.json |
| jamestown.org (jamestown.org) | feed — packages/shared/news-catalog.json |
| janes.com (janes.com) | feed — packages/shared/news-catalog.json |
| Japan Times (japantimes.co.jp) | feed — packages/shared/news-catalog.json |
| japantoday.com (japantoday.com) | feed — packages/shared/news-catalog.json |
| Jin10 (jin10.com) | feed — packages/shared/news-catalog.json |
| jira-software.status.atlassian.com (jira-software.status.atlassian.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| jmespath.org (jmespath.org) | Excluded / candidate — No current fetch observed |
| jsDelivr asset CDN (cdn.jsdelivr.net) | structured — scripts/ais-relay.cjs |
| justice.gov (justice.gov) | feed — packages/shared/news-catalog.json |
| Kalshi (api.elections.kalshi.com) | structured — scripts/_forecast-market-settlements.mjs, scripts/seed-prediction-markets.mjs, scripts/seed-rate-odds.mjs |
| kalshi.com (kalshi.com) | structured — apps/web/src/lite/data/finance-macro-indicators.ts, scripts/_bet-templates-markets.mjs, scripts/seed-prediction-markets.mjs, scripts/seed-rate-odds.mjs |
| kan11.media.kan.org.il (kan11.media.kan.org.il) | Excluded / candidate — No current fetch observed |
| kancdn.medonecdn.net (kancdn.medonecdn.net) | feed — packages/client/config/live-video-sources.ts |
| kathimerini.gr (kathimerini.gr) | feed — packages/shared/news-catalog.json |
| kitco.com (kitco.com) | feed — packages/shared/news-catalog.json |
| kr-asia.com (kr-asia.com) | feed — packages/shared/news-catalog.json |
| krebsonsecurity.com (krebsonsecurity.com) | feed — packages/shared/news-catalog.json |
| kyivindependent.com (kyivindependent.com) | feed — packages/shared/news-catalog.json |
| L'Orient Today (lorientlejour.com) | feed — packages/shared/news-catalog.json |
| lavca.org (lavca.org) | Excluded / candidate — No current fetch observed |
| leFaso.net (lefaso.net) | feed — packages/shared/news-catalog.json |
| lequotidien.sn (lequotidien.sn) | feed — packages/shared/news-catalog.json |
| liberal.gr (liberal.gr) | feed — packages/shared/news-catalog.json |
| Libya Herald (libyaherald.com) | feed — packages/shared/news-catalog.json |
| Linear MCP (mcp.linear.app) | Excluded / candidate — No current fetch observed |
| linear901-oo-hls0-prd-gtm.delivery.skycdp.com (linear901-oo-hls0-prd-gtm.delivery.skycdp.com) | feed — packages/client/config/live-video-sources.ts |
| linearstatus.com (linearstatus.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| live-cdn-stream-euw1.bfmtv.bct.nextradiotv.com (live-cdn-stream-euw1.bfmtv.bct.nextradiotv.com) | feed — packages/client/config/live-video-sources.ts |
| live-gbnews.simplestreamcdn.com (live-gbnews.simplestreamcdn.com) | feed — packages/client/config/live-video-sources.ts |
| live-hls-apps-aje-fa.getaj.net (live-hls-apps-aje-fa.getaj.net) | feed — packages/client/config/live-video-sources.ts |
| live-hls-web-aja.getaj.net (live-hls-web-aja.getaj.net) | feed — packages/client/config/live-video-sources.ts |
| live-hls-web-ajb.getaj.net (live-hls-web-ajb.getaj.net) | Excluded / candidate — No current fetch observed |
| live-hls-web-ajm.getaj.net (live-hls-web-ajm.getaj.net) | feed — packages/client/config/live-video-sources.ts |
| live-stream.skynewsarabia.com (live-stream.skynewsarabia.com) | feed — packages/client/config/live-video-sources.ts |
| live.alarabiya.net (live.alarabiya.net) | feed — packages/client/config/live-video-sources.ts |
| live.dodopayments.com (live.dodopayments.com) | Excluded / candidate — No current fetch observed |
| live.livetvstream.co.uk (live.livetvstream.co.uk) | feed — packages/client/config/live-video-sources.ts |
| live.presstv.co.uk (live.presstv.co.uk) | feed — packages/client/config/live-video-sources.ts |
| live.rudaw.net (live.rudaw.net) | feed — packages/client/config/live-video-sources.ts |
| liveedge-arisenews.visioncdn.com (liveedge-arisenews.visioncdn.com) | Excluded / candidate — No current fetch observed |
| livenewschat.eu (livenewschat.eu) | Excluded / candidate — No current fetch observed |
| liveuamap.com (liveuamap.com) | Excluded / candidate — No current fetch observed |
| lnc-abc-news.tubi.video (lnc-abc-news.tubi.video) | Excluded / candidate — No current fetch observed |
| lobste.rs (lobste.rs) | feed — packages/shared/news-catalog.json |
| Local development transport (localhost) | structured — packages/client/services/wm-session.ts, packages/server/worldmonitor/research/v1/list-tech-events.ts, scripts/ais-relay.cjs |
| Local loopback transport (127.0.0.1) | Excluded / candidate — No current fetch observed |
| lowyinstitute.org (lowyinstitute.org) | feed — packages/shared/news-catalog.json |
| macleans.ca (macleans.ca) | feed — packages/shared/news-catalog.json |
| Mada Masr (madamasr.com) | feed — packages/shared/news-catalog.json |
| madr.gov.dz (madr.gov.dz) | structured — scripts/lib/food-prices-adapters/madr.mjs |
| Manitoba 511 (www.manitoba511.ca) | structured — scripts/lib/provincial-511.mjs |
| maps.worldmonitor.app (maps.worldmonitor.app) | structured — packages/client/services/country-geometry.ts |
| mapservices.weather.noaa.gov (mapservices.weather.noaa.gov) | structured — scripts/seed-natural-events.mjs |
| marketwatch.com (marketwatch.com) | feed — packages/shared/news-catalog.json |
| masterpl.hls.nhkworld.jp (masterpl.hls.nhkworld.jp) | feed — packages/client/config/live-video-sources.ts |
| me.liveuamap.com (me.liveuamap.com) | Excluded / candidate — No current fetch observed |
| meduza.io (meduza.io) | feed — packages/shared/news-catalog.json |
| mei.edu (mei.edu) | feed — packages/shared/news-catalog.json |
| mem.gob.gt (mem.gob.gt) | structured — scripts/shared/regional-energy-feeds.json |
| mempool.space (mempool.space) | structured — scripts/seed-economy.mjs |
| messari.io (messari.io) | feed — packages/shared/news-catalog.json |
| mexiconewsdaily.com (mexiconewsdaily.com) | feed — packages/shared/news-catalog.json |
| Middle East Eye (middleeasteye.net) | feed — packages/shared/news-catalog.json |
| miit.gov.cn (miit.gov.cn) | Excluded / candidate — No current fetch observed |
| mining-journal.com (mining-journal.com) | feed — packages/shared/news-catalog.json |
| miningweekly.com (miningweekly.com) | feed — packages/shared/news-catalog.json |
| mm.usembassy.gov (mm.usembassy.gov) | structured — scripts/seed-security-advisories.mjs |
| mofcom.gov.cn (mofcom.gov.cn) | feed — packages/shared/news-catalog.json |
| montrealgazette.com (montrealgazette.com) | feed — packages/shared/news-catalog.json |
| moxie.foxnews.com (moxie.foxnews.com) | feed — packages/shared/news-catalog.json |
| mshibanami.github.io (mshibanami.github.io) | feed — packages/shared/news-catalog.json |
| msi.nga.mil (msi.nga.mil) | structured — packages/server/worldmonitor/infrastructure/v1/get-cable-health.ts, packages/server/worldmonitor/maritime/v1/list-navigational-warnings.ts |
| mx.usembassy.gov (mx.usembassy.gov) | structured — scripts/seed-security-advisories.mjs |
| myprocurement.treasury.gov.my (myprocurement.treasury.gov.my) | structured — scripts/_global-tender-feeds.mjs |
| n1ctsota.akamaized.net (n1ctsota.akamaized.net) | feed — packages/client/config/live-video-sources.ts |
| n1info.hr (n1info.hr) | feed — packages/shared/news-catalog.json |
| Naharnet Lebanon (www.naharnet.com) | feed — packages/shared/news-catalog.json |
| NASA FIRMS (firms.modaps.eosdis.nasa.gov) | structured — scripts/wildfire/firms-area.mjs |
| NASA FIRMS (firms2.modaps.eosdis.nasa.gov) | Excluded / candidate — No current fetch observed |
| nasstatus.faa.gov (nasstatus.faa.gov) | structured — scripts/seed-aviation.mjs |
| nationalpost.com (nationalpost.com) | feed — packages/shared/news-catalog.json |
| ndtvindiaelemarchana.akamaized.net (ndtvindiaelemarchana.akamaized.net) | feed — packages/client/config/live-video-sources.ts |
| news.cgtn.com (news.cgtn.com) | Excluded / candidate — No current fetch observed |
| news.crunchbase.com (news.crunchbase.com) | feed — packages/shared/news-catalog.json |
| news.err.ee (news.err.ee) | feed — packages/shared/news-catalog.json |
| news.google.com (news.google.com) | feed+structured (syndication transport) — packages/server/worldmonitor/intelligence/v1/_country-coverage-feeds.ts, packages/server/worldmonitor/market/v1/stock-news-search.ts, packages/shared/news-catalog.json, scripts/source-catalog-identity.mjs |
| news.mit.edu (news.mit.edu) | feed — packages/shared/news-catalog.json |
| news.mongabay.com (news.mongabay.com) | feed — packages/shared/news-catalog.json |
| news.tuoitre.vn (news.tuoitre.vn) | feed — packages/shared/news-catalog.json |
| news.un.org (news.un.org) | feed — packages/shared/news-catalog.json |
| news.usni.org (news.usni.org) | feed+structured — packages/shared/news-catalog.json, scripts/ais-relay.cjs |
| news.ycombinator.com (news.ycombinator.com) | feed — packages/shared/news-catalog.json |
| newscientist.com (newscientist.com) | feed — packages/shared/news-catalog.json |
| newsfeed.zeit.de (newsfeed.zeit.de) | feed — packages/shared/news-catalog.json |
| newsmaker.md (newsmaker.md) | feed — packages/shared/news-catalog.json |
| nhkwlive-ojp.akamaized.net (nhkwlive-ojp.akamaized.net) | Excluded / candidate — No current fetch observed |
| nmxlive.akamaized.net (nmxlive.akamaized.net) | feed — packages/client/config/live-video-sources.ts |
| nominatim.openstreetmap.org (nominatim.openstreetmap.org) | structured — packages/server/worldmonitor/infrastructure/v1/reverse-geocode.ts |
| northernminer.com (northernminer.com) | feed — packages/shared/news-catalog.json |
| novayagazeta.eu (novayagazeta.eu) | feed — packages/shared/news-catalog.json |
| npa.gov.gh (npa.gov.gh) | structured — scripts/shared/regional-energy-feeds.json |
| nrk-nrk1.akamaized.net (nrk-nrk1.akamaized.net) | feed — packages/client/config/live-video-sources.ts |
| NSIDC (noaadata.apps.nsidc.org) | structured — scripts/seed-climate-ocean-ice.mjs |
| nti.org (nti.org) | feed — packages/shared/news-catalog.json |
| NVD (NIST) (nvd.nist.gov) | structured — scripts/seed-cve-reference.mjs |
| NVD (NIST) (services.nvd.nist.gov) | structured — scripts/seed-cve-reference.mjs |
| oauth.reddit.com (oauth.reddit.com) | structured — scripts/ais-relay.cjs |
| oauth2.googleapis.com (oauth2.googleapis.com) | Excluded / candidate — No current fetch observed |
| oc-media.org (oc-media.org) | feed — packages/shared/news-catalog.json |
| ocds-api.etenders.gov.za (ocds-api.etenders.gov.za) | structured — scripts/_global-tender-feeds.mjs |
| oecd.org (oecd.org) | feed — packages/shared/news-catalog.json |
| Office of the U.S. Trade Representative (ustr.gov) | feed — packages/shared/news-catalog.json |
| offnadir-delta.com (offnadir-delta.com) | Excluded / candidate — No current fetch observed |
| oglobo.globo.com (oglobo.globo.com) | feed — packages/shared/news-catalog.json |
| oilprice.com (oilprice.com) | feed+structured — packages/shared/news-catalog.json, scripts/seed-energy-intelligence.mjs |
| OKO.press (oko.press) | feed — packages/shared/news-catalog.json |
| onemileatatime.com (onemileatatime.com) | structured — scripts/seed-aviation.mjs |
| Onet (wiadomosci.onet.pl) | feed — packages/shared/news-catalog.json |
| Ontario 511 (511on.ca) | structured — scripts/lib/provincial-511.mjs |
| open-meteo.caseyjhand.com (open-meteo.caseyjhand.com) | Excluded / candidate — No current fetch observed |
| open.alberta.ca (open.alberta.ca) | Excluded / candidate — No current fetch observed |
| open.iub.gov.lv (open.iub.gov.lv) | structured — scripts/_global-tender-feeds.mjs |
| OpenAQ (api.openaq.org) | structured — scripts/seed-health-air-quality.mjs |
| OpenRouter (openrouter.ai) | structured — apps/web/src/lite/data/tech-indicators.ts, scripts/eval-classify-labels.mjs, scripts/lib/brief-dedup-consts.mjs, scripts/lib/company-monitoring-classifier-client.mjs, +2 more |
| OpenSanctions (api.opensanctions.org) | Excluded / candidate — No current fetch observed |
| opensky-network.org (auth.opensky-network.org) | structured — scripts/seed-military-flights.mjs |
| opensky-network.org (opensky-network.org) | structured — scripts/ais-relay.cjs, scripts/seed-military-flights.mjs |
| openstreetmap.org (openstreetmap.org) | Excluded / candidate — No current fetch observed |
| ott.tv5monde.com (ott.tv5monde.com) | feed — packages/client/config/live-video-sources.ts |
| ottawacitizen.com (ottawacitizen.com) | feed — packages/shared/news-catalog.json |
| otx.alienvault.com (otx.alienvault.com) | structured — scripts/seed-cyber-threats.mjs |
| Our World in Data (ourworldindata.org) | structured — packages/server/worldmonitor/resilience/v1/_dimension-scorers.ts, packages/server/worldmonitor/resilience/v1/_indicator-source-policy.ts, scripts/seed-low-carbon-generation.mjs |
| Our World in Data (owid-public.owid.io) | structured — scripts/seed-owid-energy-mix.mjs |
| outbreaknewstoday.com (outbreaknewstoday.com) | Excluded / candidate — No current fetch observed |
| overpass-api.de (overpass-api.de) | structured — scripts/fetch-osm-bases.mjs |
| Pajhwok Afghan News (pajhwok.com) | feed — packages/shared/news-catalog.json |
| PAP (pap.pl) | feed — packages/shared/news-catalog.json |
| Parallel Search MCP (search.parallel.ai) | Excluded / candidate — No current fetch observed |
| patents.google.com (patents.google.com) | structured — scripts/_defense-patents-source.mjs |
| pe-fa-lp02a.9c9media.com (pe-fa-lp02a.9c9media.com) | Excluded / candidate — No current fetch observed |
| petrobangla.org.bd (petrobangla.org.bd) | structured — scripts/shared/regional-energy-feeds.json |
| phys.org (phys.org) | structured — scripts/seed-climate-news.mjs |
| pitchbook.com (pitchbook.com) | feed — packages/shared/news-catalog.json |
| pk.usembassy.gov (pk.usembassy.gov) | structured — scripts/seed-security-advisories.mjs |
| pl.usembassy.gov (pl.usembassy.gov) | structured — scripts/seed-security-advisories.mjs |
| pncp.gov.br (pncp.gov.br) | structured — scripts/_global-tender-feeds.mjs |
| Polityka (polityka.pl) | feed — packages/shared/news-catalog.json |
| polymarket.com (polymarket.com) | structured — scripts/_bet-templates-markets.mjs, scripts/seed-prediction-markets.mjs |
| portal.korem.kz (portal.korem.kz) | structured — scripts/lib/regional-energy-feeds.mjs, scripts/shared/regional-energy-feeds.json |
| portfolio.hu (portfolio.hu) | feed — packages/shared/news-catalog.json |
| portwatch.imf.org (portwatch.imf.org) | structured — scripts/seed-oil-trade-series.mjs |
| PR Newswire (prnewswire.com) | feed — packages/shared/news-catalog.json |
| pravda.com.ua (pravda.com.ua) | feed — packages/shared/news-catalog.json |
| precios.maga.gob.gt (precios.maga.gob.gt) | structured — scripts/lib/food-prices-adapters/maga.mjs |
| pro-api.coingecko.com (pro-api.coingecko.com) | structured — scripts/ais-relay.cjs |
| production.dataviz.cnn.io (production.dataviz.cnn.io) | structured — scripts/seed-fear-greed.mjs |
| protomaps.com (protomaps.com) | Excluded / candidate — No current fetch observed |
| protothema.gr (protothema.gr) | feed — packages/shared/news-catalog.json |
| Proxy URL placeholder (user) | structured — scripts/_proxy-utils.cjs, scripts/ais-relay.cjs |
| pt.euronews.com (pt.euronews.com) | feed — packages/shared/news-catalog.json |
| public-api.prozorro.gov.ua (public-api.prozorro.gov.ua) | structured — scripts/_global-tender-feeds.mjs |
| public.govdelivery.com (public.govdelivery.com) | structured — scripts/seed-regulatory-actions.mjs |
| publicacionexterna.azurewebsites.net (publicacionexterna.azurewebsites.net) | structured — scripts/seed-fuel-prices.mjs |
| PURL namespace (purl.org) | Excluded / candidate — No current fetch observed |
| qevdnlpgjxpwusesmtpx.supabase.co (qevdnlpgjxpwusesmtpx.supabase.co) | structured — scripts/fetch-pizzint-bases.mjs |
| query.sse.com.cn (query.sse.com.cn) | structured — scripts/china-corporate-disclosures/adapters.mjs |
| query1.finance.yahoo.com (query1.finance.yahoo.com) | structured — packages/server/worldmonitor/market/v1/analyze-stock.ts, packages/server/worldmonitor/market/v1/get-country-stock-index.ts, packages/server/worldmonitor/market/v1/get-price-history.ts, scripts/_seed-utils.mjs, +11 more |
| radar.cloudflare.com (radar.cloudflare.com) | structured — packages/server/worldmonitor/resilience/v1/_indicator-source-policy.ts |
| Radio Ndeke Luka (www.radiondekeluka.org) | feed — packages/shared/news-catalog.json |
| railway.instatus.com (railway.instatus.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| rakuten-guardian-1-ie.samsung.wurl.tv (rakuten-guardian-1-ie.samsung.wurl.tv) | Excluded / candidate — No current fetch observed |
| ransomware.live (ransomware.live) | feed — packages/shared/news-catalog.json |
| raw.githubusercontent.com (raw.githubusercontent.com) | structured — scripts/ais-relay.cjs, scripts/build-plane-alert-watchlist.mjs, scripts/fetch-country-boundary-overrides.mjs, scripts/generate-airline-codes.mjs, +6 more |
| reasonstobecheerful.world (reasonstobecheerful.world) | feed — packages/shared/news-catalog.json |
| reddit.com (reddit.com) | structured — scripts/ais-relay.cjs |
| registry.modelcontextprotocol.io (registry.modelcontextprotocol.io) | Excluded / candidate — No current fetch observed |
| ReliefWeb (UN OCHA) (api.reliefweb.int) | structured — scripts/seed-climate-disasters.mjs |
| reliefweb.int (reliefweb.int) | structured — scripts/seed-climate-news.mjs |
| renaissancecapital.com (renaissancecapital.com) | feed — packages/shared/news-catalog.json |
| Reporters Without Borders (RSF) (rsf.org) | structured — scripts/seed-resilience-static.mjs |
| Resend email service (api.resend.com) | Excluded / candidate — No current fetch observed |
| responsiblestatecraft.org (responsiblestatecraft.org) | feed — packages/shared/news-catalog.json |
| restcountries.com (restcountries.com) | Excluded / candidate — No current fetch observed |
| reuters-reutersnow-1-eu.rakuten.wurl.tv (reuters-reutersnow-1-eu.rakuten.wurl.tv) | Excluded / candidate — No current fetch observed |
| reuters.com (reuters.com) | feed — packages/shared/news-catalog.json |
| review.firstround.com (review.firstround.com) | feed — packages/shared/news-catalog.json |
| rferl.org (rferl.org) | feed — packages/shared/news-catalog.json |
| rieti.go.jp (rieti.go.jp) | feed — packages/shared/news-catalog.json |
| Robtex MCP (mcp.robtex.com) | Excluded / candidate — No current fetch observed |
| rss.art19.com (rss.art19.com) | feed — packages/shared/news-catalog.json |
| rss.dw.com (rss.dw.com) | feed — packages/shared/news-catalog.json |
| rss.libsyn.com (rss.libsyn.com) | feed — packages/shared/news-catalog.json |
| rss.politico.com (rss.politico.com) | feed — packages/shared/news-catalog.json |
| rt-arb.rttv.com (rt-arb.rttv.com) | feed — packages/client/config/live-video-sources.ts |
| rt-english.com (rt-english.com) | feed — packages/shared/news-catalog.json |
| rt-esp.rttv.com (rt-esp.rttv.com) | feed — packages/client/config/live-video-sources.ts |
| rt-glb.rttv.com (rt-glb.rttv.com) | feed — packages/client/config/live-video-sources.ts |
| rtvelivestream.rtve.es (rtvelivestream.rtve.es) | feed — packages/client/config/live-video-sources.ts |
| ru.euronews.com (ru.euronews.com) | feed — packages/shared/news-catalog.json |
| rudaw.net (rudaw.net) | feed — packages/shared/news-catalog.json |
| rusi.org (rusi.org) | feed — packages/shared/news-catalog.json |
| sabconetanw.cdn.mangomolo.com (sabconetanw.cdn.mangomolo.com) | feed — packages/client/config/live-video-sources.ts |
| Safecast (api.safecast.org) | structured — scripts/seed-radiation-watch.mjs |
| Sana'a Center (sanaacenter.org) | feed — packages/shared/news-catalog.json |
| sanctionslistservice.ofac.treas.gov (sanctionslistservice.ofac.treas.gov) | structured — scripts/seed-sanctions-pressure.mjs |
| SaskAlert (emergencyalert.saskatchewan.ca) | structured — scripts/lib/saskalert.mjs, scripts/source-attribution.mjs |
| sccd.royalnavy.mod.uk (sccd.royalnavy.mod.uk) | Excluded / candidate — No current fetch observed |
| schema.org (schema.org) | Excluded / candidate — No current fetch observed |
| schemas.agentskills.io (schemas.agentskills.io) | Excluded / candidate — No current fetch observed |
| scmp.com (scmp.com) | feed — packages/shared/news-catalog.json |
| sdmx.oecd.org (sdmx.oecd.org) | Excluded / candidate — No current fetch observed |
| sealevel.nasa.gov (sealevel.nasa.gov) | structured — scripts/seed-climate-ocean-ice.mjs |
| search.seznam.cz (search.seznam.cz) | Excluded / candidate — No current fetch observed |
| search.worldbank.org (search.worldbank.org) | structured — scripts/seed-global-tenders.mjs |
| search.yahoo.com (search.yahoo.com) | Excluded / candidate — No current fetch observed |
| searchadvisor.naver.com (searchadvisor.naver.com) | Excluded / candidate — No current fetch observed |
| searchconsole.googleapis.com (searchconsole.googleapis.com) | Excluded / candidate — No current fetch observed |
| SEC (www.sec.gov) | feed+structured — packages/shared/news-catalog.json, scripts/openapi-inject-examples.mjs, scripts/seed-regulatory-actions.mjs, scripts/seed-sec-8k-stream.mjs, +1 more |
| SEC EDGAR (data.sec.gov) | structured — packages/server/_shared/sec-edgar.ts |
| SEC EDGAR Full-Text Search (efts.sec.gov) | structured — packages/server/_shared/sec-edgar.ts |
| sedeaplicaciones.minetur.gob.es (sedeaplicaciones.minetur.gob.es) | structured — scripts/backfill-fuel-prices-prev.mjs, scripts/seed-fuel-prices.mjs |
| seekingalpha.com (seekingalpha.com) | feed — packages/shared/news-catalog.json |
| semianalysis.com (semianalysis.com) | feed — packages/shared/news-catalog.json |
| Sentry error tracking (us.sentry.io) | structured — scripts/audit-sentry-resolve-pins.mjs |
| sequoiacap.com (sequoiacap.com) | feed — packages/shared/news-catalog.json |
| SerpAPI (serpapi.com) | structured — packages/server/worldmonitor/market/v1/stock-news-search.ts |
| services7.arcgis.com (services7.arcgis.com) | structured — scripts/fetch-mirta-bases.mjs |
| services9.arcgis.com (services9.arcgis.com) | structured — scripts/seed-oil-trade-series.mjs, scripts/seed-portwatch-chokepoints-ref.mjs, scripts/seed-portwatch-disruptions.mjs, scripts/seed-portwatch-port-activity.mjs, +1 more |
| severeweather.wmo.int (severeweather.wmo.int) | structured — scripts/_weather-alert-select.mjs |
| sh.dataspace.copernicus.eu (sh.dataspace.copernicus.eu) | structured — scripts/seed-no2-activity.mjs |
| Shanghai Financial Portal (jrj.sh.gov.cn) | structured — scripts/_china-macro-contract.mjs, scripts/china-macro/source-contracts.mjs |
| sifted.eu (sifted.eu) | feed — packages/shared/news-catalog.json |
| simaniger.net (simaniger.net) | structured — scripts/lib/food-prices-adapters/sima.mjs |
| simpleflying.com (simpleflying.com) | structured — scripts/seed-aviation.mjs |
| singularityhub.com (singularityhub.com) | feed — packages/shared/news-catalog.json |
| SIPRI Arms Transfers Database (atbackend.sipri.org) | structured — scripts/_defense-industrial-source.mjs |
| skai-live.siliconweb.com (skai-live.siliconweb.com) | feed — packages/client/config/live-video-sources.ts |
| Sky News (news.sky.com) | feed — packages/shared/news-catalog.json |
| slack-status.com (slack-status.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| slack.com (slack.com) | Excluded / candidate — No current fetch observed |
| slidstvo.info (slidstvo.info) | feed — packages/shared/news-catalog.json |
| spglobal.com (spglobal.com) | feed — packages/shared/news-catalog.json |
| ssl.bing.com (ssl.bing.com) | Excluded / candidate — No current fetch observed |
| stat.gov.kg (stat.gov.kg) | structured — scripts/lib/food-prices-adapters/nsckg.mjs |
| stat.gov.kz (stat.gov.kz) | structured — scripts/lib/food-prices-adapters/statkz.mjs |
| stat.uz (api.siat.stat.uz) | structured — scripts/lib/food-prices-adapters/statuz.mjs |
| stat.uz (stat.uz) | structured — scripts/lib/food-prices-adapters/statuz.mjs |
| state.gov (state.gov) | feed — packages/shared/news-catalog.json |
| Statistics Canada (www150.statcan.gc.ca) | structured — packages/server/worldmonitor/resilience/v1/_canada-national-overlay.ts, packages/server/worldmonitor/resilience/v1/_indicator-source-policy.ts, scripts/lib/statcan-wds.mjs |
| stats.bis.org (stats.bis.org) | structured — scripts/seed-bis-data.mjs, scripts/seed-bis-extended.mjs, scripts/seed-bis-lbs.mjs, scripts/seed-capital-flows.mjs |
| status.circleci.com (status.circleci.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| status.claude.com (status.claude.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| status.cloud.google.com (status.cloud.google.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| status.datadoghq.com (status.datadoghq.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| status.digitalocean.com (status.digitalocean.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| status.gitlab.com (status.gitlab.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| status.npmjs.org (status.npmjs.org) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| status.openai.com (status.openai.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| status.render.com (status.render.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| status.sentry.io (status.sentry.io) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| status.stripe.com (status.stripe.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| status.supabase.com (status.supabase.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| status.twilio.com (status.twilio.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| storage.eop.bg (storage.eop.bg) | structured — scripts/_global-tender-feeds.mjs |
| stratechery.com (stratechery.com) | feed — packages/shared/news-catalog.json |
| stream.ads.ottera.tv (stream.ads.ottera.tv) | Excluded / candidate — No current fetch observed |
| streaming-live.rtp.pt (streaming-live.rtp.pt) | feed — packages/client/config/live-video-sources.ts |
| Studio Tamani (www.studiotamani.org) | feed — packages/shared/news-catalog.json |
| suspilne.media (suspilne.media) | feed — packages/shared/news-catalog.json |
| svs.itworkscdn.net (svs.itworkscdn.net) | Excluded / candidate — No current fetch observed |
| SWF Institute (www.swfinstitute.org) | structured — scripts/seed-sovereign-wealth.mjs |
| Syria Direct (syriadirect.org) | feed — packages/shared/news-catalog.json |
| t.me (t.me) | structured — scripts/ais-relay.cjs |
| tagesschau.akamaized.net (tagesschau.akamaized.net) | feed — packages/client/config/live-video-sources.ts |
| taipeitimes.com (taipeitimes.com) | feed — packages/shared/news-catalog.json |
| taiwannews.com.tw (taiwannews.com.tw) | feed — packages/shared/news-catalog.json |
| taskandpurpose.com (taskandpurpose.com) | feed — packages/shared/news-catalog.json |
| tass.com (tass.com) | feed — packages/shared/news-catalog.json |
| tcb.gov.bd (tcb.gov.bd) | structured — scripts/lib/food-prices-adapters/tcb.mjs |
| Tchadinfos (tchadinfos.com) | feed — packages/shared/news-catalog.json |
| tech.eu (tech.eu) | feed — packages/shared/news-catalog.json |
| tech.worldmonitor.app (tech.worldmonitor.app) | Excluded / candidate — No current fetch observed |
| techcabal.com (techcabal.com) | feed — packages/shared/news-catalog.json |
| techcrunch.com (techcrunch.com) | feed — packages/shared/news-catalog.json |
| techinasia.com (techinasia.com) | feed — packages/shared/news-catalog.json |
| TeleGeography Submarine Cable Map (www.submarinecablemap.com) | structured — scripts/check-submarine-cable-gaps.mjs, scripts/seed-submarine-cables.mjs |
| telegraaf.nl (telegraaf.nl) | feed — packages/shared/news-catalog.json |
| telex.hu (telex.hu) | feed — packages/shared/news-catalog.json |
| tenders.go.ke (tenders.go.ke) | structured — scripts/_global-tender-feeds.mjs |
| tenders.procurement.gov.ge (tenders.procurement.gov.ge) | structured — scripts/_global-tender-feeds.mjs |
| test (test) | structured — scripts/seed-forecasts.mjs |
| test.dodopayments.com (test.dodopayments.com) | Excluded / candidate — No current fetch observed |
| th.usembassy.gov (th.usembassy.gov) | structured — scripts/seed-security-advisories.mjs |
| The Daily Star (thedailystar.net) | feed — packages/shared/news-catalog.json |
| The Economist (economist.com) | feed — packages/shared/news-catalog.json |
| The Guardian Post (theguardianpostcameroon.com) | feed — packages/shared/news-catalog.json |
| The Independent (independent.co.uk) | feed — packages/shared/news-catalog.json |
| The New York Times (nytimes.com) | feed — packages/shared/news-catalog.json |
| The Telegraph (www.telegraph.co.uk) | feed — packages/shared/news-catalog.json |
| The Washington Post (washingtonpost.com) | feed — packages/shared/news-catalog.json |
| thebetterindia.com (thebetterindia.com) | feed — packages/shared/news-catalog.json |
| theblock.co (theblock.co) | feed — packages/shared/news-catalog.json |
| thebulletin.org (thebulletin.org) | feed — packages/shared/news-catalog.json |
| thedefiant.io (thedefiant.io) | feed — packages/shared/news-catalog.json |
| thediplomat.com (thediplomat.com) | feed — packages/shared/news-catalog.json |
| thehill.com (thehill.com) | feed — packages/shared/news-catalog.json |
| theinformation.com (theinformation.com) | feed — packages/shared/news-catalog.json |
| thejakartapost.com (thejakartapost.com) | feed — packages/shared/news-catalog.json |
| thenarwhal.ca (thenarwhal.ca) | feed — packages/shared/news-catalog.json |
| thenationalnews.com (thenationalnews.com) | feed — packages/shared/news-catalog.json |
| thenewstack.io (thenewstack.io) | feed — packages/shared/news-catalog.json |
| thenextweb.com (thenextweb.com) | feed — packages/shared/news-catalog.json |
| thepointsguy.com (thepointsguy.com) | structured — scripts/seed-aviation.mjs |
| theprovince.com (theprovince.com) | feed — packages/shared/news-catalog.json |
| thesentry.org (thesentry.org) | feed — packages/shared/news-catalog.json |
| thestar.com.my (thestar.com.my) | feed — packages/shared/news-catalog.json |
| thetyee.ca (thetyee.ca) | feed — packages/shared/news-catalog.json |
| thinkglobalhealth.github.io (thinkglobalhealth.github.io) | structured — scripts/seed-disease-outbreaks.mjs, scripts/seed-vpd-tracker.mjs |
| tiles.openfreemap.org (tiles.openfreemap.org) | structured — apps/web/src/lite/map/style.ts |
| Times of India (timesofindia.indiatimes.com) | feed — packages/shared/news-catalog.json |
| Times of Israel (timesofisrael.com) | feed — packages/shared/news-catalog.json |
| timesca.com (timesca.com) | feed — packages/shared/news-catalog.json |
| tools.cdc.gov (tools.cdc.gov) | structured — scripts/seed-disease-outbreaks.mjs |
| Toronto Fire Services (www.toronto.ca) | structured — scripts/lib/toronto-official-cad.mjs |
| Toronto Police Service (services.arcgis.com) | structured — scripts/lib/toronto-official-cad.mjs, scripts/lib/tps-open-data.mjs |
| Toronto Police Service Open Data (data.tps.ca) | structured — scripts/lib/tps-open-data.mjs |
| Toronto Police Service Open Data (www.tps.ca) | structured — scripts/lib/tps-open-data.mjs |
| Toronto Transit Commission (TTC) GTFS-RT (gtfsrt.ttc.ca) | structured — scripts/seed-ttc-alerts.mjs |
| TradingView (scanner.tradingview.com) | structured — scripts/_sp500-breadth.mjs |
| travel.state.gov (travel.state.gov) | structured — scripts/seed-security-advisories.mjs, scripts/seed-travel-advisories.mjs |
| Travelpayouts flight-price data (api.travelpayouts.com) | Excluded / candidate — No current fetch observed |
| treasury.gov (treasury.gov) | feed — packages/shared/news-catalog.json |
| trumpstruth.org (trumpstruth.org) | feed — packages/shared/news-catalog.json |
| tts.baidu.com (tts.baidu.com) | Excluded / candidate — No current fetch observed |
| tuoitrenews.vn (tuoitrenews.vn) | Excluded / candidate — No current fetch observed |
| turnerlive.warnermediacdn.com (turnerlive.warnermediacdn.com) | Excluded / candidate — No current fetch observed |
| tv-trthaber.medya.trt.com.tr (tv-trthaber.medya.trt.com.tr) | feed — packages/client/config/live-video-sources.ts |
| tv-trtworld.medya.trt.com.tr (tv-trtworld.medya.trt.com.tr) | feed — packages/client/config/live-video-sources.ts |
| tvn24.pl (tvn24.pl) | feed — packages/shared/news-catalog.json |
| TVP Info (tvp.info) | feed — packages/shared/news-catalog.json |
| twitter.com (twitter.com) | Excluded / candidate — No current fetch observed |
| ua.usembassy.gov (ua.usembassy.gov) | structured — scripts/seed-security-advisories.mjs |
| ucdpapi.pcr.uu.se (ucdpapi.pcr.uu.se) | structured — scripts/ais-relay.cjs, scripts/seed-ucdp-events.mjs |
| ugandacoffee.go.ug (ugandacoffee.go.ug) | structured — scripts/lib/food-prices-adapters/ucda.mjs |
| uis.unesco.org (uis.unesco.org) | structured — packages/server/worldmonitor/resilience/v1/_indicator-source-policy.ts |
| ukrinform.net (ukrinform.net) | feed — packages/shared/news-catalog.json |
| ukrinform.ua (ukrinform.ua) | feed — packages/shared/news-catalog.json |
| unchainedcrypto.com (unchainedcrypto.com) | feed — packages/shared/news-catalog.json |
| understandingwar.org (understandingwar.org) | feed — packages/shared/news-catalog.json |
| UNDP Human Development Report (hdr.undp.org) | structured — scripts/benchmark-resilience-external.mjs |
| unhcr.org (unhcr.org) | feed — packages/shared/news-catalog.json |
| United Nations Population Division (population.un.org) | structured — scripts/_demographics-capability-source.mjs |
| unstats.un.org (unstats.un.org) | structured — scripts/build-un-m49-regions.mjs |
| urlhaus-api.abuse.ch (urlhaus-api.abuse.ch) | structured — scripts/ais-relay.cjs, scripts/seed-cyber-threats.mjs |
| USDA FAS PSD (api.fas.usda.gov) | structured — scripts/seed-food-stocks.mjs |
| USDA FAS PSD (apps.fas.usda.gov) | Excluded / candidate — No current fetch observed |
| USGS ScienceBase (Mineral Commodity Summaries) (www.sciencebase.gov) | structured — scripts/seed-mineral-production.mjs, scripts/seed-supply-vulnerability.mjs |
| USPTO Open Data Portal (api.uspto.gov) | structured — scripts/_defense-patents-source.mjs |
| USPTO Open Data Portal (data.uspto.gov) | structured — scripts/_defense-patents-source.mjs |
| vancouversun.com (vancouversun.com) | feed — packages/shared/news-catalog.json |
| venturebeat.com (venturebeat.com) | feed — packages/shared/news-catalog.json |
| VIA Rail Tracker (unofficial) (tsimobile.viarail.ca) | structured — scripts/viarail-live.mjs |
| viewfromthewing.com (viewfromthewing.com) | structured — scripts/seed-aviation.mjs |
| Vision of Humanity / Global Peace Index (www.visionofhumanity.org) | structured — scripts/seed-resilience-static.mjs |
| vnexpress.net (vnexpress.net) | feed — packages/shared/news-catalog.json |
| vs-hls-push-uk.live.fastly.md.bbci.co.uk (vs-hls-push-uk.live.fastly.md.bbci.co.uk) | feed — packages/client/config/live-video-sources.ts |
| vsquare.org (vsquare.org) | feed — packages/shared/news-catalog.json |
| W3C schema reference (www.w3.org) | Excluded / candidate — No current fetch observed |
| wa.me (wa.me) | Excluded / candidate — No current fetch observed |
| wabi-europe-north-b-api.analysis.windows.net (wabi-europe-north-b-api.analysis.windows.net) | structured — scripts/seed-hormuz.mjs |
| WAFA English (english.wafa.ps) | feed — packages/shared/news-catalog.json |
| warontherocks.com (warontherocks.com) | feed — packages/shared/news-catalog.json |
| web.archive.org (web.archive.org) | structured — scripts/seed-fatf-listing.mjs |
| web.cbr.ru (web.cbr.ru) | structured — scripts/seed-cbr-rates.mjs |
| webcams.windy.com (webcams.windy.com) | structured — packages/shared/pinned-webcams.ts |
| websummit.com (websummit.com) | Excluded / candidate — No current fetch observed |
| Welt (www.welt.de) | feed — packages/shared/news-catalog.json |
| whitehouse.gov (whitehouse.gov) | Excluded / candidate — No current fetch observed |
| Wikidata (query.wikidata.org) | structured — packages/server/worldmonitor/intelligence/v1/get-country-facts.ts, scripts/freeze-resilience-ranking.mjs |
| wilsoncenter.org (wilsoncenter.org) | feed — packages/shared/news-catalog.json |
| wingbits.com (customer-api.wingbits.com) | structured — packages/server/worldmonitor/military/v1/_wingbits-aircraft-details.ts, scripts/ais-relay.cjs, scripts/seed-military-flights.mjs |
| wingbits.com (ecs-api.wingbits.com) | structured — packages/server/worldmonitor/military/v1/get-wingbits-live-flight.ts |
| wingbits.com (wingbits.com) | Excluded / candidate — No current fetch observed |
| Wired (www.wired.com) | feed — packages/shared/news-catalog.json |
| wits.worldbank.org (wits.worldbank.org) | structured — scripts/ais-relay.cjs |
| workos.com (workos.com) | Excluded / candidate — No current fetch observed |
| World Air Quality Index (WAQI) (api.waqi.info) | structured — scripts/seed-health-air-quality.mjs |
| World Bank Open Data (api.worldbank.org) | structured — packages/server/worldmonitor/economic/v1/list-world-bank-indicators.ts, packages/server/worldmonitor/resilience/v1/_dimension-scorers.ts, packages/server/worldmonitor/resilience/v1/_indicator-source-policy.ts, scripts/_defense-industrial-source.mjs, +13 more |
| World Monitor hosted API (api.worldmonitor.app) | feed+structured — packages/client/services/runtime.ts, packages/shared/news-catalog.json, scripts/_widget-data-policy.cjs, scripts/ais-relay.cjs, +16 more |
| World Monitor proxy (proxy.worldmonitor.app) | structured — packages/client/utils/proxy.ts, scripts/seed-security-advisories.mjs |
| World Monitor web app (worldmonitor.app) | structured — api/seed-contract-probe.ts, packages/client/bootstrap/web-vitals-utils.ts, packages/client/config/web-origin.ts, packages/server/_shared/brief-url.ts, +22 more |
| World Monitor web app (www.worldmonitor.app) | structured — api/_cors.js, api/not-found.ts, packages/server/_shared/deprecation-policy.ts, packages/server/worldmonitor/intelligence/v1/_country-brief-evidence.ts, +10 more |
| WorldMonitor test origin (worldmonitor.invalid) | structured — api/_md-url-twin.ts, packages/client/shared/public-rpc-cache.ts |
| worldmonitor.mintlify.dev (worldmonitor.mintlify.dev) | Excluded / candidate — No current fetch observed |
| wublockchain.com (wublockchain.com) | feed — packages/shared/news-catalog.json |
| www.a16z.news (www.a16z.news) | feed — packages/shared/news-catalog.json |
| www.aaii.com (www.aaii.com) | structured — scripts/seed-aaii-sentiment.mjs, scripts/seed-fear-greed.mjs |
| www.aajtak.in (www.aajtak.in) | feed — packages/shared/news-catalog.json |
| www.aaronsw.com (www.aaronsw.com) | Excluded / candidate — No current fetch observed |
| www.abc.net.au (www.abc.net.au) | feed — packages/shared/news-catalog.json |
| www.africanews.com (www.africanews.com) | feed — packages/shared/news-catalog.json |
| www.afro.who.int (www.afro.who.int) | structured — scripts/seed-security-advisories.mjs |
| www.aftenposten.no (www.aftenposten.no) | feed — packages/shared/news-catalog.json |
| www.alarabiya.net (www.alarabiya.net) | feed — packages/shared/news-catalog.json |
| www.aljazeera.net (www.aljazeera.net) | feed — packages/shared/news-catalog.json |
| www.alphavantage.co (www.alphavantage.co) | structured — packages/server/worldmonitor/market/v1/_quote-provider.ts, scripts/_shared-av.mjs |
| www.amarujala.com (www.amarujala.com) | feed — packages/shared/news-catalog.json |
| www.anp.tl (www.anp.tl) | structured — scripts/lib/regional-fuel-feeds.mjs, scripts/shared/regional-energy-feeds.json |
| www.ansa.it (www.ansa.it) | feed — packages/shared/news-catalog.json |
| www.app.gov.al (www.app.gov.al) | structured — scripts/_global-tender-feeds.mjs |
| www.applytosupply.digitalmarketplace.service.gov.uk (www.applytosupply.digitalmarketplace.service.gov.uk) | Excluded / candidate — No current fetch observed |
| www.armeps.am (www.armeps.am) | structured — scripts/_global-tender-feeds.mjs |
| www.asahi.com (www.asahi.com) | feed — packages/shared/news-catalog.json |
| www.atlanticcouncil.org (www.atlanticcouncil.org) | feed — packages/shared/news-catalog.json |
| www.atv.hu (www.atv.hu) | feed — packages/shared/news-catalog.json |
| www.australianmining.com.au (www.australianmining.com.au) | feed — packages/shared/news-catalog.json |
| www.aviationpros.com (www.aviationpros.com) | structured — scripts/seed-aviation.mjs |
| www.aviationweek.com (www.aviationweek.com) | structured — scripts/seed-aviation.mjs |
| www.bankofengland.co.uk (www.bankofengland.co.uk) | structured — scripts/seed-yield-curve-gb.mjs |
| www.bi.go.id (www.bi.go.id) | structured — scripts/lib/food-prices-fetch.mjs |
| www.bild.de (www.bild.de) | feed — packages/shared/news-catalog.json |
| www.bing.com (www.bing.com) | Excluded / candidate — No current fetch observed |
| www.brasilparalelo.com.br (www.brasilparalelo.com.br) | feed — packages/shared/news-catalog.json |
| www.cac.gov.cn (www.cac.gov.cn) | structured — scripts/china-policy/adapters.mjs |
| www.carbonbrief.org (www.carbonbrief.org) | structured — scripts/seed-climate-news.mjs |
| www.cbc.ca (www.cbc.ca) | feed — packages/shared/news-catalog.json |
| www.cbinsights.com (www.cbinsights.com) | feed — packages/shared/news-catalog.json |
| www.cbp.gov (www.cbp.gov) | structured — packages/server/worldmonitor/displacement/v1/cross-border-data.ts, scripts/lib/border-route-sources.mjs |
| www.cbr.ru (www.cbr.ru) | structured — scripts/seed-cbr-rates.mjs |
| www.cbsl.gov.lk (www.cbsl.gov.lk) | structured — scripts/lib/food-prices.mjs |
| www.cbsnews.com (www.cbsnews.com) | feed — packages/shared/news-catalog.json |
| www.channelnewsasia.com (www.channelnewsasia.com) | feed — packages/shared/news-catalog.json |
| www.channelstv.com (www.channelstv.com) | feed — packages/shared/news-catalog.json |
| www.chinamoney.com.cn (www.chinamoney.com.cn) | structured — scripts/china-macro/calendar.mjs |
| www.chosun.com (www.chosun.com) | feed — packages/shared/news-catalog.json |
| www.cidrap.umn.edu (www.cidrap.umn.edu) | structured — scripts/seed-disease-outbreaks.mjs |
| www.cisa.gov (www.cisa.gov) | feed+structured — packages/shared/news-catalog.json, scripts/seed-cve-reference.mjs |
| www.clarin.com (www.clarin.com) | feed — packages/shared/news-catalog.json |
| www.climatecentral.org (www.climatecentral.org) | structured — scripts/seed-climate-news.mjs |
| www.cloudflarestatus.com (www.cloudflarestatus.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| www.cnbc.com (www.cnbc.com) | feed — packages/shared/news-catalog.json |
| www.cnn.gr (www.cnn.gr) | Excluded / candidate — No current fetch observed |
| www.coes.org.pe (www.coes.org.pe) | structured — scripts/lib/regional-energy-feeds.mjs, scripts/shared/regional-energy-feeds.json |
| www.coindesk.com (www.coindesk.com) | feed — packages/shared/news-catalog.json |
| www.comcom.govt.nz (www.comcom.govt.nz) | structured — scripts/seed-fuel-prices.mjs |
| www.contractsfinder.service.gov.uk (www.contractsfinder.service.gov.uk) | structured — scripts/seed-global-tenders.mjs |
| www.corriere.it (www.corriere.it) | Excluded / candidate — No current fetch observed |
| www.crisisgroup.org (www.crisisgroup.org) | feed — packages/shared/news-catalog.json |
| www.csis.org (www.csis.org) | feed — packages/shared/news-catalog.json |
| www.da.gov.ph (www.da.gov.ph) | structured — scripts/lib/food-prices.mjs |
| www.dabangasudan.org (www.dabangasudan.org) | feed — packages/shared/news-catalog.json |
| www.dailygood.org (www.dailygood.org) | feed — packages/shared/news-catalog.json |
| www.dailysabah.com (www.dailysabah.com) | feed — packages/shared/news-catalog.json |
| www.darkreading.com (www.darkreading.com) | feed — packages/shared/news-catalog.json |
| www.datos.gov.co (www.datos.gov.co) | structured — scripts/_global-tender-feeds.mjs |
| www.dawn.com (www.dawn.com) | feed — packages/shared/news-catalog.json |
| www.defensenews.com (www.defensenews.com) | feed — packages/shared/news-catalog.json |
| www.defenseone.com (www.defenseone.com) | feed — packages/shared/news-catalog.json |
| www.digi24.ro (www.digi24.ro) | feed — packages/shared/news-catalog.json |
| www.dn.se (www.dn.se) | feed — packages/shared/news-catalog.json |
| www.dnevnik.bg (www.dnevnik.bg) | feed — packages/shared/news-catalog.json |
| www.dockerstatus.com (www.dockerstatus.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| www.dr.dk (www.dr.dk) | feed — packages/shared/news-catalog.json |
| www.ecb.europa.eu (www.ecb.europa.eu) | structured — scripts/seed-economic-calendar.mjs |
| www.ecdc.europa.eu (www.ecdc.europa.eu) | structured — scripts/seed-disease-outbreaks.mjs, scripts/seed-security-advisories.mjs |
| www.economia-sniim.gob.mx (www.economia-sniim.gob.mx) | structured — scripts/lib/food-prices-fetch.mjs |
| www.eia.gov (www.eia.gov) | feed+structured — packages/shared/news-catalog.json, scripts/seed-oil-trade-series.mjs |
| www.eltiempo.com (www.eltiempo.com) | feed — packages/shared/news-catalog.json |
| www.eluniverso.com (www.eluniverso.com) | feed — packages/shared/news-catalog.json |
| www.engadget.com (www.engadget.com) | feed — packages/shared/news-catalog.json |
| www.epdk.gov.tr (www.epdk.gov.tr) | structured — scripts/_epdk-crude-imports.mjs |
| www.erb.org.zm (www.erb.org.zm) | structured — scripts/lib/regional-fuel-feeds.mjs, scripts/shared/regional-energy-feeds.json |
| www.eskom.co.za (www.eskom.co.za) | structured — scripts/shared/regional-energy-feeds.json |
| www.ethiopia-insight.com (www.ethiopia-insight.com) | feed — packages/shared/news-catalog.json |
| www.eu-startups.com (www.eu-startups.com) | feed — packages/shared/news-catalog.json |
| www.euronews.com (www.euronews.com) | feed — packages/shared/news-catalog.json |
| www.facebook.com (www.facebook.com) | Excluded / candidate — No current fetch observed |
| www.factal.com (www.factal.com) | Excluded / candidate — No current fetch observed |
| www.fao.org (www.fao.org) | feed+structured — packages/shared/news-catalog.json, scripts/lib/food-prices-fetch.mjs, scripts/lib/food-prices.mjs, scripts/seed-fao-food-price-index.mjs |
| www.federalregister.gov (www.federalregister.gov) | structured — apps/web/src/lite/data/geo-watch.ts, scripts/seed-ai-regulation.mjs, scripts/seed-federal-register.mjs |
| www.federalreserve.gov (www.federalreserve.gov) | feed+structured — packages/shared/news-catalog.json, scripts/seed-economic-calendar.mjs, scripts/seed-regulatory-actions.mjs |
| www.flightglobal.com (www.flightglobal.com) | structured — scripts/seed-aviation.mjs |
| www.foreignaffairs.com (www.foreignaffairs.com) | feed — packages/shared/news-catalog.json |
| www.fpri.org (www.fpri.org) | Excluded / candidate — No current fetch observed |
| www.france24.com (www.france24.com) | feed — packages/shared/news-catalog.json |
| www.frontex.europa.eu (www.frontex.europa.eu) | structured — packages/server/worldmonitor/displacement/v1/cross-border-data.ts, scripts/lib/border-route-sources.mjs |
| www.ft.com (www.ft.com) | feed — packages/shared/news-catalog.json |
| www.fwdstart.me (www.fwdstart.me) | Excluded / candidate — No current fetch observed |
| www.g4media.ro (www.g4media.ro) | feed — packages/shared/news-catalog.json |
| www.gdacs.org (www.gdacs.org) | structured — scripts/seed-natural-events.mjs |
| www.gets.govt.nz (www.gets.govt.nz) | structured — scripts/seed-global-tenders.mjs |
| www.gitex.com (www.gitex.com) | Excluded / candidate — No current fetch observed |
| www.githubstatus.com (www.githubstatus.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| www.goldseek.com (www.goldseek.com) | feed — packages/shared/news-catalog.json |
| www.good.is (www.good.is) | feed — packages/shared/news-catalog.json |
| www.goodgoodgood.co (www.goodgoodgood.co) | feed — packages/shared/news-catalog.json |
| www.goodnewsnetwork.org (www.goodnewsnetwork.org) | feed — packages/shared/news-catalog.json |
| www.google.com (www.google.com) | structured — scripts/ais-relay.cjs |
| www.googleapis.com (www.googleapis.com) | Excluded / candidate — No current fetch observed |
| www.gov.br (www.gov.br) | structured — scripts/seed-fuel-prices.mjs, scripts/shared/regional-energy-feeds.json |
| www.gov.uk (www.gov.uk) | feed+structured — packages/server/worldmonitor/displacement/v1/cross-border-data.ts, packages/shared/news-catalog.json, scripts/lib/border-route-sources.mjs, scripts/seed-fuel-prices.mjs, +2 more |
| www.gub.uy (www.gub.uy) | structured — scripts/shared/regional-energy-feeds.json |
| www.handybulk.com (www.handybulk.com) | structured — scripts/seed-supply-chain-trade.mjs |
| www.hotnews.ro (www.hotnews.ro) | feed — packages/shared/news-catalog.json |
| www.hurriyet.com.tr (www.hurriyet.com.tr) | feed — packages/shared/news-catalog.json |
| www.iaea.org (www.iaea.org) | feed — packages/shared/news-catalog.json |
| www.iea.org (www.iea.org) | structured — scripts/seed-energy-intelligence.mjs |
| www.iefimerida.gr (www.iefimerida.gr) | feed — packages/shared/news-catalog.json |
| www.in.gr (www.in.gr) | feed — packages/shared/news-catalog.json |
| www.index.hr (www.index.hr) | feed — packages/shared/news-catalog.json |
| www.infobae.com (www.infobae.com) | feed — packages/shared/news-catalog.json |
| www.ipolitics.ca (www.ipolitics.ca) | feed — packages/shared/news-catalog.json |
| www.irrawaddy.com (www.irrawaddy.com) | feed — packages/shared/news-catalog.json |
| www.jeuneafrique.com (www.jeuneafrique.com) | feed — packages/shared/news-catalog.json |
| www.jodidata.org (api.publisher.jodidata.org) | structured — scripts/seed-jodi-gas.mjs |
| www.jodidata.org (www.jodidata.org) | structured — scripts/seed-jodi-gas.mjs, scripts/seed-jodi-oil.mjs, scripts/seed-oil-trade-series.mjs |
| www.jpost.com (www.jpost.com) | feed — packages/shared/news-catalog.json |
| www.jutarnji.hr (www.jutarnji.hr) | feed — packages/shared/news-catalog.json |
| www.lapresse.ca (www.lapresse.ca) | feed — packages/shared/news-catalog.json |
| www.lasillavacia.com (www.lasillavacia.com) | feed — packages/shared/news-catalog.json |
| www.ledevoir.com (www.ledevoir.com) | feed — packages/shared/news-catalog.json |
| www.lemonde.fr (www.lemonde.fr) | feed — packages/shared/news-catalog.json |
| www.lennysnewsletter.com (www.lennysnewsletter.com) | feed — packages/shared/news-catalog.json |
| www.liberal.gr (www.liberal.gr) | Excluded / candidate — No current fetch observed |
| www.lighthousereports.com (www.lighthousereports.com) | feed — packages/shared/news-catalog.json |
| www.linkedin.com (www.linkedin.com) | Excluded / candidate — No current fetch observed |
| www.livescience.com (www.livescience.com) | feed — packages/shared/news-catalog.json |
| www.lrt.lt (www.lrt.lt) | feed — packages/shared/news-catalog.json |
| www.mbie.govt.nz (www.mbie.govt.nz) | Excluded / candidate — No current fetch observed |
| www.migracion.gob.pa (www.migracion.gob.pa) | structured — packages/server/worldmonitor/displacement/v1/cross-border-data.ts, scripts/lib/border-route-sources.mjs |
| www.miit.gov.cn (www.miit.gov.cn) | structured — scripts/china-policy/adapters.mjs |
| www.militarytimes.com (www.militarytimes.com) | feed — packages/shared/news-catalog.json |
| www.mining-technology.com (www.mining-technology.com) | feed — packages/shared/news-catalog.json |
| www.mining.com (www.mining.com) | feed — packages/shared/news-catalog.json |
| www.mnd.gov.tw (www.mnd.gov.tw) | structured — scripts/cross-strait-activity/adapters.mjs |
| www.mod.go.jp (www.mod.go.jp) | structured — scripts/cross-strait-activity/adapters.mjs |
| www.mof.go.jp (www.mof.go.jp) | structured — scripts/seed-yield-curve-jp.mjs |
| www.myjoyonline.com (www.myjoyonline.com) | feed — packages/shared/news-catalog.json |
| www.nabc.go.th (www.nabc.go.th) | structured — scripts/lib/food-prices-adapters/nabc.mjs |
| www.naftemporiki.gr (www.naftemporiki.gr) | feed — packages/shared/news-catalog.json |
| www.nationalarchives.gov.uk (www.nationalarchives.gov.uk) | structured — packages/server/worldmonitor/displacement/v1/cross-border-data.ts, scripts/lib/border-route-sources.mjs |
| www.nature.com (www.nature.com) | feed — packages/shared/news-catalog.json |
| www.ncei.noaa.gov (www.ncei.noaa.gov) | structured — scripts/seed-climate-ocean-ice.mjs |
| www.netlifystatus.com (www.netlifystatus.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| www.newscientist.com (www.newscientist.com) | Excluded / candidate — No current fetch observed |
| www.newyorkfed.org (www.newyorkfed.org) | structured — scripts/ais-relay.cjs |
| www.nfx.com (www.nfx.com) | Excluded / candidate — No current fetch observed |
| www.niggrid.org (www.niggrid.org) | structured — scripts/shared/regional-energy-feeds.json |
| www.northernminer.com (www.northernminer.com) | feed — packages/shared/news-catalog.json |
| www.notion-status.com (www.notion-status.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| www.nrc.nl (www.nrc.nl) | feed — packages/shared/news-catalog.json |
| www.nrk.no (www.nrk.no) | feed — packages/shared/news-catalog.json |
| www.occrp.org (www.occrp.org) | feed — packages/shared/news-catalog.json |
| www.ocpv-ci.com (www.ocpv-ci.com) | structured — scripts/lib/food-prices-adapters/ocpv.mjs |
| www.omanobserver.om (www.omanobserver.om) | feed — packages/shared/news-catalog.json |
| www.onagri.nat.tn (www.onagri.nat.tn) | structured — scripts/lib/food-prices.mjs |
| www.opec.org (www.opec.org) | structured — scripts/seed-energy-intelligence.mjs |
| www.optimistdaily.com (www.optimistdaily.com) | feed — packages/shared/news-catalog.json |
| www.oref.org.il (www.oref.org.il) | structured — scripts/ais-relay.cjs |
| www.oryxspioenkop.com (www.oryxspioenkop.com) | feed — packages/shared/news-catalog.json |
| www.pbc.gov.cn (www.pbc.gov.cn) | structured — scripts/china-macro/source-contracts.mjs |
| www.pbs.gov.pk (www.pbs.gov.pk) | structured — scripts/lib/food-prices.mjs |
| www.pbs.org (www.pbs.org) | feed — packages/shared/news-catalog.json |
| www.pizzint.watch (www.pizzint.watch) | structured — scripts/ais-relay.cjs, scripts/seed-conflict-intel.mjs |
| www.polsatnews.pl (www.polsatnews.pl) | feed — packages/shared/news-catalog.json |
| www.positive.news (www.positive.news) | feed — packages/shared/news-catalog.json |
| www.premiumtimesng.com (www.premiumtimesng.com) | feed — packages/shared/news-catalog.json |
| www.primicias.ec (www.primicias.ec) | feed — packages/shared/news-catalog.json |
| www.producthunt.com (www.producthunt.com) | feed — packages/shared/news-catalog.json |
| www.qatarenergy.qa (www.qatarenergy.qa) | structured — scripts/lib/regional-fuel-feeds.mjs, scripts/shared/regional-energy-feeds.json |
| www.radiookapi.net (www.radiookapi.net) | feed — packages/shared/news-catalog.json |
| www.radiotamazuj.org (www.radiotamazuj.org) | feed — packages/shared/news-catalog.json |
| www.rand.org (www.rand.org) | feed — packages/shared/news-catalog.json |
| www.ransomware.live (www.ransomware.live) | Excluded / candidate — No current fetch observed |
| www.rappler.com (www.rappler.com) | feed — packages/shared/news-catalog.json |
| www.rba.gov.au (www.rba.gov.au) | structured — scripts/seed-yield-curve-au.mjs |
| www.reddit.com (www.reddit.com) | structured — scripts/ais-relay.cjs |
| www.replicatestatus.com (www.replicatestatus.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| www.repubblica.it (www.repubblica.it) | feed — packages/shared/news-catalog.json |
| www.rfi.fr (www.rfi.fr) | feed — packages/shared/news-catalog.json |
| www.rigzone.com (www.rigzone.com) | feed — packages/shared/news-catalog.json |
| www.rp.pl (www.rp.pl) | feed — packages/shared/news-catalog.json |
| www.rt.com (www.rt.com) | Excluded / candidate — No current fetch observed |
| www.saastr.com (www.saastr.com) | feed — packages/shared/news-catalog.json |
| www.safe.gov.cn (www.safe.gov.cn) | structured — scripts/china-macro/source-contracts.mjs |
| www.samr.gov.cn (www.samr.gov.cn) | structured — scripts/china-policy/adapters.mjs |
| www.schneier.com (www.schneier.com) | feed — packages/shared/news-catalog.json |
| www.sciencedaily.com (www.sciencedaily.com) | feed — packages/shared/news-catalog.json |
| www.scmp.com (www.scmp.com) | feed — packages/shared/news-catalog.json |
| www.semianalysis.com (www.semianalysis.com) | feed — packages/shared/news-catalog.json |
| www.sequoiacap.com (www.sequoiacap.com) | Excluded / candidate — No current fetch observed |
| www.seznamzpravy.cz (www.seznamzpravy.cz) | feed — packages/shared/news-catalog.json |
| www.shareable.net (www.shareable.net) | feed — packages/shared/news-catalog.json |
| www.silverseek.com (www.silverseek.com) | feed — packages/shared/news-catalog.json |
| www.smartraveller.gov.au (www.smartraveller.gov.au) | structured — scripts/seed-security-advisories.mjs |
| www.sonabhy.bf (king-prawn-app-6bsvl.ondigitalocean.app) | structured — scripts/lib/regional-fuel-feeds.mjs |
| www.sonabhy.bf (www.sonabhy.bf) | structured — scripts/shared/regional-energy-feeds.json |
| www.spdrgoldshares.com (www.spdrgoldshares.com) | structured — scripts/seed-gold-etf-flows.mjs |
| www.spiegel.de (www.spiegel.de) | feed — packages/shared/news-catalog.json |
| www.statcan.gc.ca (www.statcan.gc.ca) | structured — packages/server/worldmonitor/resilience/v1/_indicator-source-policy.ts |
| www.stats.gov.cn (www.stats.gov.cn) | structured — scripts/china-macro/calendar.mjs, scripts/china-macro/source-contracts.mjs |
| www.stimson.org (www.stimson.org) | feed — packages/shared/news-catalog.json |
| www.sunnyskyz.com (www.sunnyskyz.com) | feed — packages/shared/news-catalog.json |
| www.svd.se (www.svd.se) | feed — packages/shared/news-catalog.json |
| www.svt.se (www.svt.se) | feed — packages/shared/news-catalog.json |
| www.szse.cn (www.szse.cn) | structured — scripts/china-corporate-disclosures/adapters.mjs, scripts/china-stock-connect/adapters.mjs |
| www.tagesschau.de (www.tagesschau.de) | feed — packages/shared/news-catalog.json |
| www.tanea.gr (www.tanea.gr) | feed — packages/shared/news-catalog.json |
| www.techinasia.com (www.techinasia.com) | feed — packages/shared/news-catalog.json |
| www.techmeme.com (www.techmeme.com) | feed+structured — packages/server/worldmonitor/research/v1/list-tech-events.ts, packages/shared/news-catalog.json, scripts/ais-relay.cjs, scripts/seed-research.mjs |
| www.technologyreview.com (www.technologyreview.com) | feed — packages/shared/news-catalog.json |
| www.techstars.com (www.techstars.com) | Excluded / candidate — No current fetch observed |
| www.theglobeandmail.com (www.theglobeandmail.com) | feed — packages/shared/news-catalog.json |
| www.theguardian.com (www.theguardian.com) | feed+structured — packages/shared/news-catalog.json, scripts/seed-climate-news.mjs |
| www.thehindu.com (www.thehindu.com) | feed — packages/shared/news-catalog.json |
| www.themoscowtimes.com (www.themoscowtimes.com) | feed — packages/shared/news-catalog.json |
| www.thenationalnews.com (www.thenationalnews.com) | feed — packages/shared/news-catalog.json |
| www.thereporterethiopia.com (www.thereporterethiopia.com) | feed — packages/shared/news-catalog.json |
| www.thestar.com (www.thestar.com) | feed — packages/shared/news-catalog.json |
| www.theverge.com (www.theverge.com) | feed — packages/shared/news-catalog.json |
| www.thisdaylive.com (www.thisdaylive.com) | feed — packages/shared/news-catalog.json |
| www.token2049.com (www.token2049.com) | Excluded / candidate — No current fetch observed |
| www.tomshardware.com (www.tomshardware.com) | feed — packages/shared/news-catalog.json |
| www.tvanouvelles.ca (www.tvanouvelles.ca) | feed — packages/shared/news-catalog.json |
| www.twz.com (www.twz.com) | feed — packages/shared/news-catalog.json |
| www.unep.org (www.unep.org) | structured — scripts/seed-climate-news.mjs |
| www.unognewsroom.org (www.unognewsroom.org) | structured — scripts/seed-disease-outbreaks.mjs |
| www.upworthy.com (www.upworthy.com) | feed — packages/shared/news-catalog.json |
| www.vanguardngr.com (www.vanguardngr.com) | feed — packages/shared/news-catalog.json |
| www.vendr.com (www.vendr.com) | Excluded / candidate — No current fetch observed |
| www.vercel-status.com (www.vercel-status.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| www.viwanda.go.tz (www.viwanda.go.tz) | structured — scripts/lib/food-prices-adapters/mit.mjs |
| www.war.gov (www.war.gov) | feed — packages/shared/news-catalog.json |
| www.weather.gov.hk (www.weather.gov.hk) | structured — scripts/natural/western-pacific-cyclones.mjs |
| www.whitehouse.gov (www.whitehouse.gov) | feed — packages/shared/news-catalog.json |
| www.who.int (www.who.int) | feed+structured — packages/shared/news-catalog.json, scripts/seed-disease-outbreaks.mjs, scripts/seed-security-advisories.mjs |
| www.windy.com (www.windy.com) | Excluded / candidate — No current fetch observed |
| www.winnipegfreepress.com (www.winnipegfreepress.com) | feed — packages/shared/news-catalog.json |
| www.worldbank.org (www.worldbank.org) | structured — packages/server/worldmonitor/resilience/v1/_indicator-source-policy.ts |
| www.ycombinator.com (www.ycombinator.com) | feed — packages/shared/news-catalog.json |
| www.yesmagazine.org (www.yesmagazine.org) | feed — packages/shared/news-catalog.json |
| www.ynetnews.com (www.ynetnews.com) | feed — packages/shared/news-catalog.json |
| www.yonhapnewstv.co.kr (www.yonhapnewstv.co.kr) | feed — packages/shared/news-catalog.json |
| www.youtube.com (www.youtube.com) | feed+structured — packages/client/config/live-video-sources.ts, scripts/check-live-video-sources.mjs, scripts/lib/live-video-channel-live.mjs |
| www.zdg.md (www.zdg.md) | feed — packages/shared/news-catalog.json |
| www.zdnet.com (www.zdnet.com) | feed — packages/shared/news-catalog.json |
| www.zera.co.zw (www.zera.co.zw) | structured — scripts/lib/regional-fuel-feeds.mjs, scripts/shared/regional-energy-feeds.json |
| www.zoomstatus.com (www.zoomstatus.com) | operational-status — packages/server/worldmonitor/infrastructure/v1/list-service-statuses.ts |
| www2.moeaea.gov.tw (www2.moeaea.gov.tw) | structured — scripts/seed-fuel-prices.mjs |
| wwwnc.cdc.gov (wwwnc.cdc.gov) | structured — scripts/seed-security-advisories.mjs |
| X API (api.x.com) | structured — scripts/cross-strait-activity/japan-x.mjs, scripts/lib/company-monitoring-x-provider.mjs, scripts/lib/x-news-accounts.cjs, scripts/lib/x-post-budget.cjs, +1 more |
| x.com (x.com) | structured — scripts/cross-strait-activity/japan-x.mjs |
| xinhuanet.com (xinhuanet.com) | feed — packages/shared/news-catalog.json |
| yandex.com (yandex.com) | Excluded / candidate — No current fetch observed |
| Yemen Online (yemenonline.info) | feed — packages/shared/news-catalog.json |
| yle.fi (yle.fi) | feed — packages/shared/news-catalog.json |
| your-app.convex.site (your-app.convex.site) | structured — scripts/import-bounced-emails.mjs |
| yourstory.com (yourstory.com) | feed — packages/shared/news-catalog.json |
| zdf-hls-19.akamaized.net (zdf-hls-19.akamaized.net) | feed — packages/client/config/live-video-sources.ts |
| zerkalo.io (zerkalo.io) | feed — packages/shared/news-catalog.json |
| zn.ua (zn.ua) | feed — packages/shared/news-catalog.json |
{/* END GENERATED SOURCE ATTRIBUTION */}
