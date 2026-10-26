# 0008. Security baseline for the API

- Status: Accepted
- Date: 2026-10-25
- Updated: 2026-10-26 (part 3D: rate limiting exists, `rate-limiter-flexible` is pinned exactly)

## Context

Before the first protected endpoint was built (part 3A-3), a security review found that:

- the API announced itself (`X-Powered-By: Express`) and sent no security headers;
- it accepted HTML-form bodies, which any website can submit, although it only needs JSON;
- nothing stopped it from starting in production with the `change_me` placeholders from `.env.example`;
- `pnpm audit` reported 26 known vulnerabilities, 2 of them in packages the running API uses.

Every later endpoint inherits these defaults, so they are set once, here. The full review and the status of each control are in `docs/security.md`.

## Decision

### HTTP

- **helmet** sets the standard security headers (among them `X-Content-Type-Options: nosniff`, `X-Frame-Options`, a Content Security Policy, `Referrer-Policy` and HSTS) and removes `X-Powered-By`.
- **JSON bodies only.** Nest's built-in body parsers are switched off (`bodyParser: false`) and only a JSON parser is added, with a 100 kB limit and with compressed bodies refused (`inflate: false`). Form bodies fail validation with `400`, which closes form-based CSRF. Refusing compressed bodies stops "zip bombs": bodies that are small on the wire and huge in memory.
- **CORS stays off** until the website exists. It will then allow a list of origins from the environment, never `*`.
- **The API listens on `127.0.0.1` only** until it is deployed behind HTTPS. Rate limiting has existed since part 3D (ADR 0009). The rest of the pre-production list is in `docs/security.md`.

### Configuration

- The API refuses to start with invalid or missing configuration. Error messages name the setting, never its value.
- `JWT_ACCESS_SECRET` must be at least 43 base64url characters (256 bits, as the generator in `.env.example` produces) and must not be repetitive (at least 16 different characters). A test checks that the `.env.example` placeholder is refused.
- **In production** the API also refuses a database, Valkey or JWT setting that still contains `change_me`, and a `WEB_BASE_URL` that is not `https://`.
- **SMTP in production** must switch to TLS (`requireTLS`) or fail, so emails, which carry verification links, are never sent in clear text. Plain SMTP is allowed only in development, for Mailpit.

### Dependencies (supply chain)

- **3-day minimum release age** (`minimumReleaseAge: 4320` in `pnpm-workspace.yaml`): pnpm installs only versions published at least 3 days ago. Compromised releases are usually found and removed within hours or days, so most never reach us. 3 days also matches npm's 72-hour window in which a release can still be unpublished. No exceptions: if a fix is too new, we wait.
- **Exact versions** for the packages that guard security: `@nestjs/jwt`, `helmet` and `rate-limiter-flexible`. Upgrading them is a deliberate change, with the changelog read first.
- **Unused packages are removed.** `@nestjs/mau` alone brought 20 of the 26 findings.
- **Vulnerable indirect packages** are patched with `overrides` in `pnpm-workspace.yaml` (pnpm 12 reads them there, not from `package.json`). Each override is removed once the package that pulls it in ships the fix.
- Dependency build scripts stay blocked unless approved in `allowBuilds` (ADR 0005).
- The lockfile is committed. `pnpm audit` runs before every pull request and must show no findings, or each remaining one is explained in the pull request.

## Alternatives considered

- **Keeping Nest's default parsers and only adding a limit.** Rejected. Switching them all off and adding the JSON parser explicitly keeps every body rule in one visible place (`main.ts`).
- **A longer minimum release age (for example 7 days).** Not now. 3 days covers the unpublish window without delaying security fixes much longer.

## Consequences

- Every new endpoint gets the headers, the JSON-only rule and the body limit without extra code.
- A route that needs another body type must add its own parser for that route only: payment webhooks need the raw body to check signatures, and uploads need multipart.
- Security fixes reach us at least 3 days after release. Until then, the risk is reduced in other ways where possible. For example, `inflate: false` already blocks the compressed-body attack fixed in `body-parser` 2.4.0.
- Overrides must be reviewed at every upgrade of Nest or Express.
