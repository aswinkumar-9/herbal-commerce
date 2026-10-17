# Herbal Commerce Platform

E-commerce platform for herbal products: customer app and website, admin console, and backend API.

## Local setup

Prerequisites: Git, Node.js LTS, pnpm, Docker Desktop (running).

1. Copy `.env.example` to `.env` and set your own local passwords.
2. Start services: `docker compose up -d`
3. Check status: `docker compose ps` (both should show "healthy")
4. Stop services: `docker compose down` (data is kept; add `-v` to wipe it)

## Documentation

See the `docs/` folder. Start with `docs/requirements.md`.
