# Sarafan UI development and operations

[Repository overview](../README.md) · [Core environment setup](https://github.com/sara-fan/sarafan.core/blob/main/docs/environment-setup.md)

Product requirements are defined in the [current specification](https://github.com/sara-fan/sarafan.spec); implementation scope and delivery are tracked in the [MVP issue plan](https://github.com/sara-fan/sarafan.spec/issues/26).

## Prerequisites

- Node.js matching [package.json](../package.json): `^22.23.0 || ^24.15.0`
- npm 10 or newer
- Docker

## Local development

```bash
npm ci
npm run dev
```

Vite serves the application at [localhost:5173](http://localhost:5173) by default; check its terminal output if that port is occupied. Requests under `/api/v1` are proxied to Sarafan Core at [localhost:8080](http://localhost:8080). Follow the [Core environment setup guide](https://github.com/sara-fan/sarafan.core/blob/main/docs/environment-setup.md) to start a separate development database and API before exercising authentication.

When Core uses its native launch profile on port 5080, set the development proxy target before starting Vite. In PowerShell:

```powershell
$env:SARAFAN_API_TARGET = 'http://localhost:5080'
npm run dev
```

In Bash:

```bash
SARAFAN_API_TARGET=http://localhost:5080 npm run dev
```

For another isolated Core instance, use its address, for example `http://127.0.0.1:25180`. `SARAFAN_API_TARGET` changes only the Vite development proxy; it does not configure the production container.

The demo verification code is the phone number's last four digits in every build; the UI does not disclose that rule. This predictable demo mechanism must be replaced and disabled before real orders or a real payment-system integration are enabled, regardless of the build/runtime environment name; see the [release prerequisites](https://github.com/sara-fan/sarafan.spec/issues/26).

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
npm run coverage
npm run build
```

Coverage runs the test suite and enforces at least 95% statements, branches, functions and lines, matching CI. Use `npm test` for a test run without coverage. The production bundle is written to `dist/`.

## Docker

The container proxies `/api/v1/` to `api:8080`, so it must share a Docker network with the Core `api` service for API requests to work. Start the isolated `sarafan-core-dev` stack described in the Core guide, then run these commands from the UI checkout:

```bash
docker build --tag sarafan-ui:local .
docker run --rm --publish 127.0.0.1:8082:8080 --network sarafan-core-dev_default sarafan-ui:local
```

Use the actual Core project network if you chose another project name. Nginx serves the containerized application at [localhost:8082](http://localhost:8082); its health endpoint is [localhost:8082/health](http://localhost:8082/health). That endpoint checks the frontend container, so also verify an API request and customer session flow. A container started without the Core network can serve static pages but cannot resolve the API upstream.

Cloud deployment is managed in Core, with the customer application at [sarafan.sw.consulting](https://sarafan.sw.consulting). The shared edge resolves `sarafan-ui`; the dedicated edge routes to the `ui` service. Preserve the original HTTPS scheme through the edge and frontend proxies so Core's secure refresh cookies work. Follow the [Core guide](https://github.com/sara-fan/sarafan.core/blob/main/docs/environment-setup.md#cloud-production-environment) for DNS, TLS, image tags, migrations, backups and updates. It also documents the current difference between published image namespaces and the cloud Compose image paths.

## Observability

UI logging is disabled unless the runtime master switch is exactly `true`:

```bash
docker run --rm --publish 127.0.0.1:8082:8080 --network sarafan-core-dev_default \
  --env SARAFAN_UI_LOGGING_ENABLED=true \
  sarafan-ui:local
```

The container writes `/runtime-config.js` when it starts and Nginx serves that asset with `Cache-Control: no-store`. Recreate the container with the updated `SARAFAN_UI_LOGGING_ENABLED` environment value using the same image; no `npm run build` or image rebuild is needed. Missing, empty, or invalid values disable all Sarafan UI log records. Local development can use `VITE_SARAFAN_UI_LOGGING_ENABLED=true` before starting Vite.

When enabled, Production emits Warning and Error events; Development also permits Debug and Information events. Output is one concise human-readable line with an RFC 3339 UTC timestamp, OpenTelemetry severity, stable event name, W3C correlation identifiers, and an English diagnostic message. Logging and sink failure never changes application behavior.

Every API network attempt carries a W3C `traceparent` even when UI logging is disabled. A retry retains the logical trace ID and receives a new span ID. For Core failures, the validated RFC 9457 `traceId` and `instance` link the browser event to Core telemetry.

The allowlist excludes raw URLs/query strings, request/response bodies and headers, access/refresh tokens, cookies and verification codes, customer or device data, DOM/storage/history content, Error messages/stacks/causes, and localized Problem Details text. A remote browser exporter is intentionally not included.

## Optional pull request template

Use the [traceability template](../.github/PULL_REQUEST_TEMPLATE/traceability.md) if helpful, or write your own PR description. It provides prompts for the planning issue, specification version and sections, relevant scenarios and design frames, and verification results.

To select it on GitHub, append `&template=traceability.md` to a PR creation URL that already has query parameters, or `?template=traceability.md` if it has none. You can also copy the template into the description. See [GitHub's query parameter documentation](https://docs.github.com/en/pull-requests/reference/using-query-parameters-to-create-a-pull-request).

The template is opt-in, is not the default PR body, and has no CI enforcement. Applicable issue and repository requirements still apply when using a custom description.

