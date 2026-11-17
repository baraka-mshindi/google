// Type-checks the TypeScript samples in docs/guides/sheets.md (`npm run typecheck`
// covers test/). Never run: vitest collects only *.test.ts. Keep each function in
// step with the guide section named above it. Imports are relative so this checks
// against src/ (the package-name subpaths resolve to dist/, which may be stale).
import { expect } from "vitest";
import type { GoogleCore } from "../../src/core/create-google.js";
import { SheetsWriteOutcomeUnknownError } from "../../src/core/errors.js";
import { a1, createSheets, req } from "../../src/sheets/index.js";
import type { RangeRef, SpreadsheetHandle } from "../../src/sheets/index.js";
import { FakeSheets, sheetsHttpError } from "../../src/testing/index.js";

declare const google: GoogleCore;
declare const tenantId: string;
declare const actorId: string;
declare const connectionId: string;
declare const sheet: SpreadsheetHandle;
declare const applicant: {
  id: string;
  name: string;
  email: string;
  appliedAt: string;
};

// §1 Set up
export async function setUp() {
  const { url } = await google.oauth.createAuthUrl({
    tenantId,
    actorId,
    services: ["gmail", "calendar", "sheets"],
    intendedEmail: "careers@example.com",
    connectionId, // add scopes to the existing connection
  });
  const sheets = createSheets(google);
  return { url, sheets };
}

// §2 Open a handle
export function openHandle() {
  const sheets = createSheets(google);
  const sheet = sheets.open({
    tenantId,
    connectionId,
    spreadsheetId: "1AbC...",
  });
  return sheet;
}

// §2 Ranges and tabs
export function ranges() {
  const quoted: RangeRef = "'Q1 2026'!A1:C10"; // string form: you quote
  const block: RangeRef = { tab: "Q1 2026", range: "A1:C10" }; // the library quotes
  const whole: RangeRef = { tab: "Q1 2026" }; // the whole tab

  a1.quoteTab("Bob's tab"); // 'Bob''s tab'
  a1.range("Q1 2026", "A1:C10"); // 'Q1 2026'!A1:C10
  a1.columnToIndex("AA"); // 27
  a1.indexToColumn(27); // "AA"
  a1.split("'Q1 2026'!A1:C10"); // { tab: "Q1 2026", range: "A1:C10" }
  a1.parse("B2:D"); // { startRow: 2, endRow: null, startColumn: 2, endColumn: 4 }
  return [quoted, block, whole];
}

// §2 What is in the spreadsheet
export async function info() {
  const info = await sheet.getInfo();

  for (const tab of info.tabs) {
    console.log(tab.sheetId, tab.title, tab.rowCount, tab.hidden);
  }
}

// §3 Read: values
export async function readValues() {
  const grid = await sheet.getValues({ tab: "Applicants", range: "A1:D20" });
  const raw = await sheet.getValues("Applicants!E2:E50", {
    valueRender: "unformatted",
  });
  const lastRow = (await sheet.getValues({ tab: "Applicants" })).length;
  return { grid, raw, lastRow };
}

// §3 Rows as objects
export async function rowsAsObjects() {
  const panels = await sheet.getRows("Interview panels");

  for (const { rowNumber, data } of panels) {
    console.log(rowNumber, data["Panelist"], data["Email"]);
  }
}

// §3 Find rows
export async function findRows() {
  const hits = await sheet.findRows("Applicants", {
    column: { header: "Email" }, // or a letter: "C"
    where: (value) => String(value).toLowerCase() === "jane@applicant.com",
  });

  for (const { rowNumber, values } of hits) {
    console.log(rowNumber, values);
  }
}

// §4 Write
export async function write() {
  await sheet.update({ tab: "Applicants", range: "A2" }, [
    ["Jane Doe", "jane@applicant.com", 42, true, null],
  ]);

  await sheet.update("Report!A1", [["2026-12-01", "50%"]], {
    input: "user_entered",
  });

  await sheet.update({ tab: "Applicants", range: "A2" }, [
    [
      applicant.name, // literal, even if it starts with "="
      {
        formula: `=HYPERLINK("https://hrms.example.com/people/${applicant.id}", "Profile")`,
      },
    ],
  ]);
}

// §5 Appending safely
export async function appendSafely() {
  const { range, firstRow, lastRow } = await sheet.append("Applicants", [
    [applicant.name, applicant.email, applicant.appliedAt],
  ]);
  return { range, firstRow, lastRow };
}

export async function appendApplicant(email: string, row: string[]) {
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

// §6 Batch
export async function batch() {
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

  req.setColumnWidth("Q1 2026", "B:D", 120); // or [2, 4]
  req.insertColumns("Q1 2026", "C", 2); // two columns before column C (or 3)
  req.deleteColumns("Q1 2026", 3, 1); // delete column C

  // Tabs are [A, B, C].
  req.moveTab("A", 2); // → [B, A, C] (not [B, C, A])
  req.moveTab("A", 3); // → [B, C, A]
  req.moveTab("C", 0); // → [C, A, B]

  const newSheetId = replies[0]?.addSheet?.properties?.sheetId;

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
  return newSheetId;
}

// §8 Testing your integration
export async function testing() {
  const fake = new FakeSheets({
    spreadsheetId: "sheet-1",
    title: "Hiring",
    tabs: [{ title: "Applicants", rows: [["Name", "Email"]] }],
  });
  const sheets = createSheets(google, { transport: fake });
  const sheet = sheets.open({
    tenantId,
    connectionId,
    spreadsheetId: "sheet-1",
  });

  await sheet.append("Applicants", [["Jane Doe", "jane@applicant.com"]]);

  expect(fake.values("Applicants")).toEqual([
    ["Name", "Email"],
    ["Jane Doe", "jane@applicant.com"],
  ]);

  fake.formulaAt("Applicants", "C2");
  fake.failNext(
    "valuesAppend",
    Object.assign(new Error("reset"), { code: "ECONNRESET" }),
    {
      afterApply: true,
    },
  );

  fake.failNext(
    "valuesGet",
    sheetsHttpError(403, "forbidden", "The caller does not have permission"),
  );
  // the next read throws SpreadsheetAccessDeniedError

  fake.failNext(
    "batchUpdate",
    sheetsHttpError(429, "rateLimitExceeded", "Quota exceeded"),
  );
  // the next sheet.batch(...) is retried and applied once
}

// §9 Verify against a real sheet
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

  // Row 1: the formula first, then every string next to it (USER_ENTERED + ').
  await sheet.update({ tab, range: "A1" }, [[{ formula: "=1+1" }, ...matrix]]);
  // Row 2: the same strings with no formula (the default RAW path).
  await sheet.update({ tab, range: "B2" }, [matrix]);

  const [formulaRow] = await sheet.getValues(
    { tab, range: "A1" },
    { valueRender: "formula" },
  );
  const [withFormula, raw] = await sheet.getValues(
    { tab, range: "B1:K2" },
    { valueRender: "unformatted" },
  );

  let bad = 0;
  if (formulaRow?.[0] !== "=1+1") {
    bad++;
    console.log("formula cell was not stored as a formula:", formulaRow?.[0]);
  }
  const check = (label: string, row: unknown[] | undefined) =>
    matrix.forEach((expected, i) => {
      const got = row?.[i] ?? ""; // Google drops trailing empty cells
      if (got !== expected) {
        bad++;
        console.log(
          `${label}: wrote ${JSON.stringify(expected)}, read ${JSON.stringify(got)}`,
        );
      }
    });
  check("next to a formula", withFormula);
  check("raw", raw);

  console.log(
    bad === 0 ? "All values round-tripped." : `${bad} value(s) changed.`,
  );
}
