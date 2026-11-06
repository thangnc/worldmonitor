---
paths:
  - "proto/**"
---

# Proto and sebuf codegen

Source of truth: [CONTRIBUTING.md "Working with Sebuf"](../../CONTRIBUTING.md#working-with-sebuf-rpc-framework), the "Proto conventions" section of [docs/adding-endpoints.mdx](../../docs/adding-endpoints.mdx).

## Rules

- Time fields are `int64` Unix epoch milliseconds with `[(sebuf.http.int64_encoding) = INT64_ENCODING_NUMBER]`. Never use `google.protobuf.Timestamp`.
- Every message, field, service, RPC, and enum value needs a `//` comment. `buf lint` fails without one.
- Every RPC declares `option (sebuf.http.config) = { path: "...", method: ... }`.
- After any `.proto` change, run `make generate` and commit `src/generated/`, `docs/api/`, and the scorecard Edge mirrors together with the source change. A PreToolUse hook blocks hand edits to `src/generated/`.
- Codegen needs `buf` and the sebuf plugins at the version pinned by `SEBUF_VERSION` in the `Makefile`. If the generated output drifts after a pull, run `make install-plugins` again. Do not hand-patch the output.
- A renamed RPC changes its generated path. Update the matching `ENDPOINT_RATE_POLICIES`, `PREMIUM_RPC_PATHS`, and `PUBLIC_NO_AUTH_RPC_PATHS` entries.

## Verify

```bash
make lint
make breaking          # against main
make generate && git status --short src/generated docs/api
npm run lint:rate-limit-policies
```
