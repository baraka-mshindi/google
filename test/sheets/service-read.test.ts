import { describe, expect, it } from "vitest";
import {
  ConnectionRevokedError,
  GoogleApiError,
  GoogleLibError,
  InvalidSheetsInputError,
  MissingScopeError,
  SheetTabNotFoundError,
  SpreadsheetNotFoundError,
} from "../../src/core/errors.js";
import { req } from "../../src/sheets/requests.js";
import { INFO_FIELDS, TAB_FIELDS } from "../../src/sheets/transport.js";
import { sheetsHttpError } from "../../src/testing/fake-sheets.js";
import { setup } from "./service-setup.js";

const AWKWARD = ["Q1 2026", "Bob's", "A1", "2026"];

describe("open", () => {
  it("validates the three ids without calling Google", async () => {
    const { sheets, fake, connectionId } = await setup();
    const ok = { tenantId: "t1", connectionId, spreadsheetId: "ss-1" };
    for (const field of ["tenantId", "connectionId", "spreadsheetId"]) {
      for (const bad of ["", undefined, 42]) {
        const input = { ...ok, [field]: bad } as unknown as typeof ok;
        expect(() => sheets.open(input)).toThrow(InvalidSheetsInputError);
        expect(() => sheets.open(input)).toThrow(
          expect.objectContaining({ field }),
        );
      }
    }
    expect(sheets.open(ok).spreadsheetId).toBe("ss-1");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("getInfo", () => {
  it("maps tabs, named ranges and protected ranges", async () => {
    const { sheet, fake } = await setup({
      tabs: [
        { title: "Sheet1", sheetId: 0 },
        { title: "Q1 2026", sheetId: 7 },
      ],
    });
    await sheet.batch([
      req.hideTab("Q1 2026"),
      req.freeze("Q1 2026", { rows: 1, columns: 2 }),
      req.addNamedRange("Totals", "Q1 2026", "A1:C10"),
      req.addNamedRange("Cols", { sheetId: 0 }, "A:C"),
      req.addNamedRange("Rows", "Sheet1", "2:5"),
      req.protect("Sheet1", {
        range: "A1:B2",
        description: "header",
        warningOnly: true,
      }),
      req.protect("Q1 2026"),
    ]);
    fake.calls.length = 0;

    const info = await sheet.getInfo();

    expect(fake.calls).toEqual([{ op: "getSpreadsheet", fields: INFO_FIELDS }]);
    expect(info).toEqual({
      spreadsheetId: "ss-1",
      title: "Fake Spreadsheet",
      locale: "en_US",
      timeZone: "Etc/GMT",
      tabs: [
        {
          sheetId: 0,
          title: "Sheet1",
          index: 0,
          hidden: false,
          rowCount: 1000,
          columnCount: 26,
          frozenRows: 0,
          frozenColumns: 0,
        },
        {
          sheetId: 7,
          title: "Q1 2026",
          index: 1,
          hidden: true,
          rowCount: 1000,
          columnCount: 26,
          frozenRows: 1,
          frozenColumns: 2,
        },
      ],
      namedRanges: [
        {
          namedRangeId: expect.any(String),
          name: "Totals",
          range: "'Q1 2026'!A1:C10",
        },
        {
          namedRangeId: expect.any(String),
          name: "Cols",
          range: "'Sheet1'!A:C",
        },
        {
          namedRangeId: expect.any(String),
          name: "Rows",
          range: "'Sheet1'!2:5",
        },
      ],
      protectedRanges: [
        {
          protectedRangeId: expect.any(Number),
          range: "'Sheet1'!A1:B2",
          description: "header",
          warningOnly: true,
        },
        {
          protectedRangeId: expect.any(Number),
          range: "'Q1 2026'",
          description: null,
          warningOnly: false,
        },
      ],
    });
  });

  it("404 on the spreadsheet → SpreadsheetNotFoundError with ids", async () => {
    const { sheets, connectionId } = await setup();
    const err = await sheets
      .open({ tenantId: "t1", connectionId, spreadsheetId: "missing" })
      .getInfo()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpreadsheetNotFoundError);
    expect(err).toMatchObject({ tenantId: "t1", connectionId });
  });
});

describe("getValues", () => {
  const tabs = [
    { title: "Sheet1", sheetId: 0, rows: [["first", 1]] },
    { title: "Q1 2026", sheetId: 3, rows: [["a", 2, true], ["b"]] },
  ];

  it("reads by quoted string, by { tab } and by { tab, range }", async () => {
    const { sheet, fake } = await setup({ tabs });
    expect(await sheet.getValues("'Q1 2026'!A1:B2")).toEqual([
      ["a", "2"],
      ["b"],
    ]);
    expect(await sheet.getValues({ tab: "Q1 2026" })).toEqual([
      ["a", "2", "TRUE"],
      ["b"],
    ]);
    expect(await sheet.getValues({ tab: "Q1 2026", range: "A2" })).toEqual([
      ["b"],
    ]);
    expect(fake.calls.map((c) => c.ranges)).toEqual([
      ["'Q1 2026'!A1:B2"],
      ["'Q1 2026'"],
      ["'Q1 2026'!A2"],
    ]);
  });

  it("re-quotes an unquoted string tab before sending", async () => {
    const { sheet, fake } = await setup({ tabs });
    expect(await sheet.getValues("Sheet1!A1")).toEqual([["first"]]);
    expect(fake.calls[0]!.ranges).toEqual(["'Sheet1'!A1"]);
  });

  it("{ sheetId: 0 } looks the title up with one small read", async () => {
    const { sheet, fake } = await setup({ tabs });
    expect(await sheet.getValues({ tab: { sheetId: 0 } })).toEqual([
      ["first", "1"],
    ]);
    expect(fake.calls).toEqual([
      { op: "getSpreadsheet", fields: TAB_FIELDS },
      { op: "valuesGet", ranges: ["'Sheet1'"] },
    ]);
  });

  it("an unknown sheetId → SheetTabNotFoundError, no values call", async () => {
    const { sheet, ops, connectionId } = await setup({ tabs });
    const err = await sheet
      .getValues({ tab: { sheetId: 99 }, range: "A1" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SheetTabNotFoundError);
    expect(err).toMatchObject({ tenantId: "t1", connectionId });
    expect(ops("valuesGet")).toHaveLength(0);
  });

  it("valueRender picks unformatted or formula output", async () => {
    const { sheet } = await setup({ tabs });
    await sheet.update({ tab: "Sheet1", range: "C1" }, [
      [{ formula: "=B1*2" }],
    ]);
    expect(
      await sheet.getValues("'Q1 2026'!A1:C1", { valueRender: "unformatted" }),
    ).toEqual([["a", 2, true]]);
    expect(
      await sheet.getValues("'Sheet1'!C1", { valueRender: "formula" }),
    ).toEqual([["=B1*2"]]);
  });

  it("rejects bad ranges before any Google call", async () => {
    const { sheet, fake } = await setup({ tabs });
    const bad: unknown[] = [
      "A1:B2", // no tab: would read the first tab
      "Sheet1!ZZZZ1",
      "'Sheet1",
      { tab: "" },
      { tab: "Sheet1", range: "" },
      { tab: "Sheet1", range: "A1:B2:C3" },
      { tab: { sheetId: -1 } },
      { tab: { sheetId: 1.5 } },
      42,
      null,
    ];
    for (const range of bad) {
      await expect(
        sheet.getValues(range as never),
        JSON.stringify(range),
      ).rejects.toBeInstanceOf(InvalidSheetsInputError);
    }
    await expect(sheet.getValues("A1:B2")).rejects.toMatchObject({
      field: "range",
    });
    await expect(
      sheet.getValues({ tab: "Sheet1" }, { valueRender: "bogus" as never }),
    ).rejects.toMatchObject({ field: "valueRender" });
    expect(fake.calls).toHaveLength(0);
  });

  it("missing Sheets scope → MissingScopeError before any Google call", async () => {
    const { sheet, fake } = await setup({ services: ["gmail"] });
    await expect(sheet.getValues({ tab: "Sheet1" })).rejects.toBeInstanceOf(
      MissingScopeError,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("sanitizes Google errors into GoogleLibError", async () => {
    const { sheet, fake } = await setup({ tabs });
    fake.failNext(
      "valuesGet",
      sheetsHttpError(400, "badRequest", "Something odd"),
    );
    const err = await sheet
      .getValues({ tab: "Sheet1" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).toMatchObject({ status: 400, tenantId: "t1" });
  });

  it("a missing tab title → SheetTabNotFoundError", async () => {
    const { sheet } = await setup({ tabs });
    await expect(sheet.getValues({ tab: "Nope" })).rejects.toMatchObject({
      code: "sheet_tab_not_found",
      tab: "Nope",
    });
  });

  it("401 twice → ConnectionRevokedError", async () => {
    const { sheet, fake, events } = await setup({ tabs });
    fake.failNext("valuesGet", sheetsHttpError(401, "authError", "unauth"));
    fake.failNext("valuesGet", sheetsHttpError(401, "authError", "unauth"));
    await expect(sheet.getValues({ tab: "Sheet1" })).rejects.toBeInstanceOf(
      ConnectionRevokedError,
    );
    expect(events.map((e) => e.type)).toEqual(["connection.revoked"]);
  });
});

describe("getValuesBatch", () => {
  it("keeps input order, with one lookup for every { sheetId }", async () => {
    const { sheet, fake } = await setup({
      tabs: [
        { title: "A", sheetId: 0, rows: [["a"]] },
        { title: "B", sheetId: 4, rows: [["b"]] },
        { title: "C", sheetId: 5, rows: [["c"]] },
      ],
    });
    const out = await sheet.getValuesBatch([
      { tab: "C" },
      { tab: { sheetId: 4 } },
      "'A'!A1",
      { tab: { sheetId: 0 } },
    ]);
    expect(out).toEqual([[["c"]], [["b"]], [["a"]], [["a"]]]);
    expect(fake.calls).toEqual([
      { op: "getSpreadsheet", fields: TAB_FIELDS },
      { op: "valuesBatchGet", ranges: ["'C'", "'B'", "'A'!A1", "'A'"] },
    ]);
  });

  it("rejects an empty list", async () => {
    const { sheet, fake } = await setup();
    await expect(sheet.getValuesBatch([])).rejects.toMatchObject({
      field: "ranges",
    });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("empty tab reads as []", () => {
  it("getValues, getRows and findRows", async () => {
    const { sheet } = await setup({ tabs: [{ title: "Empty" }] });
    expect(await sheet.getValues({ tab: "Empty" })).toEqual([]);
    expect(await sheet.getRows("Empty")).toEqual([]);
    expect(
      await sheet.findRows("Empty", { column: "A", where: () => true }),
    ).toEqual([]);
    expect(
      await sheet.findRows("Empty", {
        column: { header: "Email" },
        where: () => true,
      }),
    ).toEqual([]);
  });
});

describe("ragged rows are padded", () => {
  const tabs = [
    {
      title: "People",
      rows: [["Name", "Email", "Phone"], ["Ann"], ["Bob", "b@x", "1", "x"]],
    },
  ];

  it("getValues returns rows as Google does", async () => {
    const { sheet } = await setup({ tabs });
    expect(await sheet.getValues({ tab: "People" })).toEqual([
      ["Name", "Email", "Phone"],
      ["Ann"],
      ["Bob", "b@x", "1", "x"],
    ]);
  });

  it("getRows pads with null", async () => {
    const { sheet } = await setup({ tabs });
    expect(await sheet.getRows("People")).toEqual([
      {
        rowNumber: 2,
        data: { Name: "Ann", Email: null, Phone: null, column_D: null },
      },
      {
        rowNumber: 3,
        data: { Name: "Bob", Email: "b@x", Phone: "1", column_D: "x" },
      },
    ]);
  });

  it("findRows pads values to the widest row", async () => {
    const { sheet } = await setup({ tabs });
    expect(
      await sheet.findRows("People", { column: "A", where: () => true }),
    ).toEqual([
      { rowNumber: 2, values: ["Ann", null, null, null] },
      { rowNumber: 3, values: ["Bob", "b@x", "1", "x"] },
    ]);
  });
});

describe("getRows", () => {
  it("applies the header rules", async () => {
    const { sheet } = await setup({
      tabs: [
        {
          title: "Panels",
          rows: [
            [" Name ", "", "Name", "Email", "Name"],
            ["Ann", "x", "Ann B", "a@x", "A3", "extra"],
            ["", "", ""],
            [],
            ["Bob"],
          ],
        },
      ],
    });
    expect(await sheet.getRows("Panels")).toEqual([
      {
        rowNumber: 2,
        data: {
          Name: "Ann",
          column_B: "x",
          Name_2: "Ann B",
          Email: "a@x",
          Name_3: "A3",
          column_F: "extra",
        },
      },
      {
        rowNumber: 5,
        data: {
          Name: "Bob",
          column_B: null,
          Name_2: null,
          Email: null,
          Name_3: null,
          column_F: null,
        },
      },
    ]);
  });

  it("keeps a header such as __proto__ as an own key", async () => {
    const { sheet } = await setup({
      tabs: [{ title: "T", rows: [["__proto__"], ["v"]] }],
    });
    const [row] = await sheet.getRows("T");
    expect(Object.keys(row!.data)).toEqual(["__proto__"]);
    expect(row!.data["__proto__"]).toBe("v");
  });

  it("honours headerRow, columns and valueRender", async () => {
    const { sheet, fake } = await setup({
      tabs: [
        {
          title: "Q1 2026",
          rows: [["Report"], ["id", "Name", "", "Score"], ["1", "Ann", "x", 7]],
        },
      ],
    });
    expect(
      await sheet.getRows("Q1 2026", {
        headerRow: 2,
        columns: "B:D",
        valueRender: "unformatted",
      }),
    ).toEqual([
      { rowNumber: 3, data: { Name: "Ann", column_C: "x", Score: 7 } },
    ]);
    expect(fake.calls[0]!.ranges).toEqual(["'Q1 2026'!B:D"]);
  });

  it("reads a { sheetId } tab", async () => {
    const { sheet } = await setup({
      tabs: [{ title: "Sheet1", sheetId: 0, rows: [["k"], ["v"]] }],
    });
    expect(await sheet.getRows({ sheetId: 0 })).toEqual([
      { rowNumber: 2, data: { k: "v" } },
    ]);
  });

  it("rejects bad options before any Google call", async () => {
    const { sheet, fake } = await setup();
    for (const headerRow of [0, -1, 1.5]) {
      await expect(
        sheet.getRows("Sheet1", { headerRow }),
      ).rejects.toMatchObject({ field: "headerRow" });
    }
    for (const columns of ["B2:D", "1:3", "", "B:D:E"]) {
      await expect(sheet.getRows("Sheet1", { columns })).rejects.toMatchObject({
        field: "columns",
      });
    }
    await expect(sheet.getRows("")).rejects.toMatchObject({ field: "tab" });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("findRows", () => {
  const tabs = [
    {
      title: "First",
      rows: [
        ["Email", "Name"],
        ["a@x", "Ann"],
      ],
    },
    { title: "Second", rows: [["Email", "Name"], ["b@x", "Bob"], ["c@x"]] },
  ];

  it("reads only the named tab (gsheets defect 1)", async () => {
    const { sheet, fake } = await setup({ tabs });
    expect(
      await sheet.findRows("Second", {
        column: "A",
        where: (v) => v === "b@x",
      }),
    ).toEqual([{ rowNumber: 2, values: ["b@x", "Bob"] }]);
    expect(
      await sheet.findRows("Second", {
        column: "A",
        where: (v) => v === "a@x",
      }),
    ).toEqual([]);
    expect(fake.calls.map((c) => c.ranges)).toEqual([
      ["'Second'"],
      ["'Second'"],
    ]);
  });

  it("finds by { header } and passes the padded row to where", async () => {
    const { sheet } = await setup({ tabs });
    const seen: unknown[] = [];
    const out = await sheet.findRows("Second", {
      column: { header: "Name" },
      where: (v, row) => {
        seen.push(row);
        return v === null;
      },
    });
    expect(out).toEqual([{ rowNumber: 3, values: ["c@x", null] }]);
    expect(seen).toEqual([
      ["b@x", "Bob"],
      ["c@x", null],
    ]);
  });

  it("headerRow 0 searches every row", async () => {
    const { sheet } = await setup({ tabs });
    expect(
      await sheet.findRows("First", {
        column: "B",
        headerRow: 0,
        where: (v) => typeof v === "string",
      }),
    ).toEqual([
      { rowNumber: 1, values: ["Email", "Name"] },
      { rowNumber: 2, values: ["a@x", "Ann"] },
    ]);
  });

  it("an unknown { header } → InvalidSheetsInputError('column')", async () => {
    const { sheet } = await setup({ tabs });
    await expect(
      sheet.findRows("First", {
        column: { header: "Phone" },
        where: () => true,
      }),
    ).rejects.toMatchObject({ code: "invalid_sheets_input", field: "column" });
  });

  it("rejects bad options before any Google call", async () => {
    const { sheet, fake } = await setup({ tabs });
    const where = () => true;
    for (const column of ["1A", "", "AAAA", { header: "" }, 3]) {
      await expect(
        sheet.findRows("First", { column: column as never, where }),
      ).rejects.toMatchObject({ field: "column" });
    }
    await expect(
      sheet.findRows("First", {
        column: { header: "Email" },
        headerRow: 0,
        where,
      }),
    ).rejects.toMatchObject({ field: "column" });
    await expect(
      sheet.findRows("First", { column: "A", headerRow: -1, where }),
    ).rejects.toMatchObject({ field: "headerRow" });
    await expect(
      sheet.findRows("First", { column: "A", where: "x" as never }),
    ).rejects.toMatchObject({ field: "where" });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("quotes awkward tab titles in every method", () => {
  const tabs = [
    { title: "Sheet1", sheetId: 0, rows: [["first-tab"]] },
    ...AWKWARD.map((title, i) => ({
      title,
      sheetId: i + 1,
      rows: [[`in ${title}`]],
    })),
  ];

  it.each(AWKWARD)("%s", async (title) => {
    const { sheet, fake } = await setup({ tabs });

    expect(await sheet.getValues({ tab: title, range: "A1" })).toEqual([
      [`in ${title}`],
    ]);
    expect(await sheet.getRows(title)).toEqual([]);

    await sheet.update({ tab: title, range: "B1" }, [["updated"]]);
    await sheet.append(title, [["appended"]]);
    await sheet.clear({ tab: title, range: "A1" });
    await sheet.batch([req.freeze(title, { rows: 1 })]);

    expect(fake.values(title)).toEqual([["", "updated"], ["appended"]]);
    expect(fake.tab(title)!.frozenRows).toBe(1);
    expect(fake.values("Sheet1")).toEqual([["first-tab"]]);
    expect(fake.tab("Sheet1")!.frozenRows).toBe(0);
  });
});

describe("errors", () => {
  it("every rejection is a GoogleLibError", async () => {
    const { sheet, fake } = await setup();
    fake.failNext("valuesGet", new Error("weird"));
    const err = await sheet
      .getValues({ tab: "Sheet1" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleLibError);
  });
});
