---
layout: home

hero:
  name: "@mshindi-labs/google"
  text: Multi-tenant Google APIs for TypeScript
  tagline: Each tenant brings its own Google OAuth client. Tokens are envelope-encrypted at rest. Send mail through Gmail, book on Google Calendar and work with Google Sheets.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Host integration guide
      link: /guides/host-integration

features:
  - title: Per-tenant OAuth
    details: A tenant admin pastes their own OAuth client. Single-use hashed state, PKCE S256, a fixed HTTPS redirect and ID token checks guard every consent.
  - title: Envelope encryption
    details: Client secrets and refresh tokens are AES-256-GCM encrypted with per-value keys, wrapped by a KeyProvider. Static keys for development, GCP or AWS KMS in production.
  - title: Gmail, Calendar and Sheets
    details: Send mail as a connected mailbox, book and reschedule appointments idempotently, and read or append spreadsheet rows, each from its own entry point.
  - title: Postgres store, or bring your own
    details: A ready Postgres credential store with migrations, adapters for Prisma and TypeORM, and optional row-level security for tenant isolation.
  - title: Least privilege
    details: Only the scopes a service needs are requested. Wrong-account and partial-scope consents are revoked at Google, as are tenant disconnects.
  - title: Testable
    details: The /testing entry point ships an in-memory store, a fake OAuth server, capture transports and fakes for Calendar and Sheets.
---
