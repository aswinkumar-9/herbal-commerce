# 0011. Data retention and cleanup

- Status: Accepted and implemented (part 3A-5)
- Date: 2026-10-27

## Context

Until part 3A-5 nothing was ever deleted (ADR 0007, known gap 7):

- every login leaves a session row;
- every refresh leaves a used refresh token, about one every 15 minutes while an app is in use, so a 30-day session can pile up thousands of rows;
- every sign-up, resend and reset request leaves a token.

India's DPDP Act expects personal data to be kept only as long as it serves its purpose.

Unverified sign-ups are also the last piece of pre-account takeover (ADR 0007, gap 4). Someone can register an email address that is not theirs. Since part 3A-4 the real owner can take it back with a password reset, but only if they know to try.

## Decision

### What is deleted, and when

| Data | Deleted | Why this period |
|---|---|---|
| Sessions, together with their refresh tokens | 30 days after they expired or were revoked | Recent history helps when looking into an incident. The logs keep the IDs anyway. |
| Used refresh tokens in live sessions | 7 days after use | Reuse detection only needs the recent ones. |
| Email verification and password reset links | once expired | An expired link is useless. |
| Unverified customer accounts, with their tokens | 7 days after sign-up | Data minimisation, and it frees the address for its real owner. Staff accounts are never deleted by the job. |

All periods are in one place: `RETENTION` in `apps/api/src/retention/retention.service.ts`.

### How it runs

- **`RetentionService.purge()`** runs the five deletes. Each is a plain conditional `deleteMany`, so a run can be repeated, interrupted, or run by several API instances at once without harm. Deleting a session or a user deletes its dependent rows through the foreign keys (`ON DELETE CASCADE`).
- **`RetentionScheduler`** runs it inside the API: 1 minute after startup, then every hour.
  - Two runs never overlap.
  - A failed run is logged (error name and code only), and the next run tries again.
  - The timers are cleared on shutdown and never keep the process alive on their own.
- **Each run logs one line** with the number of rows deleted per kind, and nothing personal.
- **No new dependency and no new database indexes.** The tables are small. When measurements show slow runs, add indexes on the columns the deletes filter on (`sessions.expiresAt`, `sessions.revokedAt`, `refresh_tokens.usedAt`, and the tokens' `expiresAt`), and delete in batches.

## Alternatives considered

- **`@nestjs/schedule`** (cron jobs inside Nest). Not now. It is a new dependency for one hourly job. Reconsider when there are several jobs.
- **A separate script run by the operating system's cron or by Jenkins.** Rejected. It needs setup on every machine and is easy to forget in development.
- **Deleting used refresh tokens at once.** Rejected. That would switch off reuse detection.
- **Keeping everything until a customer asks for deletion.** Rejected. It goes against data minimisation, and the tables would grow without end.
- **Emailing unverified customers before deleting them.** Rejected. After 7 days it adds little; they can simply register again.

## Consequences

- A customer who never verified their email can register again with the same address after 7 days.
- **Reuse detection covers 7 days after a refresh token was used.** A stolen token that comes back later is simply unknown: it still answers `401`, but the session is not ended.
- Ended sessions stay visible for 30 days for investigations, then they are gone.
- With several API instances, every instance runs the job. That is harmless; a Valkey lock can make one instance do it alone later.
- Still open (`docs/security.md`): a retention period for logs, deletion on request, and the rest of the DPDP Act list.
