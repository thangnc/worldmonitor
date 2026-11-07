---
title: Dependency audit on November 7, 2026
date: 2026-11-07
area: tooling
problem_type: security_issue
tags:
  - dependency-audit
  - glob
  - minimatch
  - uuid
  - prisma
  - mysql2
  - deepmerge-ts
  - valibot
  - hono
  - rustls-webpki
  - debian
  - eol
  - vite
module: dependencies
---

# Dependency audit on November 7, 2026

A full audit of every lockfile, development dependencies included, plus an end-of-life check of runtimes and base images. Main commit `cfd716cbf`, Node 24.22.2, `cargo-audit` 0.22.2 (the CI pin). Nothing is dismissed.

## Fixed

| Advisory | Where and why it was present | Action |
| --- | --- | --- |
| GHSA-3g3m-2fjr-6pw4, glob `>=9 <=14.0.1` (medium) | Root, `pro-test`, `integrations/zapier`. Build and dev tooling only: Sentry bundler plugin, `workbox-build`, `mocha`, `archiver-utils` | Scoped overrides `glob@10`, `glob@11`, `glob@13` → 14.0.2. In Zapier the override is repeated inside the `zapier-platform-cli@19.2.1` block, because the top-level key did not reach that subtree. glob 7 copies were never affected and stay |
| GHSA-g3hv-75wg-m249, minimatch `>=7 <11.0.1` (medium) | Same three graphs, through glob, oclif, yeoman and npmcli | Scoped overrides `minimatch@9`, `minimatch@10` → 11.0.1. minimatch 3 and 5 copies are outside the range |
| GHSA-w5hq-g745-h8pq, uuid `<11.1.1` (medium) | Root, `scripts`, `pro-test`. **Runtime**: `exceljs`, `jayson`, `rpc-websockets` | Scoped overrides `uuid@8` (and `uuid@11` in `pro-test`) → 11.1.1. The consumers call `v4`/`v1` only; uuid 11 still ships CommonJS |
| GHSA-3f6p-5ww8-9rcr (high), GHSA-rgwj-5xj2-c3m3, mysql2 | Umami runtime image, through the Prisma 7.8.0 CLI. Umami uses Postgres, so no live path | pnpm override `mysql2` → 3.24.4, the version Prisma 7.10.1 itself ships |
| GHSA-ggr8-5vv4-36mx, deepmerge-ts `<8.0.0` (high) | Umami runtime, through `@prisma/config` | pnpm override `deepmerge-ts` → 8.0.2, the version `@prisma/config` 7.10.1 ships |
| GHSA-5qjj-4xww-7phc valibot; GHSA-92pp-h63x-v22m, GHSA-frvp-7c67-39w9, GHSA-rmxm-3fg6-px4f @hono/node-server | Umami runtime, through `@prisma/dev` 0.24.3, the `prisma dev` local server | pnpm override `@prisma/dev` → 0.24.17 (same `@prisma/get-platform` and query-plan executor 7.2.0). It ships valibot 1.4.2 and no longer depends on Hono at all |
| RUSTSEC-2026-0382, rustls-webpki 0.103.15 | `sdk/rust` | `cargo update -p rustls-webpki` → 0.103.16 |

Prisma stays at 7.8.0 in the Umami runtime. Upstream Umami at the pinned commit generates its client with `^7.8.0`, and the runtime stage installs Prisma next to that standalone build, so a runtime-only bump to 7.10.1 risked a client and runtime mismatch that cannot be checked without building the image.

## End of life

| Item | Status | Action |
| --- | --- | --- |
| `.oss-scanner/Dockerfile`: `rust:1-bookworm`, `node:24-bookworm` | Debian 12 left regular security support on 2026-07-11 | Moved to `rust:1-trixie` and `node:24-trixie` (Debian 13), pinned to multi-arch index digests. Every Tauri build package exists on trixie |
| Vite 6.4.5 | Out of support: 8.3.6 is current, and Vite backports security fixes only to the previous major (7). No open advisory | **Not changed here.** A two-major upgrade under the customized `vite.config.ts` needs its own change |
| Node 22 in `Dockerfile.umami` and one workflow | Maintenance LTS until 2027-04-30 | No change yet; move with upstream Umami before April 2027 |
| `redis:7-alpine` (7.4) | Security support until 2029-12-01 | No change |
| Node 24, Postgres 18, Alpine, nginx `alpine` | Supported | No change |

## Accepted, no fix available

- **GHSA-gcqx-w48m-w2h4, deepmerge 4.3.1 (low)**: no patched release exists. Root (dev): `@rollup/plugin-node-resolve`. `scripts` (runtime): `html-to-text`, which deep-merges its own option objects, not untrusted input. Revisit when a fix ships.
- **`src-tauri` Cargo warnings**: 10 unmaintained crates (`unic-*`, `zvariant*`, `zbus_names`, `pin-utils`, `proc-macro-error`) and one unsound (`glib` 0.18, RUSTSEC-2024-0429). All arrive through Tauri's Linux GTK and D-Bus stack. No vulnerabilities. They move when Tauri moves.

## Verification

- `npm audit` per lockfile: root and `scripts` report only the deepmerge low; `pro-test`, `integrations/zapier`, `consumer-prices-core`, `blog-site`, both workers and `demos/verification-desk` report 0. `pnpm audit` for the Umami runtime reports 0. The docker runtime lockfile passes the CI production audit. `cargo audit`: `sdk/rust` 0 vulnerabilities; `src-tauri` 0 vulnerabilities, 11 warnings.
- `tests/dependency-security-regression.test.mjs` adds 15 checks. All 14 new lockfile checks fail against the previous lockfiles and pass now (52/52). The Hono checks now allow Hono to be absent, since `@prisma/dev` 0.24.17 removed it; the override stays for any future copy.
- glob 14: `npm run build:pro` and `VITE_VARIANT=full npx vite build` succeed; workbox precaches 29 entries (1.1 MiB) and the PWA precache, recovery and deploy-config tests pass (332/332). `zapier-platform build` zips the integration through `archiver-utils` on glob 14.
- uuid 11: `exceljs` writes a workbook.
- Zapier: 91 mocha tests pass; `zapier-platform validate` reports warnings only.
- Umami runtime: a frozen `pnpm install --prod` resolves the overrides; the Prisma 7.8.0 CLI loads `prisma.config.ts`, validates a schema and generates a client.
- Rust SDK: `cargo test` passes after the `rustls-webpki` update.
- trixie: the scanner image builds through the toolchain step; WebKitGTK 2.54, JavaScriptCore 2.54 and libsoup 3.6.5 resolve.
- **Unverified**: the full `.oss-scanner` image build (including the Tauri `cargo check`), the Umami Docker image build and a real `prisma migrate deploy`, Sentry source-map upload with glob 14, and deploys.
