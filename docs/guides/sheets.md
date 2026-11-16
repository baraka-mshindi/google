# Working with Google Sheets

How to read, append to and format a tenant's spreadsheets as one of its connected Google
accounts, using `@mshindi-labs/google/sheets`. The examples follow an HRMS flow (export
applicants to a tracking sheet, read a sheet of interview panels back as objects);
adapt the names to your application.

The handle reads and writes **cell data and structure** of one spreadsheet. It does not
create, copy, share or delete spreadsheet files, and it does not decide who in your app
may touch which sheet. That check is yours, as for Gmail and Calendar.

## 1. Set up

**Install the peer.** `@googleapis/sheets` is an optional peer, loaded on first use. The
supported range is `>=12.0.0 <19.0.0`. v17 and newer need Node 22, so on Node 18 or 20
install v14:

```sh
npm i @googleapis/sheets@^14   # Node 18 / 20
npm i @googleapis/sheets       # Node 22+
```

**Tenant admin.** In the Google Cloud project, enable the **Google Sheets API** (see
[tenant-setup](./tenant-setup.md), step 2). The library asks for one scope,
`https://www.googleapis.com/auth/spreadsheets`, which reads and writes every spreadsheet
the connected account can open.

**Connect or reconnect the account.** Add `"sheets"` to `services`. An account that is
already connected for Gmail or Calendar consents again to add the scope. Pass the
existing `connectionId` so the scope is added to that connection instead of creating a
second one:

```ts
const { url } = await google.oauth.createAuthUrl({
  tenantId,
  actorId,
  services: ["gmail", "calendar", "sheets"],
  intendedEmail: "careers@example.com",
  connectionId, // add scopes to the existing connection
});
```

Until the connection has the Sheets scope, every handle call throws `missing_scope`
before any request goes to Google.

**Create the service.**

```ts
import { createSheets } from "@mshindi-labs/google/sheets";

const sheets = createSheets(google);
```

## 2. Open a handle

```ts
const sheet = sheets.open({
  tenantId,
  connectionId,
  spreadsheetId: "1AbC...",
});
```

`open()` is synchronous and makes no Google call. It only checks that the three ids are
non-empty strings. Every method on the handle fetches a token on its own, so you can
keep a handle and reuse it.

The spreadsheet id is the long string in the sheet's URL:
`https://docs.google.com/spreadsheets/d/<spreadsheetId>/edit`.

### Ranges and tabs

A range is an A1 string that already includes the tab, or an object. With the object
form the library quotes the tab title for you (single quotes, `'` doubled), so titles
with spaces, quotes, `!`, or names that look like a cell (`A1`, `2026`) work:

```ts
import type { RangeRef } from "@mshindi-labs/google/sheets";

const quoted: RangeRef = "'Q1 2026'!A1:C10"; // string form: you quote
const block: RangeRef = { tab: "Q1 2026", range: "A1:C10" }; // the library quotes
const whole: RangeRef = { tab: "Q1 2026" }; // the whole tab
```

A tab is a title or `{ sheetId: number }`. `sheetId: 0` is valid (it is the default
first tab). The Values API only knows titles, so value methods given a `{ sheetId }`
spend **one extra small read** to look the title up, every call, uncached. A tab
renamed between calls still resolves. Titles are the cheap path, and `batch()` uses
ids directly with no lookup.

The `a1` helpers build and take apart ranges if you need them:

```ts
import { a1 } from "@mshindi-labs/google/sheets";

a1.quoteTab("Bob's tab"); // 'Bob''s tab'
a1.range("Q1 2026", "A1:C10"); // 'Q1 2026'!A1:C10
a1.columnToIndex("AA"); // 27
a1.indexToColumn(27); // "AA"
a1.split("'Q1 2026'!A1:C10"); // { tab: "Q1 2026", range: "A1:C10" }
a1.parse("B2:D"); // { startRow: 2, endRow: null, startColumn: 2, endColumn: 4 }
```

### What is in the spreadsheet

```ts
const info = await sheet.getInfo();

for (const tab of info.tabs) {
  console.log(tab.sheetId, tab.title, tab.rowCount, tab.hidden);
}
```

`getInfo()` returns the title, locale, time zone, every tab (`sheetId`, `title`,
`index`, `hidden`, `rowCount`, `columnCount`, `frozenRows`, `frozenColumns`), named
ranges and protected ranges. It never fetches cell data.

## 3. Read

### Values

```ts
const grid = await sheet.getValues({ tab: "Applicants", range: "A1:D20" });
// grid: CellValue[][]   (string | number | boolean)
```

`valueRender` picks what comes back:

- `"formatted"` (default): what the user sees, as strings.
- `"unformatted"`: numbers and booleans as JavaScript values.
- `"formula"`: the formula text for formula cells.

```ts
const raw = await sheet.getValues("Applicants!E2:E50", {
  valueRender: "unformatted",
});
```

Google leaves out empty trailing cells and rows, so inner arrays can be shorter than the
range. `getValuesBatch(ranges, opts)` reads several ranges in one request and returns the
results in input order.

The last used row of a tab is `(await sheet.getValues({ tab })).length`.

### Rows as objects

```ts
const panels = await sheet.getRows("Interview panels");

for (const { rowNumber, data } of panels) {
  console.log(rowNumber, data["Panelist"], data["Email"]);
}
```

`getRows(tab, { headerRow = 1, columns?, valueRender? })` treats the header row as keys.
Each result has `rowNumber` (the 1-based sheet row, handy for a later `update`) and
`data`.

- Short rows are padded with `null`.
- A blank header cell becomes `column_<letter>` (for example `column_C`).
- Duplicate headers are suffixed `_2`, `_3`.
- Fully empty rows are skipped.
- Cells to the right of the last header keep their data under `column_<letter>`.
- Every row object has the same keys: the header keys plus a `column_<letter>` for
  each column any row has beyond the header.

Pass `columns` such as `"B:F"` to read only part of the tab, and `headerRow` when the
headers are not on row 1.

### Find rows

```ts
const hits = await sheet.findRows("Applicants", {
  column: { header: "Email" }, // or a letter: "C"
  where: (value) => String(value).toLowerCase() === "jane@applicant.com",
});

for (const { rowNumber, values } of hits) {
  console.log(rowNumber, values);
}
```

`findRows` reads the tab once and filters in your process. `where(cellValue, row)`
returns true for rows to keep. It always searches the tab you name, never the first
tab. For a very large tab, read the one column with `getValues` and look there instead.

## 4. Write

### `update`

```ts
await sheet.update({ tab: "Applicants", range: "A2" }, [
  ["Jane Doe", "jane@applicant.com", 42, true, null],
]);
```

Cell values are `string | number | boolean | null | { formula: string }`. `null`
clears the cell. `updateBatch([{ range, values }, ...])` writes several blocks in one
request. `clear(range | ranges[])` clears values and leaves formatting alone.

### Plain text stays text: `raw` vs `user_entered`

`input` is `"raw"` by default. Under `raw`, a string is stored as exactly that text. No
number, date or formula parsing happens, so an applicant who types `=IMPORTXML(...)` as
their name gets a cell that **shows** that text and runs nothing. `+254712345678`, `-5`,
`1/2`, `5%`, `TRUE` and a leading `'` all stay as written.

Pass `{ input: "user_entered" }` only for strings you trust and want parsed as if typed
into the Sheets UI (dates, percentages, formulas):

```ts
await sheet.update("Report!A1", [["2026-12-01", "50%"]], {
  input: "user_entered",
});
```

This is the opposite default of the old `gsheets` package, on purpose.

### Formulas: `{ formula }`

`{ formula: "=..." }` is the **only** way a cell becomes a formula in the default mode.
The string must start with `=`. One row can mix a formula with untrusted text that stays
literal:

```ts
await sheet.update({ tab: "Applicants", range: "A2" }, [
  [
    applicant.name, // literal, even if it starts with "="
    {
      formula: `=HYPERLINK("https://hrms.example.com/people/${applicant.id}", "Profile")`,
    },
  ],
]);
```

Build the formula text from your own values only. Quote or escape anything that came
from a user before putting it inside a formula string, the same as you would for SQL.

## 5. Appending safely

```ts
const { range, firstRow, lastRow } = await sheet.append("Applicants", [
  [applicant.name, applicant.email, applicant.appliedAt],
]);
```

`append` adds rows after the last row of the table that starts in column A and returns
where they landed. With `{ insert: "insert_rows" }` (the default) it inserts new rows;
`"overwrite"` writes into the empty rows below the table.

An append is **not idempotent**: sending it twice adds the rows twice. So `append` and `batch` are retried only when Google answered 429 / rate-limit 403, or the failure provably happened before the request reached Google (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, `ERR_TLS_*`, `CERT_*`); any other ambiguous failure throws `SheetsWriteOutcomeUnknownError` after exactly one Google call. The library never
guesses whether the rows landed. You decide, after looking:

```ts
import { SheetsWriteOutcomeUnknownError } from "@mshindi-labs/google/core";

async function appendApplicant(email: string, row: string[]) {
  try {
    await sheet.append("Applicants", [row]);
  } catch (err) {
    if (!(err instanceof SheetsWriteOutcomeUnknownError)) throw err;

    // The outcome is unknown. Read the tail before trying again.
    const column = await sheet.getValues({ tab: "Applicants", range: "B:B" });
    const tail = column.slice(-20).flat();
    if (!tail.includes(email)) {
      await sheet.append("Applicants", [row]); // it did not land
    }
  }
}
```

Look for something that identifies the row (an id or email column), not for "one more
row than before": another writer may have added rows too. A loop that retries forever on
this error will eventually duplicate rows, so retry once and surface a failure after
that.

(`instanceof` works when the app loads one build of the package. To match across ESM and
CJS builds, check `err.code === "sheets_write_outcome_unknown"`; see the README.)

Reads and idempotent writes (`getValues`, `update`, `updateBatch`, `clear`) retry on
429, rate-limit 403, 5xx and network errors with jittered backoff.

## 6. Batch: structure and formatting, all or nothing

`batch(requests)` sends several changes in **one** `spreadsheets.batchUpdate`. Google
applies it atomically: either every change lands or none does. Builders in `req` make
the requests; nothing is sent until `batch()`.

```ts
import { req } from "@mshindi-labs/google/sheets";

const replies = await sheet.batch([
  req.addTab("Q1 2026", { rows: 500, columns: 12 }),
  req.freeze("Q1 2026", { rows: 1 }),
  req.setColumnWidth("Q1 2026", "A:A", 240),
  req.format(
    "Q1 2026",
    "A1:L1",
    { textFormat: { bold: true } },
    "userEnteredFormat.textFormat",
  ),
  req.deleteRows("Log", 5, 2), // rows 5 and 6
]);
```

Things to know:

- **Positions are 1-based and inclusive**, like the Sheets UI and A1 notation.
  `deleteRows("Log", 5, 2)` deletes rows 5 and 6 (start at row 5, count 2). The library
  converts to Google's 0-based grid ranges.
- **Column arguments.** `setColumnWidth` and `autoResizeColumns` take a letter range
  `"B:D"` or a 1-based inclusive pair `[2, 4]`. `insertColumns` and `deleteColumns` take
  one starting column (`"C"` or `3`) plus a count:

```ts
req.setColumnWidth("Q1 2026", "B:D", 120); // or [2, 4]
req.insertColumns("Q1 2026", "C", 2); // two columns before column C (or 3)
req.deleteColumns("Q1 2026", 3, 1); // delete column C
```

- **A tab added in the batch can be used later in the same batch** by its title, as
  `"Q1 2026"` is above. If `addTab` has no `sheetId`, the library picks an unused one.
- Tabs are resolved by title with **at most one** metadata read per batch, and none when
  every reference is `{ sheetId }`.
- The result has one reply per request, in order. For `addTab`, the reply carries the
  new `sheetId`:

```ts
const newSheetId = replies[0]?.addSheet?.properties?.sheetId;
```

Builders: `addTab`, `deleteTab`, `renameTab`, `duplicateTab`, `moveTab`, `hideTab`,
`showTab`, `insertRows`, `insertColumns`, `deleteRows`, `deleteColumns`,
`setColumnWidth`, `setRowHeight`, `autoResizeColumns`, `freeze`, `merge`, `unmerge`,
`format`, `copyPaste`, `sort`, `setBasicFilter`, `clearBasicFilter`, `addNamedRange`,
`deleteNamedRange`, `protect`, `unprotect`. For anything else (charts, conditional
formats, data validation) pass a Google request straight through:

```ts
await sheet.batch([
  req.raw({
    setDataValidation: {
      range: {
        sheetId: 0,
        startRowIndex: 1,
        startColumnIndex: 3,
        endColumnIndex: 4,
      },
      rule: { condition: { type: "BOOLEAN" }, showCustomUi: true },
    },
  }),
]);
```

A `batch` is not idempotent either: the rule in [section 5](#5-appending-safely)
applies. If it throws `SheetsWriteOutcomeUnknownError`, read the spreadsheet with
`getInfo()` to see whether the change landed before you resend it.

## 7. Errors

All errors extend `GoogleLibError` and carry a stable `code`. Nothing returns
`{ success, problem }`, and no error contains a token.

| Code                           | Class                            | Meaning                                                                          |
| ------------------------------ | -------------------------------- | -------------------------------------------------------------------------------- |
| `spreadsheet_not_found`        | `SpreadsheetNotFoundError`       | 404 on the spreadsheet id                                                        |
| `spreadsheet_access_denied`    | `SpreadsheetAccessDeniedError`   | 403 that is not a rate limit; the account cannot open or edit it                 |
| `sheet_tab_not_found`          | `SheetTabNotFoundError`          | A tab title or `sheetId` is not in the spreadsheet                               |
| `invalid_sheets_input`         | `InvalidSheetsInputError`        | Bad id, range, value or builder argument; `field` names it. Thrown before Google |
| `sheets_write_outcome_unknown` | `SheetsWriteOutcomeUnknownError` | `append` or `batch` failed ambiguously; check before retrying                    |
| `missing_scope`                | `MissingScopeError`              | The connection has no Sheets scope                                               |
| `connection_revoked`           | `ConnectionRevokedError`         | Google rejected the token twice; the connection is marked revoked                |
| `rate_limited`                 | `RateLimitedError`               | Still rate limited after the retries                                             |

Other 400s surface as `GoogleApiError` with status 400 and Google's reason. No new
audit events are emitted for Sheets data calls; `connection.revoked` still fires.

## 8. Testing your integration

`FakeSheets` from `@mshindi-labs/google/testing` is an in-memory Sheets transport. Pass
it to `createSheets` so tests never call Google:

```ts
import { createSheets } from "@mshindi-labs/google/sheets";
import { FakeSheets } from "@mshindi-labs/google/testing";

const fake = new FakeSheets({
  spreadsheetId: "sheet-1",
  title: "Hiring",
  tabs: [{ title: "Applicants", rows: [["Name", "Email"]] }],
});
const sheets = createSheets(google, { transport: fake });
const sheet = sheets.open({ tenantId, connectionId, spreadsheetId: "sheet-1" });

await sheet.append("Applicants", [["Jane Doe", "jane@applicant.com"]]);

expect(fake.values("Applicants")).toEqual([
  ["Name", "Email"],
  ["Jane Doe", "jane@applicant.com"],
]);
```

`google` is a `createGoogle` instance with a connected account (in tests, use
`InMemoryStore`, `LocalKeyProvider` and `FakeGoogleOAuth` from the same entry point).
`fake.values(title)` is the grid of a tab, `fake.formulaAt("Applicants", "C2")` is the
formula stored in a cell, and `fake.calls` lists every call made. To test your handling
of a lost response, make the next call fail after it was applied:

```ts
fake.failNext(
  "valuesAppend",
  Object.assign(new Error("reset"), { code: "ECONNRESET" }),
  {
    afterApply: true,
  },
);
// the next sheet.append(...) throws SheetsWriteOutcomeUnknownError,
// and the row is in fake.values("Applicants").
```

`FakeSheets` models how Google parses `RAW` and `USER_ENTERED`, and records purely
visual requests (widths, formats, merges, filters, sort) without rendering them.

## 9. Verify against a real sheet

The fake only models what we know about Google's parsing. Before you rely on "plain
strings stay literal" in production, run this once with a real connection against a
throwaway spreadsheet. It writes tricky strings next to a formula cell, reads them back
and prints anything that did not come back unchanged. It is opt-in: nothing in the
library runs it.

```ts
import { createSheets } from "@mshindi-labs/google/sheets";

export async function verifyRoundTrip(
  google: Parameters<typeof createSheets>[0],
  ids: { tenantId: string; connectionId: string; spreadsheetId: string },
) {
  const sheet = createSheets(google).open(ids);
  const tab = "RoundTripCheck"; // create this tab in the spreadsheet first

  const matrix = [
    "=1+1",
    "+254712345678",
    "-5",
    "1/2",
    "5%",
    "TRUE",
    "'quoted",
    "",
    "2026-12-01",
    "007",
  ];

  // One row: the formula first, then every string next to it.
  await sheet.update({ tab, range: "A1" }, [[{ formula: "=1+1" }, ...matrix]]);

  const [formulaRow] = await sheet.getValues(
    { tab, range: "A1" },
    { valueRender: "formula" },
  );
  const [row] = await sheet.getValues(
    { tab, range: "B1:K1" },
    { valueRender: "unformatted" },
  );

  let bad = 0;
  if (formulaRow?.[0] !== "=1+1") {
    bad++;
    console.log("formula cell was not stored as a formula:", formulaRow?.[0]);
  }
  matrix.forEach((expected, i) => {
    const got = row?.[i] ?? ""; // Google drops trailing empty cells
    if (got !== expected) {
      bad++;
      console.log(
        `changed: wrote ${JSON.stringify(expected)}, read ${JSON.stringify(got)}`,
      );
    }
  });

  console.log(
    bad === 0 ? "All values round-tripped." : `${bad} value(s) changed.`,
  );
}
```

Check the output. Read back with `unformatted`, a plain string such as `5%` must come
back as the string `5%` and not as the number `0.05`, and the formula cell, read with
`formula`, must stay a formula. If a
value changed, do not use the library to write untrusted text to that spreadsheet and
open an issue with the printed lines.

## 10. Coming from `gsheets`

`@mshindi-labs/gsheets` is deprecated and its repo archived. There is no compatibility
shim; the API is tenant-aware and typed. Rough mapping:

| `gsheets`                                                                                                                                                                                                                                                                                                                                                                             | `/sheets`                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `getMetadata`, `getTabs`, `getSheetByName`, `listNamedRanges`, protected ranges                                                                                                                                                                                                                                                                                                       | `getInfo()`                                                       |
| `getDataRange`, `getRow`, `getValuesBySheetTitle`, `getColumnValues`, `getLastRowWithData`                                                                                                                                                                                                                                                                                            | `getValues()` (last row = `getValues({ tab }).length`)            |
| `batchGetRanges`                                                                                                                                                                                                                                                                                                                                                                      | `getValuesBatch()`                                                |
| `getHeaderRow`, `getDataAsObjects`                                                                                                                                                                                                                                                                                                                                                    | `getRows()` (headers: `getValues({ tab, range: "1:1" })`)         |
| `findRowsMatchingCriteria`, `findEntryRowByColumValue`                                                                                                                                                                                                                                                                                                                                | `findRows()`                                                      |
| `updateRange`, `updateCell`                                                                                                                                                                                                                                                                                                                                                           | `update()`                                                        |
| `batchUpdateRanges`                                                                                                                                                                                                                                                                                                                                                                   | `updateBatch()`                                                   |
| `clearRange`, `batchClearRanges`                                                                                                                                                                                                                                                                                                                                                      | `clear()`                                                         |
| `appendData`                                                                                                                                                                                                                                                                                                                                                                          | `append()`                                                        |
| `addSheet`, `deleteSheet`, `renameSheet`, `duplicateSheet`, `moveSheet`, `hideSheet`, `showSheet`, `insertRows/Columns`, `deleteRows/Columns`, `setColumnWidth`, `setRowHeight`, `autoResizeColumns`, `freezeRowsAndColumns`, `mergeCells`, `setCellFormat`, `copyPasteRange`, `sortRange`, `setBasicFilter`, `clearBasicFilter`, `addNamedRange`, `deleteNamedRange`, `protectSheet` | `batch([req.*])`                                                  |
| `_document()` (raw client)                                                                                                                                                                                                                                                                                                                                                            | none; `req.raw()` covers one-off requests without exposing tokens |
| OAuth helpers, `createSheetsClient`                                                                                                                                                                                                                                                                                                                                                   | core `createGoogle` + `sheets.open()`                             |

Behaviour that changed on purpose:

- Writes default to `raw`, not `USER_ENTERED`. Formulas need `{ formula }`.
- Values may be numbers, booleans, `null` and formulas, not only strings.
- Tab titles are quoted for you, and `sheetId: 0` works.
- `findRows` searches the tab you pass, not always the first tab.
- Structure and format changes go through one atomic `batch()` with no per-change
  metadata fetch.
- Errors are typed `GoogleLibError`s with scrubbed messages, not strings.
