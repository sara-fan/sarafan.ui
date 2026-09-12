# Repository instructions

## Specification and repository guidance

- Follow the current specification identified in the [specification README](https://github.com/sara-fan/sarafan.spec#source-of-truth). If an implementation issue conflicts with it, flag the discrepancy before implementing the affected behavior.
- In implementation PR descriptions, cite the governing specification version and section, and link the planning issue. Use any suitable format; the PR template is optional.
- When a change introduces or changes a lasting convention, API contract, domain invariant, security/privacy rule, workflow, or test pattern, update the nearest relevant `AGENTS.md` in the same PR. Keep entries concise and reusable.
- Otherwise, include `AGENTS.md: no durable change` in the PR description.
- Before editing documentation, read its current revision and preserve user-authored changes. Keep product requirements in the specification and task-specific discussion in the issue.
- Before enabling real orders or a real payment-system integration, replace and disable the predictable phone-suffix demo verification mechanism. A build/runtime environment named Production does not satisfy this requirement. Keep this release gate tracked in the [MVP delivery issue](https://github.com/sara-fan/sarafan.spec/issues/26).

## Copyright headers

- Add the Sarafan copyright header to every file you create or modify whenever the file format safely supports comments. Markdown (`.md`) files are exempt and must not contain the header.
- Use the comment syntax appropriate for the file type. Keep shebangs, encoding declarations, XML declarations, and other required first-line directives before the header.
- Do not add a header where comments are unsupported or would alter behavior, and do not modify generated files, dependency files, build output, coverage output, lockfiles, or binary files solely to add a header.
- Preserve an existing copyright or license header instead of adding a duplicate.

For JavaScript and other files that support `//` comments, use:

```js
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
```

For other comment-capable formats, use the same three lines with that format's native comment syntax.

## Error handling

- Treat RFC 9457 `type` as the canonical machine-readable identifier for Core API failures. Never branch on localized `title`, `detail`, raw exception text, or HTTP status alone.
- Accept a Core error as structured only when its media type is `application/problem+json` and it contains a valid Sarafan `type`, matching HTTP/body `status`, Russian `title` and `detail`, `instance`, and `code`. Preserve optional `errors` and `traceId` without flattening them.
- Do not add compatibility parsing for partial Problem Details, arbitrary JSON, `msg`, legacy envelopes, or bodyless error responses. Normalize malformed or inconsistent server responses to the internal UI protocol problem.
- Send `Accept: application/json, application/problem+json` for JSON endpoints and explicit image media types plus `application/problem+json` for photo downloads.
- Use the shared `ProblemError` abstraction for API and internal failures. Components must retain the structured problem, use the shared presentation and field-error helpers, and must not render an unknown `Error.message`.
- Model browser-originated and local failures with RFC 9457 field semantics under `https://sarafan.sw.consulting/problems/ui/`, but omit `status` when no HTTP response exists and never claim the `application/problem+json` media type for an internal failure.
- Create internal problems through the centralized catalogue. Their type, code, Russian title, and safe Russian default detail are stable UI contracts; generate a unique `instance` for each occurrence.
- Keep an internal problem's original JavaScript `cause` non-enumerable and diagnostic-only. Never render, serialize, persist, or log the cause or raw payload, especially when it may contain personal data, tokens, or browser/native error text.
- Represent local and remote validation with structured `errors` collections and expose field messages through the shared helper instead of flattening them into a generic string.
- Preserve single-flight token refresh and retry an authorized request at most once. Treat only the canonical invalid-refresh-token problem type as expected session expiry; distinguish network restore failures and offer an explicit retry state.
- Treat HTTP 5xx responses and invalid HTTP response formats as service unavailability. Clear the authenticated session and show `Сервис недоступен. Пожалуйста, повторите позже.` on the authentication screen.
- Route intentional suppression through a named shared policy. Version lookup and server logout failures may be suppressed after normalization; photo preview failures remain recoverable but are presented while keeping the profile form usable.
- Add tests for every new problem type, parser validation and retry branch, structured field errors, non-serialization of causes, and intentional recovery/suppression policy. New and modified code must satisfy the repository's 95% coverage thresholds.

## Observability and logging

- Emit UI logs only through the stable catalogue and facade in `src/observability/`. Direct `console.*` calls are forbidden outside the console sink, and call sites must not construct free-form events, messages, or attribute objects outside the catalogue contract.
- Every event must have a stable dotted name, OpenTelemetry severity number/text, fixed English human-readable message template, RFC 3339 UTC timestamp, `sarafan.ui` resource identity, and typed allowlisted attributes. Keep console output single-line readable text, never raw JSON or a code-only record.
- Treat `SARAFAN_UI_LOGGING_ENABLED=true|false` as the authoritative runtime master switch. Missing/invalid values disable logging. The value must come from the startup-generated `runtime-config.js`, load before the application bundle, use `Cache-Control: no-store`, and require at most a same-image container restart—never a bundle/image rebuild.
- Keep W3C `traceparent` generation and propagation independent of the logging switch. One logical API operation retains its 32-hex trace ID across refresh/retry and uses a new 16-hex span ID for each network attempt. Prefer the validated RFC 9457 server `traceId` when reporting a Core failure.
- Log API failures only after retry/refresh policy finishes, using method, a catalogue-approved route template, status, stable problem identity, correlation IDs, and retry count. Never log raw URLs/query strings, headers, bodies, tokens/cookies/codes, personal data, DOM/storage/history/device data, localized Problem Details text, arbitrary rejected values, Error messages/stacks, or `ProblemError.cause`.
- Normalize and mark handled failures at their ownership boundary so the API client, session store, Vue handler, `window.error`, and `unhandledrejection` cannot report the same failure repeatedly. Intentional suppression must use a stable operation code.
- Keep the logger and every sink non-throwing. Apply bounded rate limiting to repeated global failures and emit only an aggregate dropped count without retaining payloads.
- Production logging defaults to Warning and Development may use Debug, both beneath the runtime master switch. Thresholds and switches must never bypass sanitization or change the allowed fields.
- Extend tests for record shape/readability, catalogue enforcement, redaction, runtime control, W3C generation/retry propagation, RFC 9457 correlation, deduplication, rate limiting, global boundaries, and sink failure. Preserve at least 95% coverage for new and modified code.

## Shared infrastructure and UI behavior

- Use @sara-fan/ui-shared for problem parsing, HTTP transport, tracing and privacy-safe diagnostics. Keep identity state, runtime configuration, route allowlists, fixed event catalogues and domain-specific problems in this application.
- Declare route access through `meta.access`: public and limited legal/consent routes render without waiting for session restoration, while customer routes must pass the cookie and session gates before their component mounts.
- Keep reusable controls in `src/components/ui`, name them by generic UI role, and style them with the shared `--sarafan-*` semantic tokens. Domain components may compose these controls but must not duplicate their visual states.
- Use Vue Router for application and legal/consent navigation. Route-focused component tests use `createMemoryHistory` so bookmarks and access gates are deterministic and do not mutate browser history.
- Treat `/consents`, `/consents/cookies`, `/consents/personal-data`, and `/legal/:documentRef` as stable limited-access routes. Keep consent and legal failures recoverable in place, and scope asynchronous results to the current route and customer identity.
- Every user-relevant failure has one presentation owner. Stores reject transport/server failures; no empty catches or unobserved promise rejections. Expected suppression uses the named shared policy.
- Render one shared page alert immediately below the heading. Put field errors beneath controls without shrinking inputs. Failed forms retain values; navigate only after success. Clear stale alerts on successful navigation.
- Use shared confirmation/dialog primitives and Sarafan semantic colors, explicit action labels and keyboard-accessible controls. Color is never the only indication of meaning.
- Add asynchronous rejection-path tests verifying propagation and visible presentation, preserved failed forms, retry behavior and duplicate-reporting prevention. Run lint, coverage and build before handoff.
- Pin shared-package release tarball URLs and commit lockfile integrity. Do not commit sibling file dependencies. Shared changes require packed-artifact tests in both consumers.
- Keep container shell entrypoints as LF text through `.gitattributes`; verify container startup as well as image builds when changing deployment inputs.

- Application logger adapters fix service/version identity, event catalogue, severities and catalogue validation after configurable test/runtime options; callers cannot override these invariants.

## Versioned customer consent

- Consent history contains only versioned events with a document ID and content digest. Do not add legacy record labels or fallbacks; pre-versioned records are deleted by the Core consent migration, and existing customers without a new receipt have missing consent.

- Spec v1.17 §§4.3/4.18 and Core #19 govern the phone-first combined flow. Never show a login/register selector or send a client-selected purpose. Load authentication/customer Ops, resolve the phone in Core, and render only the returned current legal-document kinds before requesting the code. Keep the short-lived receipt and phone in memory only; requirements/version changes retain the phone but clear documents, confirmations, code and receipt before a fresh resolve/request. Authentication alone never grants personal-data processing permission.
- Validate Core `DateTimeOffset` values as calendar-valid RFC 3339 timestamps and `DateOnly` values as calendar-valid `YYYY-MM-DD`; `Date.parse` or regex shape alone is not a protocol validator. Before mutating identity state, require an unpadded non-empty access token, a valid expiry and a non-disabled Ops customer state. Reject negative enum values at response boundaries.
- Legal and consent requests use the shared transport through `consentRequest`. Their transport/protocol/5xx failures are recoverable and retain the limited session, an explicit exception to the general service-unavailability rule; authentication/refresh failures still follow identity policy. Preserve failed consent choices and their retry keys; the bodyless withdrawal request has no client-generated key.
- Treat legal-document DTOs as lifecycle-free immutable records with a required `effectiveAt`. Use Core's `document`, `serverNow` and `nextChangeAt` envelope as the authority: refresh at the next effective boundary and require renewed consent when the effective document changes. Do not infer draft, publication, cancellation, disposal or revision state in the customer client.
- Only safe canonical legal nodes are mounted. Customer and staff readers must retain identical formatting rules and show the exact saved artifact. No Markdown rendering in the browser, raw HTML mounting or external embedded resources.
- Load Core's `cookieCategories` ops catalogue before куки status and session restoration. Category values, Russian names and required flags come only from ops; do not compile client mappings or fallbacks. Keep every required category unchecked until the visitor explicitly selects it, and keep the customer application unavailable while mandatory consent is missing, refused, withdrawn, expired or stale. Browser receipts never authorize another browser. Use `куки` in Russian user-facing text while retaining English technical identifiers.
- Scope personal history and the nullable latest withdrawal request to the current identity, discard late results after logout, and keep legal/request access available during renewal. Present one action, `Прекратить использовать систему и отозвать согласие на обработку персональных данных`; disable it while the latest request is pending and enable it after processing. Explain that it records manual work and does not itself change consent, access, the account or data. Future quote/contact persistence must use the same server consent gate.
