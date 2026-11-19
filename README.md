# World Monitor Lite (unofficial fork)

A private, low-noise intelligence dashboard for three domains: **geopolitics and conflicts**, **finance and crypto**, and **technology and AI**. It is built from [World Monitor](https://github.com/koala73/worldmonitor) by Elie Habib, reduced to one web app and the ingestion pipeline behind it.

> **Modified version.** This repository is a modified fork of [koala73/worldmonitor](https://github.com/koala73/worldmonitor), changed by Thang Nguyen ([@thangnc](https://github.com/thangnc)) since 2026-11-07. The changes:
>
> - the old dashboard, its site variants, the desktop app, the CLI, SDKs, MCP server, blog, pro and SEO pages are removed;
> - the user backend (Convex, Clerk, billing) and the analytics, digest and notification services are removed;
> - the code is restructured as an npm-workspaces monorepo;
> - a new Lite UI is added at `/lite`.
>
> The full history is in the git log. This notice is given under section 5(a) of the GNU AGPL.

**This is not the official World Monitor.** It is not affiliated with, endorsed by or supported by World Monitor or its author. "World Monitor" names where this code came from; the name and official branding stay with the original author. For the official project, its hosted app and its support, go to [koala73/worldmonitor](https://github.com/koala73/worldmonitor).

## What it does

The UI lives at `/lite`. `/` and `/dashboard` redirect there.

| Screen | Path | Shows |
|---|---|---|
| Briefing | `/lite` | The cross-domain hourly brief: priority events, market pulse, escalation tracker and upcoming catalysts |
| Geopolitics | `/lite/geopolitics` | A conflict map (UCDP, GDELT, unrest, military flights, UKMTO maritime incidents), hotspot escalation scored with the Country Instability Index (CII v14), indicators and a regional timeline |
| Finance | `/lite/finance` | Where markets are moving, market-moving events, crypto and stablecoins, the US Treasury curve and other 10-year bonds, and the macro calendar |
| Technology | `/lite/tech` | AI and technology news by topic (models, policy, research, infrastructure), and a map of internet outages, DDoS, submarine cables and CVEs |
| Sources | `/lite/sources` | Read-only view of the ingestion: connectors, freshness limits, licensing and the source tier policy |

Early indicators come first: feeds that report army activity, violence, macro releases, bond moves, hacking, releases and outages as they happen. Each indicator links to the news around it and says "No linked news found" rather than guessing a cause. A widget shows real data, a labelled derived rule, or labelled samples, never unlabelled samples.

## How it works

```
seeders (scripts/seed-*.mjs) ─┐
AIS relay (scripts/ais-relay.cjs) ─┼─► Redis (Upstash or a local REST proxy) ─► Edge API handlers (api/, packages/server/) ─► Lite UI (apps/web/src/lite/)
```

- **Cache first.** Seeders and the relay write Redis keys with `seed-meta:<key>` freshness records. The API handlers read Redis, not upstreams. `/api/health` grades every key's freshness.
- **Contracts.** Services are defined in Protocol Buffers (`packages/contracts/proto/`). `make generate` emits the TypeScript clients, server types and OpenAPI with [sebuf](https://github.com/SebastienMelki/sebuf).
- **UI.** Preact and Tailwind, with MapLibre maps on OpenFreeMap tiles.

| Path | What it holds |
|---|---|
| `apps/web/` | `@wm/web`: the Lite UI and its Vite config |
| `packages/client/` | `@wm/client`: browser services, config and types the UI builds on |
| `packages/server/` | `@wm/server`: the API handlers and shared server code |
| `packages/shared/` | `@wm/shared`: logic and data both the browser and the server use |
| `packages/contracts/` | `@wm/contracts`: proto sources, generated clients and OpenAPI |
| `api/`, `middleware.ts` | The Vercel Edge entry points |
| `scripts/` | Seeders, the AIS relay and repository tooling |
| `docker/` | The self-hosted images and the local Redis REST proxy |
| `docs/engineering/` | Specs, lessons, runbooks and plans |

## Run it locally

Requires Node.js 24 (pinned in `.nvmrc`; `nvm install` inside the checkout reads it).

```bash
git clone https://github.com/thangnc/worldmonitor.git
cd worldmonitor
npm ci
npm run dev
```

Open <http://localhost:3000/lite>. The app starts with no environment variables, but the screens stay empty until Redis has data.

For live data, put `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in `.env.local` (an Upstash database, or the local proxy in `docker-compose.yml`). Then run three shells:

```bash
npm run dev                # 1. the app and its API handlers
npm run seed:lite:watch    # 2. the Lite seeders, each on its own interval
npm run relay:local        # 3. the AIS relay on 127.0.0.1:3004
```

Each source's own credentials are listed in `.env.example`. [CONTRIBUTING.md](CONTRIBUTING.md#live-data-locally-three-shells) explains the relay's local-only settings.

## Documentation

- [CONTRIBUTING.md](CONTRIBUTING.md): setup, checks and the pull-request workflow.
- [ARCHITECTURE.md](ARCHITECTURE.md): system design, CI/CD and the directory reference.
- [CONCEPTS.md](CONCEPTS.md): shared terms.
- [docs/engineering/](docs/engineering/README.md): the engineering knowledge base. [architecture/lite.md](docs/engineering/architecture/lite.md) is the canonical Lite spec.
- [CLAUDE.md](CLAUDE.md): the guide for Claude Code, the supported coding agent.

## Data sources

Every upstream host the code calls is listed with its provider, licence and status in [`packages/shared/source-attribution-manifest.json`](packages/shared/source-attribution-manifest.json), rendered in [source attribution](docs/engineering/architecture/source-attribution.md).

Lite applies a source-policy filter on that manifest. It skips hosts marked `excluded` and the sixteen hosts licensed under "the World Monitor agreement", which covers the original project, not this fork. A new feed must pass the same filter.

## License

The code is licensed under the **GNU Affero General Public License v3.0 only (AGPL-3.0-only)**. See [LICENSE](LICENSE) for the full text.

Copyright (C) 2024-2026 Elie Habib. Modifications copyright (C) 2026 Thang Nguyen, under the same licence.

- You may use, modify and redistribute the code, including commercially, when you meet the AGPL's terms.
- Anyone who interacts with a modified version over a network must be offered its source (section 13). This repository is that source for this fork.
- The licence grants no trademark rights. Official branding, and any terms other than the AGPL, come from the original author.

## Credits

World Monitor was created by **Elie Habib** ([@koala73](https://github.com/koala73)) and its contributors. This fork exists because of their work.

Flight data comes from [Wingbits](https://wingbits.com) and OpenSky, vessel positions from [AISStream](https://aisstream.io), and conflict data from [UCDP](https://ucdp.uu.se) and [GDELT](https://www.gdeltproject.org).

## Security

Report a vulnerability privately as described in [SECURITY.md](SECURITY.md). Do not open a public issue.
