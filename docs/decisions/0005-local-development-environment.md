# 0005. Local development environment

- Status: Accepted
- Date: 2026-10-20
- Updated: 2026-10-25 (pnpm 12, Mailpit, phone testing over USB)

## Context

Development happens on a Windows 11 laptop with 8 GB RAM, using Visual Studio Code. The setup must stay light and reproducible.

## Decision

- Windows 11 with PowerShell, Visual Studio Code and Git.
- Node.js 24 (LTS line) and pnpm 12, using a pnpm workspace (`apps/*`).
- Docker Desktop runs PostgreSQL 17, Valkey 8 and Mailpit through `docker-compose.yml`. Mailpit catches every email the API sends in development and shows it at http://localhost:8025. Ports are bound to `127.0.0.1` and each container has a memory limit.
- WSL memory is capped (about 3 GB) in `.wslconfig` to leave room for Windows and the editor.
- pnpm blocks dependency build scripts unless approved. Approvals are recorded in `allowBuilds` in `pnpm-workspace.yaml`, and each addition is checked before approval.
- pnpm installs only package versions published at least 3 days ago (`minimumReleaseAge`, ADR 0008).
- Android testing will use a real phone, not the emulator. The phone connects over USB with `adb reverse tcp:3000 tcp:3000`, so the API can stay on `127.0.0.1` (ADR 0007). iOS builds need macOS (a cloud Mac build service later).
- Secrets live only in the untracked `.env`; `.env.example` holds placeholders.

## Alternatives considered

Developing inside Ubuntu on WSL (lower memory use, closer to production). It remains an option; the repository is fully in GitHub, so switching later means cloning and reinstalling.

## Consequences

- Docker Desktop must be running before `docker compose up -d`.
- Exact tool versions should be re-checked and recorded here when they change. Last checked on 2026-10-25: Node.js 24.20.0, pnpm 12.14.0.
