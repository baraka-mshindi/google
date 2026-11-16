# `@mshindi-labs/google/sheets` — Design

**Status:** Draft · **Date:** 2026-11-16 · **Owner:** Mshindi Labs
**Builds on:** `docs/SPEC.md` (core, Gmail) and `2026-11-05-calendar-design.md`. Every
invariant there (I1–I9) applies here unchanged unless this document says otherwise.

## 1. Intent

`@mshindi-labs/gsheets` (v0.1.x, separate repo) is a single-token wrapper around the
Sheets v4 API: one `GoogleSpreadSheet` class (~2,400 lines, 60+ methods, no tests) built
from a raw refresh token. It predates the multi-tenant core and does not fit it.

This work moves Sheets into `@mshindi-labs/google` as the `/sheets` subpath, redesigned
to be tenant-aware: a host app reads and writes a spreadsheet **as one of a tenant's
connected Google accounts**, using the same OAuth client, encrypted refresh token,
token manager, error base and secret-scrubbing guarantees as Gmail and Calendar.

No app depends on `gsheets` (decided by owner), so the new API is free to differ. There
is no compatibility shim; `gsheets` is deprecated on npm and its repo archived.

Typical use: an HRMS exports applicants to a tenant's shared tracking sheet, appends a
row per new hire, reads a sheet of interview panels back as objects, or formats a
report tab.

## 2. Goals, non-goals, anti-goals

### Goals

1. New subpath `@mshindi-labs/google/sheets`, built on the existing core.
2. Cover what `gsheets` could do (see §9 mapping), reorganised as
   **a spreadsheet handle with focused value methods + one atomic `batch()` call for
   structure and formatting** (approach B, decided by owner).
3. Fix the defects found in `gsheets` (§8) and prove the fixes with tests.
4. Never append the same rows twice or apply the same structural batch twice because of
   a blind retry (the Sheets analogue of I7).
5. A `FakeSheets` in-memory transport in `/testing`, so hosts can test without Google.

### Non-goals (v1)

- Compatibility with the `gsheets` API, or a forwarding release of `gsheets`.
- `gsheets`' OAuth helpers (`createOAuth2Client`, `generateAuthUrl`,
  `retrieveRefreshToken`, `createSheetsClient`). The core's OAuth flow replaces them.
- Creating, copying, sharing or deleting spreadsheet _files_ (Drive operations).
  `spreadsheets.create` may come later; it needs its own duplicate-protection story.
- The narrower `drive.file` scope (only works on files the app created or the user
  picked through the Google Picker). Possible later as an opt-in.
- Charts, pivot tables, conditional formatting, data validation and developer metadata
  as first-class builders. They stay reachable through `req.raw()`.
- Watching for changes, or caching cell data.
- App-level authorization ("may this user write to that sheet?"): host decides, as for
  Gmail and Calendar.

### Anti-goals (a failure even if it technically works)

- An access token, refresh token or client secret appearing in any thrown error, log
  or return value (I1). Google's own errors carry the bearer token; none may escape
  unsanitised.
- Untrusted text written into a sheet being executed as a formula by default
  (formula injection, e.g. an applicant named `=IMPORTXML(...)`).
- A retried append that silently duplicates rows.
- A batch that half-applies: some formatting changes landed, others did not.

## 3. Constraints

- Node ≥ 18, ESM + CJS via tsup, same tooling as the rest of the package.
- `@googleapis/sheets` is an **optional peer**, loaded with `loadPeer` like Calendar and
  Gmail; importing `/sheets` without it throws `MissingPeerDependencyError` on first use.
  Peer range: the current major (18.x) and the versions back to the oldest whose
  `sheets_v4` request shapes we use (builder confirms; mirror Calendar's
  `>=a <b` style). No `googleapis` umbrella dependency.
- Nothing from `/testing` may leak into `/sheets` or `/core` (existing exports test).

## 4. Scopes and connecting

- `SERVICE_SCOPES.sheets = ["https://www.googleapis.com/auth/spreadsheets"]`
  (read/write every spreadsheet the account can open; same scope `gsheets` used).
- A connection made for Gmail/Calendar gains Sheets through the core's existing
  incremental authorization (`connection.scopes_added`). Every handle call checks the
  scope with `assertServiceScopes(..., ["sheets"])` and throws `MissingScopeError`
  before any Google call.
- No read-only mode in v1 (`spreadsheets.readonly`). Builder may add it only if it falls
  out for free; otherwise later.

## 5. API

```ts
import { createSheets, req } from "@mshindi-labs/google/sheets";

const sheets = createSheets(google, { transport?, sleep?, random? });
const sheet = sheets.open({ tenantId, connectionId, spreadsheetId });
```

`open()` is synchronous and makes no Google call; it validates the three ids (non-empty
strings) and returns a handle. Every handle method resolves a token through the shared
token path (§6), so a handle can be kept and reused.

### 5.1 Ranges and values

- A **range** is either an A1 string that already includes the tab
  (`"'Q1 2026'!A1:C10"`) or an object `{ tab: "Q1 2026", range?: "A1:C10" }`. With the
  object form the library quotes the tab name correctly (single quotes, `'` doubled).
  `range` omitted means the whole tab.
- A **tab** reference is a title string or `{ sheetId: number }`. `sheetId: 0` is valid.
  The Values API addresses tabs by title only, so a value method given `{ sheetId }`
  first does one small metadata read (`fields: sheets.properties(sheetId,title)`) to
  get the title, then the values call. Nothing is cached across calls: a tab renamed
  between calls must still resolve correctly. Titles stay the cheap, normal path (one
  request); `batch()` uses ids natively and needs no lookup for `{ sheetId }`. If the
  tab is renamed between the lookup and an `append`, Google answers 400 (a definite
  failure, not an I10 ambiguous one) and the call throws `SheetTabNotFoundError`. No
  `*ByDataFilter` endpoints in v1. (My call.)
- **Cell values in:** `string | number | boolean | null | { formula: string }`.
  `null` clears the cell. `{ formula }` (must start with `=`) is the **only** way a cell
  becomes a formula under the default `raw` mode (decided by owner). This lets one row
  mix a formula (`=HYPERLINK(...)` to an HRMS profile) with untrusted text that stays
  literal. Encoding is the builder's call, but it must hold exactly: plain strings are
  stored as the identical text (no number/date/formula parsing, no visible changes),
  numbers and booleans as typed values, `{ formula }` as a formula. One working
  encoding: send `RAW` when the call has no formula cells; otherwise send
  `USER_ENTERED` with every plain string prefixed by `'` (Sheets stores it as text and
  drops the apostrophe). Tests must prove `=1+1`, `+254…`, `-5`, `1/2`, `5%`, `TRUE`,
  `'quoted` and the empty string all round-trip unchanged next to a formula cell.
  `FakeSheets` only models Google's parsing, so the guide includes an opt-in script the
  owner runs once against a real spreadsheet to confirm the encoding.
- **Cell values out:** `valueRender` option `"formatted"` (default — what the user sees,
  strings), `"unformatted"` (numbers/booleans as JS values), or `"formula"`. Empty
  trailing cells are absent, as Google returns them; `getRows` pads (§5.2).
- **Write input mode:** `input: "raw" | "user_entered"`, **default `"raw"`**. `raw`
  stores text exactly as given, so `=SUM(A1)` is the literal string. `user_entered`
  parses like typing into the UI (formulas, dates, `%`), for hosts writing their own
  trusted strings. This flips the `gsheets` default (`USER_ENTERED`) on purpose — see
  anti-goals. `{ formula }` cells work in both modes. (My call.)

### 5.2 Handle methods

| Method                                                  | What it does                                                                                                                                                                                                                                  | Retry class        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `getInfo()`                                             | Title, locale, time zone; every tab's `sheetId`, title, index, hidden, row/column count, frozen rows/columns; named ranges; protected ranges. No cell data.                                                                                   | read               |
| `getValues(range, { valueRender? })`                    | `CellValue[][]` for one range.                                                                                                                                                                                                                | read               |
| `getValuesBatch(ranges, { valueRender? })`              | One request, results in input order.                                                                                                                                                                                                          | read               |
| `getRows(tab, { headerRow = 1, range?, valueRender? })` | Rows under the header as objects keyed by header text, each with `rowNumber` (1-based sheet row). Short rows padded with `null`; blank header cells keyed `column_<letter>`; duplicate headers suffixed `_2`, `_3`. Fully empty rows skipped. | read               |
| `findRows(tab, { column, where, headerRow? })`          | Reads the tab once; returns `{ rowNumber, values }[]` where `where(cellValue, row)` is true. `column` is a letter or a header name.                                                                                                           | read               |
| `update(range, values, { input? })`                     | Writes a block.                                                                                                                                                                                                                               | idempotent write   |
| `updateBatch(entries, { input? })`                      | Several ranges in one request.                                                                                                                                                                                                                | idempotent write   |
| `clear(range \| ranges[])`                              | Clears values (not formatting).                                                                                                                                                                                                               | idempotent write   |
| `append(tab, rows, { input?, insert = "insert_rows" })` | Adds rows after the last row of the table that starts in column A. Returns `{ range, firstRow, lastRow }`.                                                                                                                                    | **non-idempotent** |
| `batch(requests)`                                       | Applies structure/format requests atomically in one `spreadsheets.batchUpdate`. Returns one reply per request (e.g. the new `sheetId` for `addTab`).                                                                                          | **non-idempotent** |

All methods throw `GoogleLibError` subclasses (§7); none return `{ success, problem }`.

### 5.3 Request builders (`req`)

Pure functions returning an opaque `SheetsRequest`; nothing is sent until `batch()`.
Tabs are referenced by title or `{ sheetId }`; `batch()` resolves titles with **at most
one** metadata read per call (none if every reference is a `sheetId`).

- Tabs: `addTab(title, { index?, rows?, columns?, sheetId? })`, `deleteTab`,
  `renameTab`, `duplicateTab(tab, newTitle, { index? })`, `moveTab(tab, index)`,
  `hideTab`, `showTab`.
- Rows/columns: `insertRows(tab, at, count)`, `insertColumns`, `deleteRows(tab, from,
count)`, `deleteColumns`, `setColumnWidth(tab, columns, px)`,
  `setRowHeight(tab, rows, px)`, `autoResizeColumns(tab, columns)`,
  `freeze(tab, { rows?, columns? })`.
- Cells: `merge(tab, a1, type?)`, `unmerge(tab, a1)`, `format(tab, a1, cellFormat,
fields?)`, `copyPaste(from, to, pasteType?)`, `sort(tab, a1, specs)`.
- Filters and names: `setBasicFilter(tab, a1)`, `clearBasicFilter(tab)`,
  `addNamedRange(name, tab, a1)`, `deleteNamedRange(nameOrId)`,
  `protect(tab, { a1?, description?, warningOnly?, editors? })`,
  `unprotect(protectedRangeId)`.
- Escape hatch: `req.raw(request: sheets_v4.Schema$Request)` passes a Google request
  through untouched (charts, conditional formats, validation…).

Row/column positions in builders are **1-based and inclusive** like the Sheets UI and
A1 notation (`deleteRows("Log", 5, 2)` deletes rows 5–6); the library converts to the
API's 0-based half-open grid ranges. Columns accept a letter range (`"B:D"`) or 1-based
numbers.

A tab added in a batch can be referenced by title later in the same batch: if
`addTab` has no `sheetId`, the library assigns one that is unused in the spreadsheet
before sending. (Builder: confirm Google accepts a caller-chosen id; the
`AddSheetRequest` properties allow it.)

### 5.4 A1 utilities (exported)

`a1.quoteTab(title)`, `a1.range(tab, range?)`, `a1.columnToIndex("AA") → 27`,
`a1.indexToColumn(27) → "AA"`, `a1.parse("B2:D")` → 1-based bounds. Used internally
and handy for hosts building ranges.

## 6. Transport, tokens and retries

- `SheetsTransport` interface (like `CalendarTransport`) with one method per Google call
  used: `getSpreadsheet` (with a `fields` mask so cell data is never fetched by
  `getInfo`), `valuesGet`, `valuesBatchGet`, `valuesUpdate`, `valuesBatchUpdate`,
  `valuesAppend`, `valuesClear`, `valuesBatchClear`, `batchUpdate`. Each takes
  `accessToken`. `createSheetsApiTransport()` implements it over `@googleapis/sheets`.
- Token path identical to Calendar's `withToken`: get token → check scope → call → on
  401 force-refresh once and retry → second 401 marks the connection `revoked`, emits
  `connection.revoked`, throws `ConnectionRevokedError` → touch connection on success.
  A 401 means Google did not apply the request, so the one 401 retry is safe even for
  non-idempotent calls. **Builder's call:** extract this into a shared internal core
  helper used by both Calendar and Sheets _if_ Calendar's tests pass unchanged;
  otherwise keep a Sheets-local copy.
- Retry classes:
  - **read / idempotent write:** retry 429, rate-limit 403s, 5xx and network errors
    with jittered backoff (Calendar's policy).
  - **non-idempotent (`append`, `batch`)** — new invariant **I10**: retried only when
    Google answered 429 / rate-limit 403, or the failure provably happened before the
    request reached Google (DNS failure, connection refused — Gmail's pre-send set).
    Any other ambiguous failure (timeout, reset, 5xx) throws
    `SheetsWriteOutcomeUnknownError`; the host decides whether to re-check and retry.
- Errors from the transport are thrown raw and classified by the retry wrapper, so only
  sanitised `GoogleLibError`s leave the library (same rule as Calendar).

**Testing:** `FakeSheets` in `/testing` implements `SheetsTransport` over an in-memory
spreadsheet (tabs, grid values, named and protected ranges, sheet properties). It
supports every values call and the batch requests the builders produce that change
structure (add/delete/rename/duplicate/move/hide tab, insert/delete rows and columns,
named ranges, protection); purely visual requests (widths, formats, merges, filters,
sort) are recorded and validated for shape, not rendered. It applies `RAW` vs
`USER_ENTERED` the way Google does for the cases the §5.1 round-trip tests cover
(leading `'` → literal text, `=` → stored formula, numeric/boolean/percent/date-like
text parsed under `USER_ENTERED`), so those tests mean something. It records calls and can
inject failures (`failNext(op, error, { afterApply })`), like `FakeCalendar`.

## 7. Errors and events

New `GoogleLibError` subclasses (exported from `/core`, like Calendar's):

| Class                            | `code`                         | When                                                                                                                                             |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SpreadsheetNotFoundError`       | `spreadsheet_not_found`        | 404 on the spreadsheet id.                                                                                                                       |
| `SpreadsheetAccessDeniedError`   | `spreadsheet_access_denied`    | 403 that is not a rate limit (the account cannot open/edit it).                                                                                  |
| `SheetTabNotFoundError`          | `sheet_tab_not_found`          | A tab title or `sheetId` is not in the spreadsheet (checked locally when resolving, or from Google's "Unable to parse range" for a missing tab). |
| `InvalidSheetsInputError`        | `invalid_sheets_input`         | Bad ids, ranges, values, builder args — thrown before any token fetch. Carries `field`.                                                          |
| `SheetsWriteOutcomeUnknownError` | `sheets_write_outcome_unknown` | I10 ambiguous failure on `append`/`batch`.                                                                                                       |

Other 400s surface as `GoogleApiError(400, reason)`; rate limits as `RateLimitedError`.

**Events:** none new. Sheets calls are data access, not credential changes; emitting
an event per read or write would flood the audit stream. Connection events
(`connection.revoked`) still fire through the shared token path. (My call.)

## 8. Defects in `gsheets` that the tests must cover

1. `findRowsMatchingCriteria` reads `A:A` without the tab, so it always searched the
   first tab.
2. `getDataRange` rejects `sheetId: 0` (falsy check), the id of the default first tab.
3. Tab titles are interpolated unquoted into A1 ranges; titles with spaces, `'`, `!` or
   that look like cell refs (`A1`, `2026`) break or hit the wrong range.
4. Every format/structure method fetches full spreadsheet metadata first to map title →
   id (two requests per change, no atomicity across changes).
5. `USER_ENTERED` default allows formula injection from untrusted input.
6. Errors are returned as strings built from Google's error message (no typing, no
   guaranteed scrubbing).
7. Values typed `string[][]` only; numbers/booleans/clearing not expressible.

Builder: while porting, check the remaining methods for similar issues and add any
found here.

## 9. `gsheets` → `/sheets` mapping

| `gsheets`                                                                                                                                                                                                                                                                                                                                                                             | `/sheets`                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `getMetadata`, `getTabs`, `getSheetByName`, `listNamedRanges`, protected ranges                                                                                                                                                                                                                                                                                                       | `getInfo()`                                                        |
| `getDataRange`, `getRow`, `getValuesBySheetTitle`, `getColumnValues`, `getLastRowWithData`                                                                                                                                                                                                                                                                                            | `getValues()` (last row = `getValues({ tab }).length`)             |
| `batchGetRanges`                                                                                                                                                                                                                                                                                                                                                                      | `getValuesBatch()`                                                 |
| `getHeaderRow`, `getDataAsObjects`                                                                                                                                                                                                                                                                                                                                                    | `getRows()` (headers: `getValues({ tab, range: "1:1" })`)          |
| `findRowsMatchingCriteria`, `findEntryRowByColumValue`                                                                                                                                                                                                                                                                                                                                | `findRows()`                                                       |
| `updateRange`, `updateCell`                                                                                                                                                                                                                                                                                                                                                           | `update()`                                                         |
| `batchUpdateRanges`                                                                                                                                                                                                                                                                                                                                                                   | `updateBatch()`                                                    |
| `clearRange`, `batchClearRanges`                                                                                                                                                                                                                                                                                                                                                      | `clear()`                                                          |
| `appendData`                                                                                                                                                                                                                                                                                                                                                                          | `append()`                                                         |
| `addSheet`, `deleteSheet`, `renameSheet`, `duplicateSheet`, `moveSheet`, `hideSheet`, `showSheet`, `insertRows/Columns`, `deleteRows/Columns`, `setColumnWidth`, `setRowHeight`, `autoResizeColumns`, `freezeRowsAndColumns`, `mergeCells`, `setCellFormat`, `copyPasteRange`, `sortRange`, `setBasicFilter`, `clearBasicFilter`, `addNamedRange`, `deleteNamedRange`, `protectSheet` | `batch([req.*])`                                                   |
| `_document()` (raw client)                                                                                                                                                                                                                                                                                                                                                            | none — `req.raw()` covers one-off requests without exposing tokens |
| OAuth helpers, `createSheetsClient`                                                                                                                                                                                                                                                                                                                                                   | core `createGoogle` + `sheets.open()`                              |

## 10. Docs and release

- `docs/guides/sheets.md`: connecting (adding the scope to an existing connection),
  opening a handle, reading rows as objects, appending safely (I10, what to do on
  `SheetsWriteOutcomeUnknownError`), `raw` vs `user_entered`, batching, testing with
  `FakeSheets`, and a short "coming from gsheets" table (§9).
- `docs/SPEC.md`: layout (`/sheets` no longer "later"), dependency table, I10, drop the
  forwarding-release paragraph in favour of deprecation.
- README: add the subpath.
- Release: `feat(sheets): …` commits → release-please minor bump (1.3.0).
- `gsheets` retirement (owner runs; outward-facing): after 1.3.0 is on npm,
  `npm deprecate @mshindi-labs/gsheets "Moved to @mshindi-labs/google/sheets"`, add a
  README pointer in the `gsheets` repo, archive the repo.

## 11. Decided vs. left to the builder

**Decided by owner:** tenant-aware redesign with no compatibility shim; approach B
(handle + atomic batch); explicit `{ formula }` cells, with plain strings always
literal under the default mode.

**My calls (owner may override):** `raw` as the default write mode; no new audit
events; `spreadsheets` scope only; no `spreadsheets.create` in v1; 1-based inclusive
positions in builders; I10 retry rule for `append`/`batch`; deprecate rather than
forward `gsheets`; value methods given `{ sheetId }` look up the title once per call,
uncached (§5.1).

**Left to the builder:** exact TypeScript type names; peer version range; whether the
token path is shared with Calendar (§6); `FakeSheets` internals; how `getRows`
handles rows wider than the header (keep extra cells under `column_<letter>` unless a
cleaner rule emerges); file split inside `src/sheets/`.
