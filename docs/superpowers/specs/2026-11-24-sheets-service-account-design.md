# Sheets as a service account — Design

**Status:** Draft · **Date:** 2026-11-24 · **Owner:** Mshindi Labs
**Builds on:** `2026-11-16-sheets-design.md`. Every invariant there applies unchanged.

## 1. Intent

`/sheets` reads and writes a spreadsheet only as a tenant's connected account: a token
comes from the `CredentialStore` through `withConnectionToken`. Some hosts own the
spreadsheet themselves. AMT (SunCulture) mirrors its warehouse receiving log into the
warehouse's own Google Sheet. For them a store, a key provider, an OAuth client and a
consent screen are pure cost, and the only store shipped is Postgres while AMT runs
MySQL.

This adds a second way to get a token: a Google Cloud service account, using the JWT
bearer grant. The handle (`SpreadsheetHandle`) does not change.

## 2. Scope

Goals:

1. `createServiceAccountTokenSource({ clientEmail, privateKey, services })` in `/core`,
   returning an `AccessTokenSource` (`clientEmail`, `getAccessToken({ forceRefresh })`).
2. `createServiceAccountSheets(source, opts)` in `/sheets`, with `open({ spreadsheetId })`.
3. `StaticTokenSource` in `/testing`.

Non-goals: domain-wide delegation (`subject`), Calendar or Gmail as a service account,
keys from KMS. Each can come later on the same `AccessTokenSource` seam.

`createSheets(google)` keeps its signature and behaviour.

## 3. Design

- `createSheets` and `createServiceAccountSheets` share one internal handle factory,
  which takes a `withToken(fn)` function. Only how a token is got differs.
- **Scopes** come from `SERVICE_SCOPES` for the requested services, without the OAuth
  base scopes (`openid`, `email`). They are requested, not granted, so there is no
  `assertServiceScopes` check.
- **Cache:** a token is reused until 60 s before its expiry. Concurrent callers,
  forced or not, share one in-flight request. A failed request is not cached.
- **401 from Sheets:** force a fresh token and retry once. A second 401 throws
  `ServiceAccountRejectedError`. There is no connection to mark revoked and no event.
- **Token request failures:**
  - 4xx from the token endpoint (`invalid_grant`, `unauthorized_client`) →
    `ServiceAccountRejectedError` (permanent).
  - 5xx or a network failure → `GoogleApiError` with reason `token_request_failed`
    (retryable).
  - A failure before any request (the key could not sign) →
    `ServiceAccountRejectedError`.
  - A custom source that throws a non-library error → `GoogleApiError`
    `token_request_failed`, so a handle still throws only `GoogleLibError`s.
- **Configuration** is checked at construction and throws `InvalidConfigError`: the
  email shape, a PEM key (escaped `\n` from env is normalised), at least one service.
  Messages never echo the key.
- **Secrets:** `redact()` now strips PEM private keys, including truncated and
  JSON-escaped ones, so a `cause` that quotes the key is scrubbed.
- **Error context:** errors from a service-account handle carry no `tenantId` or
  `connectionId`. `ServiceAccountRejectedError.clientEmail` names the account.

## 4. New invariant

**I11.** A service-account private key never appears in an error message, a `cause`, a
stack or a log line, and is never handed to a `@googleapis/*` module: only minted
access tokens reach the transport.
