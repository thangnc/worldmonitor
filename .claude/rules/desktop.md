---
paths:
  - "src-tauri/**"
---

# Tauri desktop app and sidecar

Source of truth: [ARCHITECTURE.md](../../ARCHITECTURE.md), [docs/desktop-app.mdx](../../docs/desktop-app.mdx).

## Rules

- The desktop app wraps the same SPA and sends fetches to the local Node.js sidecar (`src-tauri/sidecar/`). A change to an `api/` route can need a matching change in the sidecar.
- Keep capability permissions (`src-tauri/capabilities/`) minimal. Every URL opened outside the webview goes through the open-URL safety check (`src-tauri/open-url-safety.test.mjs`).
- Signed-out desktop clients still call cloud endpoints. Check the auth and `User-Agent` behavior when you change a request path.

## Verify

```bash
npm run test:sidecar
cargo check --manifest-path src-tauri/Cargo.toml    # Rust changes
npm run desktop:dev                                 # manual drive when behavior changes
```
