# 0001. Modular monolith, local-first development

- Status: Accepted
- Date: 2026-10-20

## Context

The project starts on a single developer laptop and aims to grow later. The reference handbook proposes Kubernetes, Kafka, a second database and a multi-region setup, which are justified only at much larger scale.

## Decision

- Build one deployable backend (a modular monolith) with clear module boundaries.
- Run supporting services (PostgreSQL, Valkey) locally with Docker Compose.
- Do not introduce Kubernetes, microservices, multiple databases or expensive infrastructure until a measured need exists.

## Consequences

- Simple to run, debug and test on an 8 GB laptop.
- Module boundaries must be kept clean (no cross-module table access) so extraction stays possible.
- Scaling claims (for example "millions of users") are made only after load testing against defined targets.
