# 0013. Staff MFA with authenticator apps (TOTP)

- Status: Accepted and implemented (part 3B-2: setup; part 3B-3: staff login, ADR 0014)
- Date: 2026-10-29
- Updated: 2026-10-30 (part 3B-3: codes are now used at the staff login, ADR 0014)
- Updated: 2026-10-30 (part 3B-4: invited Admins get their MFA with the same command, ADR 0015)

## Context

ADR 0004 requires MFA for every Admin and Super User. Staff accounts can see and change far more than one customer, so a stolen staff password alone must never be enough.

Part 3B-2 builds the MFA foundations before any staff login exists:
- how secrets are made and stored;
- how codes are checked;
- how a staff member sets up an authenticator app.

Part 3B-3 then adds the staff login, which always asks for the password and a code together.

## Decision

### TOTP, implemented by us

- **Standard TOTP** (RFC 6238, built on HOTP from RFC 4226): SHA-1, 6 digits, a new code every 30 seconds. Every common authenticator app (Google, Microsoft, Authy) supports exactly these settings.
- **Our own implementation, about 100 lines on `node:crypto`,** with no new dependency.
  - It is proven against **every official test vector**: RFC 4226 (HOTP), RFC 6238 (TOTP, SHA-1) and RFC 4648 (base32).
  - It was also checked against a real phone during setup.
  - The common libraries were rejected: `otpauth` depends on `@noble/hashes`, and `otplib` pulls in six packages. Neither provides replay protection, which we need anyway.
- **One step either side of now is accepted** (±30 seconds), for phone clocks that are slightly off.
- **No replays.** The last time step used is stored per staff member. A code at or before it is refused, so every code works once. Using a code is an atomic conditional update, so two requests with the same code cannot both succeed.
- **Exactly 6 digits** are required, and codes are compared in constant time.

### Secrets

- **20 random bytes (160 bits)** per staff member, as RFC 4226 recommends. They are shown once as base32 (32 characters, `A`–`Z` and `2`–`7`).
- **Stored encrypted** in `users.mfaSecret` with `SecretBox`:
  - AES-256-GCM, which also detects any change;
  - a key derived for this one purpose with HKDF;
  - the user's ID bound to the value, so a secret copied to another user's row will not open;
  - a `v1.` format prefix, so the key or format can be changed later.
- **The key comes from a new `MFA_ENCRYPTION_KEY`.**
  - It has the same rules as `JWT_ACCESS_SECRET`.
  - The API refuses to start if the two are the same: one secret, one job.
  - It is separate, so replacing the JWT secret never wipes everyone's MFA.

### Setting up MFA

- **Only with a developer command:** `pnpm api:setup-staff-mfa`, with the staff member's email in `STAFF_EMAIL`.
  1. It refuses customers and unknown emails.
  2. It shows a new key once, grouped in fours.
  3. It asks for the code the app shows now, with three tries.
  4. **Only a valid code saves the key.** That proves the app works before MFA becomes mandatory. The code used here counts as used, so it cannot also be used to sign in.
- **Saving ends all of the staff member's sessions** and writes a `staff.mfa_set_up` audit entry (without the key), all in one transaction. Running the command again gives a new key, and the old one stops working at once: that is how a lost phone is handled for now.
- **No QR code yet.** The key is typed into the app by hand, and the command also prints the standard `otpauth://` link. The admin console can show a QR code later, without a QR library in the API.

## Alternatives considered

- **A TOTP library.** Rejected, for the reasons above.
- **SMS codes.** Rejected. SMS can be intercepted or redirected (SIM swap), and in India it needs a paid provider and DLT registration.
- **Passkeys (WebAuthn).** Not yet. They are stronger and phishing-resistant, but need a browser or app on the client side. Worth adding together with the admin console.
- **Setting up MFA at the first staff login** (password first, then scan). Rejected. Until setup is done, a stolen password would let an attacker register their own phone.
- **Storing secrets unencrypted, or encrypting them with the JWT secret.** Rejected: a database copy alone would produce valid codes, and rotating the JWT secret would wipe all MFA.
- **Recovery codes now.** Deferred to the admin console. Until then a developer resets MFA with the same command, which is audited.

## Consequences

- **`MFA_ENCRYPTION_KEY` must be kept safe and backed up** like a password. If it is lost or changed, no stored secret can be opened, and every staff member has to set up MFA again.
- A staff member's sessions all end whenever their MFA is set up or replaced.
- If a phone's clock is more than about 30 seconds off, its codes are refused. The setup command says to set the phone's time automatically.
- Typing the key by hand is error-prone: base32 has no `0`, `1`, `8` or `9`, which are easily confused with `O`, `I` and `B`. A QR code in the admin console will remove this.
- **Only the newest key works.** An older entry left in the app after a second setup shows codes that are refused. Delete old entries whenever the command runs again.
- **Each staff account has its own entry in the app.** Deleting an entry cannot be undone: the key is shown only once, so the only way back is running the setup again for that account.
- Part 3B-3 added the staff login with password and code, staff tokens and sessions (ADR 0014). Part 3B-4 added Admin invitations: an invited Admin gets their MFA with the same command, after choosing their password (ADR 0015).
