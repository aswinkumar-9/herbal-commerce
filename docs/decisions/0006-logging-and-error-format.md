# 0006. Logging, request IDs and error format

- Status: Accepted
- Date: 2026-10-20

## Context

Operations need searchable logs that can be tied to one request, without leaking secrets or personal data. Clients need one predictable error shape.

## Decision

- Use `nestjs-pino` (Pino) for structured logs.
  - Development: readable single-line output (`pino-pretty`).
  - Production and tests: JSON with ISO timestamps, a text severity `level`, `service` and `env` fields.
- Every request gets an ID. A valid incoming `X-Request-Id` (8 to 64 characters of letters, digits, `_` or `-`) is reused; anything else is replaced by a generated UUID, which prevents log injection. The ID is returned in the `X-Request-Id` response header and appears on every log line for that request.
- Sensitive request fields are redacted from logs (`Authorization`, `Cookie`, API-key headers, `Set-Cookie`). Request bodies are not logged.
- Health endpoints (`/health`, `/health/ready`) are not request-logged, to avoid noise from probes.
- Log level comes from the `LOG_LEVEL` environment variable (default `info`).
- A global exception filter returns one error format: the usual status code and message, plus `statusCode` and `requestId`. Unexpected errors return a generic message (`Internal server error`) and the details go to the log only.

## Consequences

- Support and developers can trace one request across log lines using the request ID.
- Later phases can ship the same JSON logs to a central system (for example Loki) without code changes.
- Metrics and tracing (OpenTelemetry, Prometheus) are added in a later phase.
