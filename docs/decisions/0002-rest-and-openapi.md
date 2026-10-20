# 0002. REST with OpenAPI

- Status: Accepted
- Date: 2026-10-20

## Context

The reference handbook proposes GraphQL for the apps and REST for webhooks. Payment, courier and SMS providers all use REST and webhooks regardless, so REST is needed either way.

## Decision

Use REST for all APIs, documented with OpenAPI. Defer GraphQL.

## Consequences

- Authorization is applied per endpoint, which fits the three-role model and is easy to test.
- Responses for catalog pages are straightforward to cache.
- If a mobile screen later needs many round trips, we can add combined endpoints (for example one home-screen endpoint) or introduce GraphQL for those screens only.
- API versioning and OpenAPI generation will be added with the first business endpoints.
