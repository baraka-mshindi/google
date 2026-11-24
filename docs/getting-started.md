# Getting started

`@mshindi-labs/google` is one npm package with six entry points. There is no root import: load
the entry point you need.

## Entry points

| Import                          | Use it for                                                  | Main exports                                                                                                                        | Optional peers it loads                                                      |
| ------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `@mshindi-labs/google/core`     | OAuth clients, connections, token storage and key providers | `createGoogle`, `StaticKeyProvider`, `GcpKmsKeyProvider`, `AwsKmsKeyProvider`, `rewrapAll`, `verifyAll`, `scopesFor`, error classes | `@google-cloud/kms` or `@aws-sdk/client-kms`, only for the KMS key providers |
| `@mshindi-labs/google/gmail`    | Sending mail as a connected mailbox                         | `createGmail`, `createGmailApiTransport`, `MAX_ATTACHMENT_BYTES`                                                                    | `@googleapis/gmail`, `nodemailer`, `html-to-text`                            |
| `@mshindi-labs/google/calendar` | Booking, rescheduling and cancelling events; free/busy      | `createCalendar`, `createCalendarApiTransport`, `findCommonSlots`                                                                   | `@googleapis/calendar`                                                       |
| `@mshindi-labs/google/sheets`   | Reading and appending rows, batch formatting                | `createSheets`, `createSheetsApiTransport`, `req`, `a1`                                                                             | `@googleapis/sheets`                                                         |
| `@mshindi-labs/google/postgres` | A Postgres credential store and its migrations              | `createPostgresStore`, `getMigrations`, `fromPrisma`, `fromTypeOrm`                                                                 | none (pass your own query function)                                          |
| `@mshindi-labs/google/testing`  | Tests for code that uses the library                        | `InMemoryStore`, `LocalKeyProvider`, `FakeGoogleOAuth`, `CaptureTransport`, `FakeCalendar`, `FakeSheets`, `runStoreContractTests`   | `mailparser`, for `CaptureTransport`                                         |

Optional peers are loaded on first use. A missing one throws `MissingPeerDependencyError` with
the `npm i` command to run.

## Installation

```sh
npm i @mshindi-labs/google @googleapis/gmail nodemailer html-to-text
npm i @mshindi-labs/google @googleapis/sheets@^14   # Sheets, on Node 18 / 20
```

Node 18 or newer. ESM and CommonJS are both supported.

## Quick start

```ts
import { Pool } from "pg";
import { createGoogle, StaticKeyProvider } from "@mshindi-labs/google/core";
import { createGmail } from "@mshindi-labs/google/gmail";
import { createPostgresStore } from "@mshindi-labs/google/postgres";

const pool = new Pool(); // run getMigrations() from /postgres once
const google = createGoogle({
  store: createPostgresStore({ query: (sql, p) => pool.query(sql, p) }),
  keyProvider: new StaticKeyProvider({
    keys: { v1: Buffer.from(process.env.GOOGLE_KEK!, "base64") }, // 32 bytes
    current: "v1",
  }),
  callbackUrl: "https://app.example.com/api/google/callback",
});

// 1. The tenant admin pastes their OAuth client ID and secret.
await google.clients.configure({ tenantId, actorId, clientId, clientSecret });

// 2. Send them to Google's consent screen; handle the redirect back.
const { url } = await google.oauth.createAuthUrl({
  tenantId,
  actorId,
  services: ["gmail"],
  intendedEmail: "support@example.com",
});
const { connection } = await google.oauth.handleCallback({
  code,
  state,
  error,
});

// 3. Send mail as that mailbox.
const gmail = createGmail(google);
await gmail.send({
  tenantId,
  actorId,
  connectionId: connection.id,
  to: ["jane@customer.example"],
  subject: "Your order has shipped",
  html: "<p>Hello</p>",
});
```

## Errors

Every library error extends `GoogleLibError` and carries a stable `code` (for example
`connection_revoked`). Match errors on `err.code`, not `instanceof`: if your app loads the ESM
build of one entry point and the CommonJS build of another, each build has its own error classes
and `instanceof` can be false for a genuine library error.

## Security model

- **Envelope encryption.** Client secrets and refresh tokens are AES-256-GCM encrypted with
  per-value keys, wrapped by a `KeyProvider` (KMS in production). The key encryption key never
  lives in the database.
- **Bound ciphertext.** Each value's tenant, record and field are authenticated data, so a
  ciphertext copied to another tenant or column fails to decrypt.
- **Hardened OAuth.** Single-use hashed `state` bound to tenant and actor, PKCE S256, a fixed
  HTTPS redirect URI, and ID token checks (audience, verified email, hosted domain, intended
  account).
- **Least privilege.** Only `openid email`, `gmail.send` and, for Calendar,
  `calendar.events.owned` and `calendar.events.freebusy`. Tokens are revoked at Google on a
  wrong-account or partial-scope consent, and when a tenant disconnects.
- **No secrets in output.** Errors, events and logs are redacted; events never carry bodies,
  tokens or secrets, and recipients can be hashed (`redactRecipients`).

## Next steps

- [Tenant setup](./guides/tenant-setup.md) for the tenant admin creating the Google OAuth client.
- [Host integration](./guides/host-integration.md) for wiring, routes, error messages and key providers.
- The [design spec](./spec.md) for invariants, flows and the threat model.
