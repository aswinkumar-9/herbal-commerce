# 0005. Local development environment

- Status: Accepted
- Date: 2026-10-20

## Context

Development happens on a Windows 11 laptop with 8 GB RAM, using Visual Studio Code. The setup must stay light and reproducible.

## Decision

- Windows 11 with PowerShell, Visual Studio Code and Git.
- Node.js 24 (LTS line) and pnpm 11, using a pnpm workspace (`apps/*`).
- Docker Desktop runs PostgreSQL 17 and Valkey 8 through `docker-compose.yml`. Ports are bound to `127.0.0.1` and each container has a memory limit.
- WSL memory is capped (about 3 GB) in `.wslconfig` to leave room for Windows and the editor.
- pnpm 11 blocks dependency build scripts unless approved. Approvals are recorded in `allowBuilds` in `pnpm-workspace.yaml`, and each addition is checked before approval.
- Android testing will use a real phone, not the emulator. iOS builds need macOS (a cloud Mac build service later).
- Secrets live only in the untracked `.env`; `.env.example` holds placeholders.

## Alternatives considered

Developing inside Ubuntu on WSL (lower memory use, closer to production). It remains an option; the repository is fully in GitHub, so switching later means cloning and reinstalling.

## Consequences

- Docker Desktop must be running before `docker compose up -d`.
- Exact tool versions should be re-checked and recorded here when they change.
