# Temporary dependency security backports

These packages retain the upstream names and runtime APIs. Their private versions identify WorldMonitor backports, not published upstream releases.

The root project uses `braces` 3.0.4-worldmonitor.1 and `stream-json` 1.9.2-worldmonitor.1. It declares the local sources directly and uses npm `$` overrides to select them for every transitive consumer. `install-links=true` makes npm copy each package into the installation. The `@vercel/og` and blog-only `http-cache-semantics` backports left with the blog and brief carousel (2026-11).

## Source and changes

`braces` starts from the npm 3.0.3 package, with its MIT license. `index.js` and `lib/utils.js` remain unchanged. The parser limits combined brace and parenthesis nesting to 100. The compile, expand, and stringify walkers enforce the same limit for ASTs supplied directly. A caller can reduce the limit but cannot disable or raise the security ceiling. This follows the approach in [upstream PR 72](https://github.com/micromatch/braces/pull/72), with parser depth derived from the existing stack.

Neither backport has an install script. The committed source is the installed artifact, including when lifecycle scripts are disabled.

`stream-json` starts from the npm 1.9.1 package, with its BSD-3-Clause license. The root selects the private 1.9.2-worldmonitor.1 backport. Only `Assembler.js` changes. Both value assignment paths create an own data property for `__proto__`, following the [upstream fix](https://github.com/uhop/stream-json/commit/2f2d35bbb547306991ded6487a279154d865a358). The backport preserves the CommonJS import paths and streaming API used by `jayson`; upstream 3.6.0 changes those contracts. Its package manifest removes lifecycle scripts and development dependencies. The other upstream files remain unchanged. The 1.x package has no JSONC parser or verifier.

Run `node --test tests/dependency-security-regression.test.mjs tests/dependency-backports.test.mjs` after a clean install. The regressions exercise the installed `jayson` stream parser, nested and primitive prototype keys, identity and deleting revivers, consecutive JSON values, and KaTeX trust options. Replace the stream-json backport when `jayson` supports a patched upstream version or upstream publishes a compatible 1.x fix.

## Verification and removal

Bump the private package version and regenerate all affected lockfiles whenever its source changes. The root dependency cache also hashes the vendored source. Docker builders set the install-links option explicitly because credential-safe build contexts exclude npm configuration files.

When upstream publishes compatible fixes, replace the direct local dependencies with the upstream versions and remove their `$` overrides. Run these regressions and the affected builds before removing the matching vendor directory. Remove the install-links settings when no local package needs them. Do not restore the advisory suppressions.
