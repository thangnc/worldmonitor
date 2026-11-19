# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |

Only the latest version on the `main` branch is actively maintained and receives security updates.

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

This policy covers this repository, World Monitor Lite, an unofficial fork of [koala73/worldmonitor](https://github.com/koala73/worldmonitor). If you discover a vulnerability here, report it privately through [GitHub's private vulnerability reporting](https://github.com/thangnc/worldmonitor/security/advisories/new) on this repository.

If the issue also affects the original project, report it to that project as well, through [its own security policy](https://github.com/koala73/worldmonitor/security/policy).

### What to Include

- A description of the vulnerability and its potential impact
- Steps to reproduce the issue
- Affected components (edge functions, client-side code, data layers, etc.)
- Any potential fixes or mitigations you've identified

### Response Timeline

- **Acknowledgment**: Within a week of your report (this fork has one maintainer)
- **Initial Assessment**: Within two weeks
- **Fix/Patch**: Depending on severity, critical issues will be prioritized

### What to Expect

- You will receive an acknowledgment of your report
- We will work with you to understand and validate the issue
- We will keep you informed of progress toward a fix
- Credit will be given to reporters in the fix commit (unless you prefer anonymity)

## Security Considerations

World Monitor Lite is a private intelligence dashboard that aggregates publicly available data. Here are the key security areas:

### API Keys & Secrets

- **Web deployment**: API keys are stored server-side in Vercel Edge Functions
- No API keys should ever be committed to the repository
- Environment variables (`.env.local`) are gitignored
- The RSS proxy uses domain allowlisting to prevent SSRF. Both the Vercel Edge proxy and the Railway relay re-check the RSS allowlist on every redirect hop.

### Edge Functions & Sebuf Handlers

- Domain APIs are served through Sebuf (a Proto-first RPC framework) via Vercel Edge Functions
- Edge functions and handlers should validate/sanitize all input
- CORS headers are configured per-function
- Rate limiting and circuit breakers protect against abuse

### Client-Side Security

- No sensitive data is stored in localStorage or sessionStorage
- External content (RSS feeds, news) is sanitized before rendering
- Map data layers use trusted, vetted data sources
- Content Security Policy restricts script-src to `'self'` (no unsafe-inline/eval)

### Data Sources

- World Monitor aggregates publicly available OSINT data
- No classified or restricted data sources are used
- State-affiliated sources are flagged with propaganda risk ratings
- All data is consumed read-only — the platform does not modify upstream sources

## Scope

The following are **in scope** for security reports:

- Vulnerabilities in this repository's code
- Edge function security issues (SSRF, injection, auth bypass)
- XSS or content injection through RSS feeds or external data
- API key exposure or secret leakage
- Docker Node API (`docker/local-api/`) authentication bypass or token leakage
- Dependency vulnerabilities with a viable attack vector

The following are **out of scope**:

- Vulnerabilities in third-party services we consume (report to the upstream provider)
- Social engineering attacks
- Denial of service attacks
- Issues that exist only in the original project or in other forks (report them there)
- Security issues in user-provided environment configurations

## Best Practices for Contributors

- Never commit API keys, tokens, or secrets
- Use environment variables for all sensitive configuration
- Sanitize external input in edge functions
- Keep dependencies updated — run `npm audit` regularly
- Follow the principle of least privilege for API access

---

Thank you for helping keep this project safe.
