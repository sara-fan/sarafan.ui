# Sarafan UI

[![ci](https://github.com/maxirmx/sarafan.ui/actions/workflows/ci.yml/badge.svg)](https://github.com/maxirmx/sarafan.ui/actions/workflows/ci.yml)
[![publish](https://github.com/maxirmx/sarafan.ui/actions/workflows/publish.yml/badge.svg)](https://github.com/maxirmx/sarafan.ui/actions/workflows/publish.yml)

Vue and Vuetify customer application for Sarafan. It provides phone-code registration and login, consent capture, refreshable sessions, profile editing, and profile-photo management. Vite builds the application and nginx serves the production image.

Product requirements are defined in the [current specification](https://github.com/sara-fan/sarafan.spec); implementation scope and delivery are tracked in the [MVP issue plan](https://github.com/sara-fan/sarafan.spec/issues/26).

## Prerequisites

- Node.js 22.23+ within the 22.x line, or 24.15+ within the 24.x line
- npm 10 or newer
- Docker

## Local development

```bash
npm ci
npm run dev
```

Vite serves the application at <http://localhost:5173>.
Requests under `/api/v1` are proxied to Sarafan Core at <http://localhost:8080>. Start the Core development service and PostgreSQL before exercising authentication. The demo verification code is the phone number's last four digits in every build; the UI does not disclose that rule. This predictable demo mechanism must be replaced and disabled before real orders or a real payment-system integration are enabled, regardless of the build/runtime environment name; see the [release prerequisites](https://github.com/sara-fan/sarafan.spec/issues/26).

Access tokens are kept in memory. The browser receives the rotating refresh token only as an HttpOnly cookie. The UI attempts one session refresh on startup. An authorized request triggers refresh only for Core's canonical `invalid-access-token` Problem Details type, followed by at most one retry; other `401` responses do not trigger refresh.

## Verification

Browser problems, HTTP transport and privacy-safe observability are provided by
`@sara-fan/ui-shared`. Application adapters retain customer endpoints, event
identities, runtime configuration and session state. The package is pinned to an
exact GitHub release artifact with lockfile integrity; clean installs and Docker
builds do not require a sibling repository. Test candidate package changes in both
Sarafan UI and Back Office before changing the pinned dependency.

```bash
npm run lint
npm test
npm run build
```

## Docker

```bash
docker build --tag sarafan-ui:local .
docker run --rm --publish 8082:8080 sarafan-ui:local
```

nginx serves the containerized application at <http://localhost:8082>. Its health endpoint is <http://localhost:8082/health>.

## Observability

UI logging is disabled unless the runtime master switch is exactly `true`:

```bash
docker run --rm --publish 8082:8080 \
  --env SARAFAN_UI_LOGGING_ENABLED=true \
  sarafan-ui:local
```

The container writes `/runtime-config.js` when it starts and nginx serves that asset with `Cache-Control: no-store`. Change `SARAFAN_UI_LOGGING_ENABLED` and restart/recreate the container using the same image; no `npm run build` or image rebuild is needed. Missing, empty, or invalid values disable all Sarafan UI log records. Local development can use `VITE_SARAFAN_UI_LOGGING_ENABLED=true`.

When enabled, Production emits Warning and Error events; Development also permits Debug and Information events. Output is one concise human-readable line with an RFC 3339 UTC timestamp, OpenTelemetry severity, stable event name, W3C correlation identifiers, and an English diagnostic message. Logging and sink failure never changes application behavior.

Every API network attempt carries a W3C `traceparent` even when UI logging is disabled. A retry retains the logical trace ID and receives a new span ID. For Core failures, the validated RFC 9457 `traceId` and `instance` link the browser event to Core telemetry.

The allowlist excludes raw URLs/query strings, request/response bodies and headers, access/refresh tokens, cookies and verification codes, customer or device data, DOM/storage/history content, Error messages/stacks/causes, and localized Problem Details text. A remote browser exporter is intentionally not included.

## Optional pull request template

Use the [traceability template](.github/PULL_REQUEST_TEMPLATE/traceability.md) if helpful, or write your own PR description. It provides prompts for the planning issue, specification version and sections, relevant scenarios and design frames, and verification results.

To select it on GitHub, append `&template=traceability.md` to a PR creation URL that already has query parameters, or `?template=traceability.md` if it has none. You can also copy the template into the description. See [GitHub's query parameter documentation](https://docs.github.com/en/pull-requests/reference/using-query-parameters-to-create-a-pull-request).

The template is opt-in, is not the default PR body, and has no CI enforcement. Applicable issue and repository requirements still apply when using a custom description.

## Customer consent

The coordinated implementation follows spec v1.17 §§4.3/4.18. Core resolves the combined phone-first authentication flow; the UI loads authentication, customer-state, and legal-document Ops metadata and renders only the current documents required for that phone. The short-lived receipt remains in memory through code verification, and requirement changes restart the flow while retaining only the phone. An Administrator creates each immutable legal document once with its effective Moscow date; authentication never silently grants personal-data processing permission.

For a separate local Core instance, set `SARAFAN_API_TARGET=http://127.0.0.1:25180` before starting Vite. This changes only the development proxy.
