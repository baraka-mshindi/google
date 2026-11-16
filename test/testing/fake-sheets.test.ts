import { describe, expect, it } from "vitest";
import {
  SheetTabNotFoundError,
  SpreadsheetNotFoundError,
} from "../../src/core/errors.js";
import { classifySheetsError } from "../../src/sheets/retry.js";
import { INFO_FIELDS, TAB_FIELDS } from "../../src/sheets/transport.js";
import { FakeSheets, sheetsHttpError } from "../../src/testing/index.js";

const T = { accessToken: "tok", spreadsheetId: "fake-spreadsheet" };

const status = async (p: Promise<unknown>) =>
  p.then(
    () => 0,
    (e: { response: { status: number } }) => e.response.status,
  );
const message = async (p: Promise<unknown>) =>
  p.then(
    () => "",
    (e: { response: { data: { error: { message: string } } } }) =>
      e.response.data.error.message,
  );

const write = (
  f: FakeSheets,
  range: string,
  values: unknown[][],
  valueInputOption: "RAW" | "USER_ENTERED" = "RAW",
) => f.valuesUpdate({ ...T, range, values, valueInputOption });
const read = async (
  f: FakeSheets,
  range: string,
  valueRenderOption:
    "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA" = "UNFORMATTED_VALUE",
) => (await f.valuesGet({ ...T, range, valueRenderOption })).values ?? [];
const append = (
  f: FakeSheets,
  range: string,
  values: unknown[][],
  insertDataOption: "INSERT_ROWS" | "OVERWRITE" = "INSERT_ROWS",
) =>
  f.valuesAppend({
    ...T,
    range,
    values,
    valueInputOption: "RAW",
    insertDataOption,
  });
const batch = (f: FakeSheets, requests: object[]) =>
  f.batchUpdate({ ...T, requests });

describe("FakeSheets", () => {
  describe("construction and helpers", () => {
    it("defaults to one tab Sheet1 with sheetId 0", () => {
      const f = new FakeSheets();
      expect(f.tab("Sheet1")).toEqual({
        sheetId: 0,
        hidden: false,
        frozenRows: 0,
        frozenColumns: 0,
        index: 0,
      });
      expect(f.values("Sheet1")).toEqual([]);
      expect(f.tab("Nope")).toBeUndefined();
    });

    it("seeds tabs and rows; values() trims trailing empties", () => {
      const f = new FakeSheets({
        tabs: [
          { title: "Log", rows: [["a", "", ""], [1, true, ""], [], ["", ""]] },
          { title: "Other", sheetId: 42 },
        ],
      });
      expect(f.values("Log")).toEqual([["a"], [1, true]]);
      expect(f.tab("Other")).toMatchObject({ sheetId: 42, index: 1 });
      expect(f.tab("Log")?.sheetId).not.toBe(42);
    });

    it("values() returns a copy", () => {
      const f = new FakeSheets({ tabs: [{ title: "T", rows: [["a"]] }] });
      f.values("T")[0]![0] = "mutated";
      expect(f.values("T")).toEqual([["a"]]);
    });
  });

  describe("errors", () => {
    it("unknown spreadsheetId → 404 on every op; classified not-found", async () => {
      const f = new FakeSheets();
      const bad = { ...T, spreadsheetId: "other" };
      expect(
        await status(
          f.valuesGet({
            ...bad,
            range: "'Sheet1'!A1",
            valueRenderOption: "FORMULA",
          }),
        ),
      ).toBe(404);
      expect(
        await status(f.getSpreadsheet({ ...bad, fields: TAB_FIELDS })),
      ).toBe(404);
      expect(await status(f.batchUpdate({ ...bad, requests: [] }))).toBe(404);
      const err = await f
        .valuesBatchClear({ ...bad, ranges: ["'Sheet1'!A1"] })
        .catch((e: unknown) => e);
      const c = classifySheetsError(err, true);
      expect(c.kind === "fail" && c.error).toBeInstanceOf(
        SpreadsheetNotFoundError,
      );
    });

    it("range on a missing tab → 400 Unable to parse range; classified tab-not-found", async () => {
      const f = new FakeSheets();
      const p = read(f, "'Missing Tab'!A1");
      expect(await status(p)).toBe(400);
      expect(await message(read(f, "'Missing Tab'!A1"))).toBe(
        "Unable to parse range: 'Missing Tab'!A1",
      );
      const err = await append(f, "'Missing Tab'!A1", [["x"]]).catch(
        (e: unknown) => e,
      );
      const c = classifySheetsError(err, false);
      expect(c.kind).toBe("fail");
      if (c.kind !== "fail") return;
      expect(c.error).toBeInstanceOf(SheetTabNotFoundError);
      expect((c.error as SheetTabNotFoundError).tab).toBe("Missing Tab");
    });

    it("a malformed range → 400 Unable to parse range", async () => {
      const f = new FakeSheets();
      expect(await message(read(f, "'Sheet1'!A1:B2:C3"))).toBe(
        "Unable to parse range: 'Sheet1'!A1:B2:C3",
      );
    });

    it("sheetsHttpError is gaxios-shaped", () => {
      const e = sheetsHttpError(
        429,
        "rateLimitExceeded",
        "slow down",
      ) as Error & {
        code: number;
        response: { status: number; data: { error: unknown } };
      };
      expect(e.message).toBe("slow down");
      expect(e.code).toBe(429);
      expect(e.response.status).toBe(429);
      expect(e.response.data.error).toEqual({
        code: 429,
        message: "slow down",
        errors: [{ reason: "rateLimitExceeded" }],
      });
    });
  });

  describe("RAW writes", () => {
    it("stores strings verbatim, numbers and booleans typed", async () => {
      const f = new FakeSheets();
      await write(f, "'Sheet1'!A1", [
        [
          "=1+1",
          "'quoted",
          "+254 712 345 678",
          "-5",
          "1/2",
          "5%",
          "TRUE",
          7,
          false,
        ],
      ]);
      expect(await read(f, "'Sheet1'!A1:I1")).toEqual([
        [
          "=1+1",
          "'quoted",
          "+254 712 345 678",
          "-5",
          "1/2",
          "5%",
          "TRUE",
          7,
          false,
        ],
      ]);
      expect(f.formulaAt("Sheet1", "A1")).toBeNull();
    });

    it('"" clears a cell; null leaves it unchanged', async () => {
      const f = new FakeSheets({
        tabs: [{ title: "T", rows: [["a", "b", "c"]] }],
      });
      await write(f, "'T'!A1", [["", null, "z"]]);
      expect(f.values("T")).toEqual([["", "b", "z"]]);
      await write(f, "'T'!A1", [["", "", ""]]);
      expect(f.values("T")).toEqual([]);
    });

    it("returns updatedRange and updatedCells", async () => {
      const f = new FakeSheets({ tabs: [{ title: "Log" }] });
      const out = await write(f, "'Log'!B2", [
        ["a", "b"],
        ["c", "d", "e"],
      ]);
      expect(out).toMatchObject({
        updatedRange: "'Log'!B2:D3",
        updatedCells: 5,
      });
    });

    it("400 when values overflow a closed range", async () => {
      const f = new FakeSheets();
      expect(await status(write(f, "'Sheet1'!A1:A1", [["a", "b"]]))).toBe(400);
      expect(f.values("Sheet1")).toEqual([]);
    });
  });

  describe("USER_ENTERED parsing", () => {
    const ue = async (input: string) => {
      const f = new FakeSheets();
      await write(f, "'Sheet1'!A1", [[input]], "USER_ENTERED");
      return {
        f,
        unformatted: (await read(f, "'Sheet1'!A1"))[0]?.[0] ?? "",
        formatted:
          (await read(f, "'Sheet1'!A1", "FORMATTED_VALUE"))[0]?.[0] ?? "",
        formula: (await read(f, "'Sheet1'!A1", "FORMULA"))[0]?.[0] ?? "",
      };
    };

    it("leading ' → literal rest, no formula", async () => {
      const r = await ue("'=1+1");
      expect(r.unformatted).toBe("=1+1");
      expect(r.formula).toBe("=1+1");
      expect(r.f.formulaAt("Sheet1", "A1")).toBeNull();
      expect(r.f.values("Sheet1")).toEqual([["=1+1"]]);
      expect((await ue("''quoted")).unformatted).toBe("'quoted");
      expect((await ue("'-5")).unformatted).toBe("-5");
    });

    it('= → stored formula; reads return "" except under FORMULA', async () => {
      const r = await ue("=SUM(A1)");
      expect(r.f.formulaAt("Sheet1", "A1")).toBe("=SUM(A1)");
      expect(r.unformatted).toBe("");
      expect(r.formatted).toBe("");
      expect(r.formula).toBe("=SUM(A1)");
    });

    it("+/- followed by a non-number → formula", async () => {
      const r = await ue("+254 712 345 678");
      expect(r.f.formulaAt("Sheet1", "A1")).toBe("+254 712 345 678");
      expect(r.unformatted).toBe("");
      expect((await ue("-abc")).f.formulaAt("Sheet1", "A1")).toBe("-abc");
    });

    it("numbers, percents, booleans and date-like text are parsed", async () => {
      expect((await ue("-5")).unformatted).toBe(-5);
      expect((await ue("+3.5")).unformatted).toBe(3.5);
      expect((await ue("42")).formatted).toBe("42");
      expect((await ue("5%")).unformatted).toBe(0.05);
      expect((await ue("TRUE")).unformatted).toBe(true);
      expect((await ue("false")).unformatted).toBe(false);
      expect((await ue("TRUE")).formatted).toBe("TRUE");
      const d = await ue("1/2");
      expect(typeof d.unformatted).toBe("number");
      expect(d.formatted).not.toBe("1/2");
      expect(typeof (await ue("12/31/2026")).unformatted).toBe("number");
      expect((await ue("hello")).unformatted).toBe("hello");
      expect((await ue("1/2/3/4")).unformatted).toBe("1/2/3/4");
    });

    it("the encodeRows formula-row shape round-trips next to a formula", async () => {
      const f = new FakeSheets();
      await write(
        f,
        "'Sheet1'!A1",
        [
          [
            "=1+1",
            "'=1+1",
            "'+254 712 345 678",
            "'-5",
            "'1/2",
            "'5%",
            "'TRUE",
            "''quoted",
            "",
          ],
        ],
        "USER_ENTERED",
      );
      expect(f.values("Sheet1")).toEqual([
        ["", "=1+1", "+254 712 345 678", "-5", "1/2", "5%", "TRUE", "'quoted"],
      ]);
      expect(f.formulaAt("Sheet1", "A1")).toBe("=1+1");
      expect(f.formulaAt("Sheet1", "B1")).toBeNull();
      expect(f.formulaAt("Sheet1", "Z9")).toBeNull();
    });
  });

  describe("reads", () => {
    it("trims trailing empties, keeps inner empty rows, omits values when empty", async () => {
      const f = new FakeSheets({
        tabs: [
          { title: "T", rows: [["a", "", "c", ""], [], ["", "x"], [], []] },
        ],
      });
      const got = await f.valuesGet({
        ...T,
        range: "'T'",
        valueRenderOption: "UNFORMATTED_VALUE",
      });
      expect(got.values).toEqual([["a", "", "c"], [], ["", "x"]]);
      expect(got.range).toBe("'T'!A1:Z1000");
      const sub = await f.valuesGet({
        ...T,
        range: "'T'!B2:C3",
        valueRenderOption: "UNFORMATTED_VALUE",
      });
      expect(sub.values).toEqual([[], ["x"]]);
      const empty = await f.valuesGet({
        ...T,
        range: "'T'!F1:G2",
        valueRenderOption: "UNFORMATTED_VALUE",
      });
      expect(empty.values).toBeUndefined();
      expect(empty.range).toBe("'T'!F1:G2");
    });

    it("FORMATTED_VALUE returns strings", async () => {
      const f = new FakeSheets({
        tabs: [{ title: "T", rows: [[1.5, true, "s"]] }],
      });
      expect(await read(f, "'T'!A1:C1", "FORMATTED_VALUE")).toEqual([
        ["1.5", "TRUE", "s"],
      ]);
    });

    it("open-ended and column ranges; bare unquoted tab refs", async () => {
      const f = new FakeSheets({
        tabs: [
          {
            title: "T",
            rows: [
              ["a", "b"],
              ["c", "d"],
              ["e", "f"],
            ],
          },
        ],
      });
      expect(await read(f, "T!B:B")).toEqual([["b"], ["d"], ["f"]]);
      expect(await read(f, "'T'!A2:B")).toEqual([
        ["c", "d"],
        ["e", "f"],
      ]);
      expect(await read(f, "'T'!2:2")).toEqual([["c", "d"]]);
    });

    it("tab lookup is case-insensitive", async () => {
      const f = new FakeSheets({ tabs: [{ title: "Log", rows: [["a"]] }] });
      expect(await read(f, "'log'!A1")).toEqual([["a"]]);
    });

    it("valuesBatchGet answers in input order", async () => {
      const f = new FakeSheets({ tabs: [{ title: "T", rows: [["a", "b"]] }] });
      const out = await f.valuesBatchGet({
        ...T,
        ranges: ["'T'!B1", "'T'!A1"],
        valueRenderOption: "UNFORMATTED_VALUE",
      });
      expect(out.valueRanges?.map((v) => v.values)).toEqual([[["b"]], [["a"]]]);
      expect(
        await status(
          f.valuesBatchGet({
            ...T,
            ranges: ["'T'!A1", "'X'!A1"],
            valueRenderOption: "FORMULA",
          }),
        ),
      ).toBe(400);
    });

    it("returns structuredClones", async () => {
      const f = new FakeSheets({ tabs: [{ title: "T", rows: [["a"]] }] });
      const got = await f.valuesGet({
        ...T,
        range: "'T'!A1",
        valueRenderOption: "UNFORMATTED_VALUE",
      });
      got.values![0]![0] = "mutated";
      expect(f.values("T")).toEqual([["a"]]);
      const input = [["x"]];
      await write(f, "'T'!A1", input);
      input[0]![0] = "y";
      expect(f.values("T")).toEqual([["x"]]);
    });
  });

  describe("valuesBatchUpdate and valuesBatchClear", () => {
    it("writes every range and counts cells", async () => {
      const f = new FakeSheets({ tabs: [{ title: "T" }] });
      const out = await f.valuesBatchUpdate({
        ...T,
        data: [
          { range: "'T'!A1", values: [["a", "b"]] },
          { range: "'T'!A3", values: [["=A1"]] },
        ],
        valueInputOption: "USER_ENTERED",
      });
      expect(out.totalUpdatedCells).toBe(3);
      expect(f.values("T")).toEqual([["a", "b"], [], [""]]);
      expect(f.formulaAt("T", "A3")).toBe("=A1");
    });

    it("is atomic: a bad range writes nothing", async () => {
      const f = new FakeSheets({ tabs: [{ title: "T" }] });
      const p = f.valuesBatchUpdate({
        ...T,
        data: [
          { range: "'T'!A1", values: [["a"]] },
          { range: "'X'!A1", values: [["b"]] },
        ],
        valueInputOption: "RAW",
      });
      expect(await status(p)).toBe(400);
      expect(f.values("T")).toEqual([]);
    });

    it("clears values and formulas", async () => {
      const f = new FakeSheets({
        tabs: [
          {
            title: "T",
            rows: [
              ["a", "b"],
              ["c", "d"],
            ],
          },
        ],
      });
      await write(f, "'T'!C1", [["=1"]], "USER_ENTERED");
      await f.valuesBatchClear({ ...T, ranges: ["'T'!B1:C1", "'T'!A2"] });
      expect(f.values("T")).toEqual([["a"], ["", "d"]]);
      expect(f.formulaAt("T", "C1")).toBeNull();
      expect(
        await status(
          f.valuesBatchClear({ ...T, ranges: ["'T'!A1", "'X'!A1"] }),
        ),
      ).toBe(400);
      expect(f.values("T")).toEqual([["a"], ["", "d"]]);
    });
  });

  describe("valuesAppend", () => {
    it("appends twice under a header into rows 2 and 3", async () => {
      const f = new FakeSheets({
        tabs: [{ title: "Log", rows: [["h1", "h2", "h3"]] }],
      });
      const r1 = await append(f, "'Log'!A1", [["a", "b", "c"]]);
      const r2 = await append(f, "'Log'", [["d", "e"]]);
      expect(r1.updates?.updatedRange).toBe("'Log'!A2:C2");
      expect(r2.updates?.updatedRange).toBe("'Log'!A3:B3");
      expect(f.values("Log")).toEqual([
        ["h1", "h2", "h3"],
        ["a", "b", "c"],
        ["d", "e"],
      ]);
    });

    it("lands after the last non-empty row anywhere, from column A", async () => {
      const f = new FakeSheets({
        tabs: [{ title: "Log", rows: [["h"], [], [], ["", "", "x"]] }],
      });
      const r = await append(f, "'Log'", [
        [1, 2, 3],
        [4, 5, 6],
      ]);
      expect(r.updates?.updatedRange).toBe("'Log'!A5:C6");
    });

    it("a formula cell counts as non-empty", async () => {
      const f = new FakeSheets({ tabs: [{ title: "Log" }] });
      await write(f, "'Log'!A2", [["=1+1"]], "USER_ENTERED");
      const r = await append(f, "'Log'", [["next"]]);
      expect(r.updates?.updatedRange).toBe("'Log'!A3");
      expect(f.formulaAt("Log", "A2")).toBe("=1+1");
    });

    it("INSERT_ROWS grows the grid; OVERWRITE does not", async () => {
      const f = new FakeSheets({ tabs: [{ title: "A" }, { title: "B" }] });
      await append(f, "'A'", [["x"]], "INSERT_ROWS");
      await append(f, "'B'", [["x"]], "OVERWRITE");
      const info = await f.getSpreadsheet({
        ...T,
        fields: "sheets.properties.gridProperties.rowCount",
      });
      expect(
        info.sheets?.map((s) => s.properties?.gridProperties?.rowCount),
      ).toEqual([1001, 1000]);
    });

    it("an empty tab appends at row 1", async () => {
      const f = new FakeSheets();
      const r = await append(f, "'Sheet1'!A1", [["x"]]);
      expect(r.updates?.updatedRange).toBe("'Sheet1'!A1");
    });
  });

  describe("getSpreadsheet", () => {
    it("TAB_FIELDS returns only sheet ids and titles", async () => {
      const f = new FakeSheets({
        tabs: [
          { title: "A", sheetId: 0, rows: [["x"]] },
          { title: "B", sheetId: 7 },
        ],
      });
      expect(await f.getSpreadsheet({ ...T, fields: TAB_FIELDS })).toEqual({
        sheets: [
          { properties: { sheetId: 0, title: "A" } },
          { properties: { sheetId: 7, title: "B" } },
        ],
      });
    });

    it("INFO_FIELDS returns structure, never cell data, and omits defaults", async () => {
      const f = new FakeSheets({
        spreadsheetId: "fake-spreadsheet",
        title: "Book",
        tabs: [
          { title: "A", rows: [["x"]] },
          { title: "B", sheetId: 9 },
        ],
      });
      await batch(f, [
        {
          updateSheetProperties: {
            properties: {
              sheetId: 9,
              hidden: true,
              gridProperties: { frozenRowCount: 1 },
            },
            fields: "hidden,gridProperties.frozenRowCount",
          },
        },
        {
          addNamedRange: {
            namedRange: {
              name: "Totals",
              range: { sheetId: 9, startRowIndex: 0, endRowIndex: 2 },
            },
          },
        },
        {
          addProtectedRange: {
            protectedRange: { range: { sheetId: 9 }, description: "lock" },
          },
        },
      ]);
      const info = await f.getSpreadsheet({ ...T, fields: INFO_FIELDS });
      expect(JSON.stringify(info)).not.toContain('"x"');
      expect(info).toMatchObject({
        spreadsheetId: "fake-spreadsheet",
        properties: { title: "Book" },
        namedRanges: [
          { name: "Totals", range: { sheetId: 9, endRowIndex: 2 } },
        ],
      });
      expect(info.properties?.locale).toBeTruthy();
      expect(info.properties?.timeZone).toBeTruthy();
      const [a, b] = info.sheets ?? [];
      expect(a?.properties).toEqual({
        sheetId: a?.properties?.sheetId,
        title: "A",
        index: 0,
        gridProperties: { rowCount: 1000, columnCount: 26 },
      });
      expect(a).not.toHaveProperty("protectedRanges");
      expect(b?.properties).toEqual({
        sheetId: 9,
        title: "B",
        index: 1,
        hidden: true,
        gridProperties: { rowCount: 1000, columnCount: 26, frozenRowCount: 1 },
      });
      expect(b?.protectedRanges).toEqual([
        {
          protectedRangeId: b?.protectedRanges?.[0]?.protectedRangeId,
          range: { sheetId: 9 },
          description: "lock",
        },
      ]);
      expect(typeof b?.protectedRanges?.[0]?.protectedRangeId).toBe("number");
      expect(typeof info.namedRanges?.[0]?.namedRangeId).toBe("string");
    });
  });

  describe("batchUpdate", () => {
    it("addSheet assigns an id, honours index, replies with properties", async () => {
      const f = new FakeSheets();
      const out = await batch(f, [
        { addSheet: { properties: { title: "First", index: 0 } } },
        { addSheet: { properties: { title: "Mine", sheetId: 555 } } },
      ]);
      const first = out.replies?.[0]?.addSheet?.properties;
      expect(first?.title).toBe("First");
      expect(typeof first?.sheetId).toBe("number");
      expect(first?.sheetId).not.toBe(0);
      expect(out.replies?.[1]?.addSheet?.properties?.sheetId).toBe(555);
      expect(f.tab("First")?.index).toBe(0);
      expect(f.tab("Sheet1")?.index).toBe(1);
      expect(f.tab("Mine")).toMatchObject({ sheetId: 555, index: 2 });
      expect(f.appliedRequests).toHaveLength(2);
    });

    it("addSheet with a duplicate title (any case) or id → 400", async () => {
      const f = new FakeSheets();
      expect(
        await status(
          batch(f, [{ addSheet: { properties: { title: "sheet1" } } }]),
        ),
      ).toBe(400);
      expect(
        await status(
          batch(f, [{ addSheet: { properties: { title: "X", sheetId: 0 } } }]),
        ),
      ).toBe(400);
    });

    it("is atomic: a failing second request leaves the first unapplied", async () => {
      const f = new FakeSheets();
      const p = batch(f, [
        { addSheet: { properties: { title: "New" } } },
        { addSheet: { properties: { title: "Sheet1" } } },
      ]);
      expect(await status(p)).toBe(400);
      expect(f.tab("New")).toBeUndefined();
      expect(f.appliedRequests).toEqual([]);
    });

    it("a tab added earlier in the batch can be used later in it", async () => {
      const f = new FakeSheets();
      await batch(f, [
        { addSheet: { properties: { title: "New", sheetId: 10 } } },
        {
          mergeCells: {
            range: { sheetId: 10, startRowIndex: 0, endRowIndex: 1 },
            mergeType: "MERGE_ALL",
          },
        },
        { deleteSheet: { sheetId: 0 } },
      ]);
      expect(f.tab("Sheet1")).toBeUndefined();
      expect(f.tab("New")?.index).toBe(0);
    });

    it("deleteSheet: unknown id → 400; deleting the last tab → 400", async () => {
      const f = new FakeSheets();
      expect(await status(batch(f, [{ deleteSheet: { sheetId: 99 } }]))).toBe(
        400,
      );
      expect(await status(batch(f, [{ deleteSheet: { sheetId: 0 } }]))).toBe(
        400,
      );
    });

    it("updateSheetProperties honours fields", async () => {
      const f = new FakeSheets({
        tabs: [
          { title: "A", sheetId: 1 },
          { title: "B", sheetId: 2 },
        ],
      });
      await batch(f, [
        {
          updateSheetProperties: {
            properties: { sheetId: 1, title: "Renamed", hidden: true },
            fields: "title",
          },
        },
      ]);
      expect(f.tab("Renamed")).toMatchObject({ sheetId: 1, hidden: false });
      await batch(f, [
        {
          updateSheetProperties: {
            properties: {
              sheetId: 1,
              hidden: true,
              gridProperties: { frozenRowCount: 2, frozenColumnCount: 1 },
            },
            fields: "hidden,gridProperties(frozenRowCount,frozenColumnCount)",
          },
        },
      ]);
      expect(f.tab("Renamed")).toMatchObject({
        hidden: true,
        frozenRows: 2,
        frozenColumns: 1,
      });
      await batch(f, [
        {
          updateSheetProperties: {
            properties: { sheetId: 1 },
            fields: "hidden,gridProperties.frozenRowCount",
          },
        },
      ]);
      expect(f.tab("Renamed")).toMatchObject({
        hidden: false,
        frozenRows: 0,
        frozenColumns: 1,
      });
    });

    it("updateSheetProperties: rename to a taken title, missing fields, hiding every tab → 400", async () => {
      const f = new FakeSheets({
        tabs: [
          { title: "A", sheetId: 1 },
          { title: "B", sheetId: 2 },
        ],
      });
      const usp = (properties: object, fields?: string) =>
        batch(f, [{ updateSheetProperties: { properties, fields } }]);
      expect(await status(usp({ sheetId: 1, title: "b" }, "title"))).toBe(400);
      expect(await status(usp({ sheetId: 1, title: "C" }))).toBe(400);
      expect(await status(usp({ sheetId: 3, title: "C" }, "title"))).toBe(400);
      await usp({ sheetId: 1, hidden: true }, "hidden");
      expect(await status(usp({ sheetId: 2, hidden: true }, "hidden"))).toBe(
        400,
      );
    });

    it("updateSheetProperties index uses before-the-move positions", async () => {
      const f = new FakeSheets({
        tabs: [
          { title: "S1", sheetId: 1 },
          { title: "S2", sheetId: 2 },
          { title: "S3", sheetId: 3 },
        ],
      });
      const move = (sheetId: number, index: number) =>
        batch(f, [
          {
            updateSheetProperties: {
              properties: { sheetId, index },
              fields: "index",
            },
          },
        ]);
      await move(1, 2); // Google's docs: moving S1 ahead of S2 takes index 2
      expect([
        f.tab("S2")?.index,
        f.tab("S1")?.index,
        f.tab("S3")?.index,
      ]).toEqual([0, 1, 2]);
      await move(3, 0);
      expect([
        f.tab("S3")?.index,
        f.tab("S2")?.index,
        f.tab("S1")?.index,
      ]).toEqual([0, 1, 2]);
    });

    it("duplicateSheet copies cells and formulas", async () => {
      const f = new FakeSheets({
        tabs: [{ title: "Src", sheetId: 1, rows: [["a"]] }, { title: "Z" }],
      });
      await write(f, "'Src'!B1", [["=A1"]], "USER_ENTERED");
      const out = await batch(f, [
        {
          duplicateSheet: {
            sourceSheetId: 1,
            newSheetName: "Copy",
            newSheetId: 50,
          },
        },
        { duplicateSheet: { sourceSheetId: 1 } },
      ]);
      expect(out.replies?.[0]?.duplicateSheet?.properties).toMatchObject({
        sheetId: 50,
        title: "Copy",
      });
      expect(f.values("Copy")).toEqual([["a", ""]]);
      expect(f.formulaAt("Copy", "B1")).toBe("=A1");
      expect(out.replies?.[1]?.duplicateSheet?.properties?.title).toBe(
        "Copy of Src",
      );
      await write(f, "'Copy'!A1", [["changed"]]);
      expect(f.values("Src")).toEqual([["a", ""]]);
      expect(
        await status(
          batch(f, [
            { duplicateSheet: { sourceSheetId: 1, newSheetName: "copy" } },
          ]),
        ),
      ).toBe(400);
    });

    it("insertDimension and deleteDimension shift rows and columns (0-based half-open)", async () => {
      const f = new FakeSheets({
        tabs: [
          {
            title: "T",
            sheetId: 1,
            rows: [
              ["a1", "b1", "c1"],
              ["a2", "b2", "c2"],
              ["a3", "b3", "c3"],
            ],
          },
        ],
      });
      await batch(f, [
        {
          insertDimension: {
            range: {
              sheetId: 1,
              dimension: "ROWS",
              startIndex: 1,
              endIndex: 3,
            },
          },
        },
      ]);
      expect(f.values("T")).toEqual([
        ["a1", "b1", "c1"],
        [],
        [],
        ["a2", "b2", "c2"],
        ["a3", "b3", "c3"],
      ]);
      await batch(f, [
        {
          deleteDimension: {
            range: {
              sheetId: 1,
              dimension: "ROWS",
              startIndex: 1,
              endIndex: 3,
            },
          },
        },
        {
          deleteDimension: {
            range: {
              sheetId: 1,
              dimension: "COLUMNS",
              startIndex: 0,
              endIndex: 1,
            },
          },
        },
        {
          insertDimension: {
            range: {
              sheetId: 1,
              dimension: "COLUMNS",
              startIndex: 1,
              endIndex: 2,
            },
          },
        },
      ]);
      expect(f.values("T")).toEqual([
        ["b1", "", "c1"],
        ["b2", "", "c2"],
        ["b3", "", "c3"],
      ]);
      const info = await f.getSpreadsheet({
        ...T,
        fields: "sheets.properties.gridProperties",
      });
      expect(info.sheets?.[0]?.properties?.gridProperties).toEqual({
        rowCount: 1000,
        columnCount: 26,
      });
    });

    it("dimension requests out of bounds or deleting every row → 400", async () => {
      const f = new FakeSheets({ tabs: [{ title: "T", sheetId: 1 }] });
      const dim = (key: string, startIndex: number, endIndex: number) =>
        batch(f, [
          {
            [key]: {
              range: { sheetId: 1, dimension: "ROWS", startIndex, endIndex },
            },
          },
        ]);
      expect(await status(dim("insertDimension", 1001, 1002))).toBe(400);
      expect(await status(dim("deleteDimension", 999, 1001))).toBe(400);
      expect(await status(dim("deleteDimension", 2, 2))).toBe(400);
      expect(await status(dim("deleteDimension", 0, 1000))).toBe(400);
      expect(
        await status(
          dim("insertDimension", 0, 1).then(() => dim("deleteDimension", 0, 1)),
        ),
      ).toBe(0);
    });

    it("named ranges: add (reply carries id), duplicate name → 400, delete, unknown id → 400", async () => {
      const f = new FakeSheets();
      const out = await batch(f, [
        {
          addNamedRange: {
            namedRange: {
              name: "Totals",
              range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            },
          },
        },
      ]);
      const id = out.replies?.[0]?.addNamedRange?.namedRange?.namedRangeId;
      expect(typeof id).toBe("string");
      expect(
        await status(
          batch(f, [
            {
              addNamedRange: {
                namedRange: { name: "totals", range: { sheetId: 0 } },
              },
            },
          ]),
        ),
      ).toBe(400);
      expect(
        await status(
          batch(f, [
            {
              addNamedRange: {
                namedRange: { name: "Bad Name", range: { sheetId: 0 } },
              },
            },
          ]),
        ),
      ).toBe(400);
      expect(
        await status(
          batch(f, [
            {
              addNamedRange: {
                namedRange: { name: "Ok", range: { sheetId: 77 } },
              },
            },
          ]),
        ),
      ).toBe(400);
      await batch(f, [{ deleteNamedRange: { namedRangeId: id } }]);
      const info = await f.getSpreadsheet({ ...T, fields: INFO_FIELDS });
      expect(info.namedRanges ?? []).toEqual([]);
      expect(
        await status(batch(f, [{ deleteNamedRange: { namedRangeId: id } }])),
      ).toBe(400);
    });

    it("protected ranges: add (reply carries id), delete, unknown id → 400", async () => {
      const f = new FakeSheets();
      const out = await batch(f, [
        {
          addProtectedRange: {
            protectedRange: { range: { sheetId: 0 }, warningOnly: true },
          },
        },
      ]);
      const pr = out.replies?.[0]?.addProtectedRange?.protectedRange;
      // Like Google, a zero sheetId is omitted from GridRanges in responses.
      expect(pr).toMatchObject({ range: {}, warningOnly: true });
      expect(pr?.range).not.toHaveProperty("sheetId");
      expect(typeof pr?.protectedRangeId).toBe("number");
      await batch(f, [
        { deleteProtectedRange: { protectedRangeId: pr?.protectedRangeId } },
      ]);
      expect(
        await status(
          batch(f, [
            {
              deleteProtectedRange: { protectedRangeId: pr?.protectedRangeId },
            },
          ]),
        ),
      ).toBe(400);
    });

    it("visual requests are recorded only, replying {}", async () => {
      const f = new FakeSheets({
        tabs: [{ title: "T", sheetId: 1, rows: [["a"]] }],
      });
      const requests = [
        {
          updateDimensionProperties: {
            range: { sheetId: 1, dimension: "COLUMNS" },
            properties: { pixelSize: 90 },
            fields: "pixelSize",
          },
        },
        {
          autoResizeDimensions: {
            dimensions: { sheetId: 1, dimension: "COLUMNS" },
          },
        },
        {
          repeatCell: {
            range: { sheetId: 1 },
            cell: { userEnteredFormat: {} },
            fields: "userEnteredFormat",
          },
        },
        { sortRange: { range: { sheetId: 1 }, sortSpecs: [] } },
        { setBasicFilter: { filter: { range: { sheetId: 1 } } } },
        { clearBasicFilter: { sheetId: 1 } },
        { unmergeCells: { range: { sheetId: 1 } } },
        { copyPaste: { source: { sheetId: 1 }, destination: { sheetId: 1 } } },
      ];
      const out = await batch(f, requests);
      expect(out.replies).toEqual(requests.map(() => ({})));
      expect(f.appliedRequests).toEqual(requests);
      expect(f.values("T")).toEqual([["a"]]);
    });

    it("a recorded-only request naming an unknown sheetId → 400", async () => {
      const f = new FakeSheets();
      expect(
        await status(batch(f, [{ mergeCells: { range: { sheetId: 5 } } }])),
      ).toBe(400);
    });

    it("empty, multi-key or unknown-key requests → 400", async () => {
      const f = new FakeSheets();
      expect(await status(batch(f, [{}]))).toBe(400);
      expect(
        await status(
          batch(f, [
            { deleteSheet: { sheetId: 0 }, clearBasicFilter: { sheetId: 0 } },
          ]),
        ),
      ).toBe(400);
      expect(await status(batch(f, [{ notARequest: {} }]))).toBe(400);
      expect(f.tab("Sheet1")).toBeDefined();
    });

    it("returned replies are clones", async () => {
      const f = new FakeSheets();
      const out = await batch(f, [
        { addSheet: { properties: { title: "N", sheetId: 3 } } },
      ]);
      out.replies![0]!.addSheet!.properties!.title = "mutated";
      expect(f.tab("N")).toBeDefined();
      const req = { addSheet: { properties: { title: "M", sheetId: 4 } } };
      await batch(f, [req]);
      req.addSheet.properties.title = "mutated";
      expect(f.appliedRequests[1]).toEqual({
        addSheet: { properties: { title: "M", sheetId: 4 } },
      });
    });
  });

  describe("calls and failure injection", () => {
    it("records every call with ranges, input option and request count", async () => {
      const f = new FakeSheets({ tabs: [{ title: "T" }] });
      await f.getSpreadsheet({ ...T, fields: TAB_FIELDS });
      await write(f, "'T'!A1", [["a"]], "USER_ENTERED");
      await f.valuesBatchGet({
        ...T,
        ranges: ["'T'!A1", "'T'!B1"],
        valueRenderOption: "FORMULA",
      });
      await append(f, "'T'", [["b"]]);
      await f.valuesBatchClear({ ...T, ranges: ["'T'!A1"] });
      await batch(f, [{ clearBasicFilter: { sheetId: 0 } }]).catch(
        () => undefined,
      );
      expect(f.calls).toEqual([
        { op: "getSpreadsheet" },
        {
          op: "valuesUpdate",
          ranges: ["'T'!A1"],
          valueInputOption: "USER_ENTERED",
        },
        { op: "valuesBatchGet", ranges: ["'T'!A1", "'T'!B1"] },
        { op: "valuesAppend", ranges: ["'T'"], valueInputOption: "RAW" },
        { op: "valuesBatchClear", ranges: ["'T'!A1"] },
        { op: "batchUpdate", requests: 1 },
      ]);
    });

    it("failNext throws before applying by default", async () => {
      const f = new FakeSheets({ tabs: [{ title: "Log", rows: [["h"]] }] });
      const err = sheetsHttpError(503, "backendError", "unavailable");
      f.failNext("valuesAppend", err);
      await expect(append(f, "'Log'", [["x"]])).rejects.toBe(err);
      expect(f.values("Log")).toEqual([["h"]]);
      await append(f, "'Log'", [["y"]]);
      expect(f.values("Log")).toEqual([["h"], ["y"]]);
    });

    it("failNext afterApply on valuesAppend applies the rows and throws", async () => {
      const f = new FakeSheets({ tabs: [{ title: "Log", rows: [["h"]] }] });
      const err = new Error("socket reset");
      f.failNext("valuesAppend", err, { afterApply: true });
      await expect(append(f, "'Log'", [["x"]])).rejects.toBe(err);
      expect(f.values("Log")).toEqual([["h"], ["x"]]);
    });

    it("failNext on batchUpdate: before apply records nothing, afterApply commits", async () => {
      const f = new FakeSheets();
      f.failNext("batchUpdate", new Error("before"));
      await expect(
        batch(f, [{ addSheet: { properties: { title: "A" } } }]),
      ).rejects.toThrow("before");
      expect(f.tab("A")).toBeUndefined();
      expect(f.appliedRequests).toEqual([]);
      f.failNext("batchUpdate", new Error("after"), { afterApply: true });
      await expect(
        batch(f, [{ addSheet: { properties: { title: "A" } } }]),
      ).rejects.toThrow("after");
      expect(f.tab("A")).toBeDefined();
      expect(f.appliedRequests).toHaveLength(1);
    });

    it("failures queue per op", async () => {
      const f = new FakeSheets();
      f.failNext("getSpreadsheet", new Error("one"));
      f.failNext("getSpreadsheet", new Error("two"));
      await expect(
        f.getSpreadsheet({ ...T, fields: TAB_FIELDS }),
      ).rejects.toThrow("one");
      await expect(
        f.getSpreadsheet({ ...T, fields: TAB_FIELDS }),
      ).rejects.toThrow("two");
      await expect(
        f.getSpreadsheet({ ...T, fields: TAB_FIELDS }),
      ).resolves.toBeDefined();
    });
  });
});
