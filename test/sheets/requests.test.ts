import { describe, expect, it } from "vitest";
import { InvalidSheetsInputError } from "../../src/core/errors.js";
import { req, toGridRange } from "../../src/sheets/requests.js";
import { SHEETS_REQUEST } from "../../src/sheets/types.js";
import type { ResolveCtx, TabRef } from "../../src/sheets/types.js";

const ctx: ResolveCtx = {
  sheetId(tab: TabRef): number {
    if (typeof tab !== "string") return tab.sheetId;
    if (tab === "Log") return 7;
    if (tab === "Other") return 8;
    throw new Error(`unknown tab ${tab}`);
  },
};

function fieldOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidSheetsInputError);
    return (err as InvalidSheetsInputError).field;
  }
  throw new Error("expected throw");
}

describe("toGridRange", () => {
  it("converts 1-based A1 to 0-based half-open", () => {
    expect(toGridRange(7, "A1:C3")).toEqual({
      sheetId: 7,
      startRowIndex: 0,
      endRowIndex: 3,
      startColumnIndex: 0,
      endColumnIndex: 3,
    });
  });
  it("omits open ends", () => {
    expect(toGridRange(7, "A2:C")).toEqual({
      sheetId: 7,
      startRowIndex: 1,
      startColumnIndex: 0,
      endColumnIndex: 3,
    });
    expect(toGridRange(7, "B:D")).toEqual({
      sheetId: 7,
      startColumnIndex: 1,
      endColumnIndex: 4,
    });
  });
  it("null means the whole tab", () => {
    expect(toGridRange(7, null)).toEqual({ sheetId: 7 });
  });
  it("rejects bad ranges", () => {
    expect(fieldOf(() => toGridRange(7, "!!"))).toBe("range");
  });
});

describe("marker and refs", () => {
  it("carries the SHEETS_REQUEST marker", () => {
    expect(req.deleteTab("Log")[SHEETS_REQUEST]).toBe(true);
  });
  it("lists every touched tab", () => {
    expect(req.deleteTab("Log").refs).toEqual(["Log"]);
    expect(
      req.copyPaste(
        { tab: "Log", range: "A1" },
        { tab: { sheetId: 0 }, range: "B1" },
      ).refs,
    ).toEqual(["Log", { sheetId: 0 }]);
    expect(req.addTab("New").refs).toEqual([]);
    expect(req.addNamedRange("n", "Log", "A1").refs).toEqual(["Log"]);
    expect(req.deleteNamedRange("x").refs).toEqual([]);
    expect(req.unprotect(3).refs).toEqual([]);
    expect(req.raw({ deleteSheet: { sheetId: 1 } }).refs).toEqual([]);
  });
});

describe("tab builders", () => {
  it("addTab exposes adds and uses the assigned sheetId", () => {
    const r = req.addTab("New");
    expect(r.adds).toEqual({ title: "New" });
    expect(r.build(ctx, 99)).toEqual({
      addSheet: { properties: { title: "New", sheetId: 99 } },
    });
    expect(r.build(ctx)).toEqual({
      addSheet: { properties: { title: "New" } },
    });
  });
  it("addTab honors explicit sheetId, index and grid size", () => {
    const r = req.addTab("New", { sheetId: 5, index: 0, rows: 10, columns: 4 });
    expect(r.adds).toEqual({ title: "New", sheetId: 5 });
    expect(r.build(ctx, 99)).toEqual({
      addSheet: {
        properties: {
          title: "New",
          sheetId: 5,
          index: 0,
          gridProperties: { rowCount: 10, columnCount: 4 },
        },
      },
    });
  });
  it("deleteTab / renameTab / hideTab / showTab / moveTab", () => {
    expect(req.deleteTab("Log").build(ctx)).toEqual({
      deleteSheet: { sheetId: 7 },
    });
    expect(req.renameTab("Log", "New").build(ctx)).toEqual({
      updateSheetProperties: {
        properties: { sheetId: 7, title: "New" },
        fields: "title",
      },
    });
    expect(req.hideTab("Log").build(ctx)).toEqual({
      updateSheetProperties: {
        properties: { sheetId: 7, hidden: true },
        fields: "hidden",
      },
    });
    expect(req.showTab({ sheetId: 0 }).build(ctx)).toEqual({
      updateSheetProperties: {
        properties: { sheetId: 0, hidden: false },
        fields: "hidden",
      },
    });
    expect(req.moveTab("Log", 0).build(ctx)).toEqual({
      updateSheetProperties: {
        properties: { sheetId: 7, index: 0 },
        fields: "index",
      },
    });
  });
  it("duplicateTab", () => {
    expect(req.duplicateTab("Log", "Copy", { index: 2 }).build(ctx)).toEqual({
      duplicateSheet: {
        sourceSheetId: 7,
        newSheetName: "Copy",
        insertSheetIndex: 2,
      },
    });
    expect(req.duplicateTab("Log", "Copy").build(ctx)).toEqual({
      duplicateSheet: { sourceSheetId: 7, newSheetName: "Copy" },
    });
  });
});

describe("row and column builders", () => {
  it("insertRows inserts before the 1-based row", () => {
    expect(req.insertRows("Log", 3, 2).build(ctx)).toEqual({
      insertDimension: {
        range: { sheetId: 7, dimension: "ROWS", startIndex: 2, endIndex: 4 },
        inheritFromBefore: false,
      },
    });
  });
  it("insertColumns accepts a letter or number", () => {
    const expected = {
      insertDimension: {
        range: {
          sheetId: 7,
          dimension: "COLUMNS",
          startIndex: 2,
          endIndex: 4,
        },
        inheritFromBefore: false,
      },
    };
    expect(req.insertColumns("Log", "C", 2).build(ctx)).toEqual(expected);
    expect(req.insertColumns("Log", 3, 2).build(ctx)).toEqual(expected);
  });
  it("deleteRows / deleteColumns", () => {
    expect(req.deleteRows("Log", 5, 2).build(ctx)).toEqual({
      deleteDimension: {
        range: { sheetId: 7, dimension: "ROWS", startIndex: 4, endIndex: 6 },
      },
    });
    expect(req.deleteColumns("Log", "b", 1).build(ctx)).toEqual({
      deleteDimension: {
        range: {
          sheetId: 7,
          dimension: "COLUMNS",
          startIndex: 1,
          endIndex: 2,
        },
      },
    });
  });
  it("setColumnWidth accepts a letter range or a pair", () => {
    const expected = {
      updateDimensionProperties: {
        range: {
          sheetId: 7,
          dimension: "COLUMNS",
          startIndex: 1,
          endIndex: 4,
        },
        properties: { pixelSize: 120 },
        fields: "pixelSize",
      },
    };
    expect(req.setColumnWidth("Log", "B:D", 120).build(ctx)).toEqual(expected);
    expect(req.setColumnWidth("Log", [2, 4], 120).build(ctx)).toEqual(expected);
  });
  it("setRowHeight", () => {
    expect(req.setRowHeight("Log", [1, 1], 40).build(ctx)).toEqual({
      updateDimensionProperties: {
        range: { sheetId: 7, dimension: "ROWS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 40 },
        fields: "pixelSize",
      },
    });
  });
  it("autoResizeColumns", () => {
    expect(req.autoResizeColumns("Log", "A:C").build(ctx)).toEqual({
      autoResizeDimensions: {
        dimensions: {
          sheetId: 7,
          dimension: "COLUMNS",
          startIndex: 0,
          endIndex: 3,
        },
      },
    });
  });
  it("freeze sets only the given fields", () => {
    expect(req.freeze("Log", { rows: 1 }).build(ctx)).toEqual({
      updateSheetProperties: {
        properties: { sheetId: 7, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    });
    expect(req.freeze("Log", { rows: 0, columns: 2 }).build(ctx)).toEqual({
      updateSheetProperties: {
        properties: {
          sheetId: 7,
          gridProperties: { frozenRowCount: 0, frozenColumnCount: 2 },
        },
        fields:
          "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
      },
    });
  });
});

describe("cell builders", () => {
  it("merge / unmerge", () => {
    expect(req.merge("Log", "A1:C1").build(ctx)).toEqual({
      mergeCells: {
        range: {
          sheetId: 7,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 3,
        },
        mergeType: "MERGE_ALL",
      },
    });
    const cols = req.merge("Log", "A1:C2", "columns").build(ctx);
    expect(cols.mergeCells?.mergeType).toBe("MERGE_COLUMNS");
    const rows = req.merge("Log", "A1:C2", "rows").build(ctx);
    expect(rows.mergeCells?.mergeType).toBe("MERGE_ROWS");
    expect(req.unmerge("Log", "A1:C1").build(ctx)).toEqual({
      unmergeCells: { range: toGridRange(7, "A1:C1") },
    });
  });
  it("format defaults fields to userEnteredFormat", () => {
    const fmt = { textFormat: { bold: true } };
    expect(req.format("Log", "A1:C1", fmt).build(ctx)).toEqual({
      repeatCell: {
        range: toGridRange(7, "A1:C1"),
        cell: { userEnteredFormat: fmt },
        fields: "userEnteredFormat",
      },
    });
    expect(
      req.format("Log", "A1", fmt, "userEnteredFormat.textFormat").build(ctx)
        .repeatCell?.fields,
    ).toBe("userEnteredFormat.textFormat");
  });
  it("copyPaste resolves both tabs", () => {
    expect(
      req
        .copyPaste(
          { tab: "Log", range: "A1:B2" },
          { tab: "Other", range: "D1" },
          "values",
        )
        .build(ctx),
    ).toEqual({
      copyPaste: {
        source: toGridRange(7, "A1:B2"),
        destination: toGridRange(8, "D1"),
        pasteType: "PASTE_VALUES",
      },
    });
    expect(
      req
        .copyPaste({ tab: "Log", range: "A1" }, { tab: "Log", range: "B1" })
        .build(ctx).copyPaste?.pasteType,
    ).toBe("PASTE_NORMAL");
  });
  it("sort uses absolute 0-based column indexes", () => {
    expect(
      req
        .sort("Log", "A2:D", [
          { column: "C" },
          { column: "A", ascending: false },
        ])
        .build(ctx),
    ).toEqual({
      sortRange: {
        range: toGridRange(7, "A2:D"),
        sortSpecs: [
          { dimensionIndex: 2, sortOrder: "ASCENDING" },
          { dimensionIndex: 0, sortOrder: "DESCENDING" },
        ],
      },
    });
  });
});

describe("filters, names, protection", () => {
  it("basic filter", () => {
    expect(req.setBasicFilter("Log", "A1:D").build(ctx)).toEqual({
      setBasicFilter: { filter: { range: toGridRange(7, "A1:D") } },
    });
    expect(req.clearBasicFilter("Log").build(ctx)).toEqual({
      clearBasicFilter: { sheetId: 7 },
    });
  });
  it("named ranges", () => {
    expect(req.addNamedRange("Totals", "Log", "A1:A9").build(ctx)).toEqual({
      addNamedRange: {
        namedRange: { name: "Totals", range: toGridRange(7, "A1:A9") },
      },
    });
    expect(req.deleteNamedRange("abc").build(ctx)).toEqual({
      deleteNamedRange: { namedRangeId: "abc" },
    });
  });
  it("protect / unprotect", () => {
    expect(req.protect("Log").build(ctx)).toEqual({
      addProtectedRange: { protectedRange: { range: { sheetId: 7 } } },
    });
    expect(
      req
        .protect("Log", {
          range: "A1:B2",
          description: "d",
          warningOnly: true,
          editors: ["a@x.com"],
        })
        .build(ctx),
    ).toEqual({
      addProtectedRange: {
        protectedRange: {
          range: toGridRange(7, "A1:B2"),
          description: "d",
          warningOnly: true,
          editors: { users: ["a@x.com"] },
        },
      },
    });
    expect(req.unprotect(12).build(ctx)).toEqual({
      deleteProtectedRange: { protectedRangeId: 12 },
    });
  });
});

describe("raw", () => {
  it("passes a single-key request through", () => {
    const r = { updateSpreadsheetProperties: { fields: "title" } };
    expect(req.raw(r).build(ctx)).toBe(r);
  });
  it("rejects anything but a one-key object", () => {
    expect(fieldOf(() => req.raw({}))).toBe("request");
    expect(fieldOf(() => req.raw({ a: {}, b: {} } as never))).toBe("request");
    expect(fieldOf(() => req.raw(null as never))).toBe("request");
    expect(fieldOf(() => req.raw([] as never))).toBe("request");
  });
});

describe("validation at call time", () => {
  it("rows and columns", () => {
    expect(fieldOf(() => req.deleteRows("Log", 0, 1))).toBe("from");
    expect(fieldOf(() => req.deleteRows("Log", 1, 0))).toBe("count");
    expect(fieldOf(() => req.deleteRows("Log", 1.5, 1))).toBe("from");
    expect(fieldOf(() => req.insertRows("Log", 0, 1))).toBe("at");
    expect(fieldOf(() => req.insertColumns("Log", "1", 1))).toBe("at");
    expect(fieldOf(() => req.insertColumns("Log", 0, 1))).toBe("at");
    expect(fieldOf(() => req.deleteColumns("Log", "", 1))).toBe("from");
    expect(fieldOf(() => req.setColumnWidth("Log", "B2:D3", 10))).toBe(
      "columns",
    );
    expect(fieldOf(() => req.setColumnWidth("Log", [4, 2], 10))).toBe(
      "columns",
    );
    expect(fieldOf(() => req.setColumnWidth("Log", [0, 2], 10))).toBe(
      "columns",
    );
    expect(fieldOf(() => req.setColumnWidth("Log", "B:D", 0))).toBe("px");
    expect(fieldOf(() => req.setRowHeight("Log", [1, 2], 10001))).toBe("px");
    expect(fieldOf(() => req.setRowHeight("Log", [0, 2], 10))).toBe("rows");
    expect(fieldOf(() => req.autoResizeColumns("Log", "nope!"))).toBe(
      "columns",
    );
  });
  it("tabs and titles", () => {
    expect(fieldOf(() => req.deleteTab(""))).toBe("tab");
    expect(fieldOf(() => req.deleteTab({ sheetId: -1 }))).toBe("tab");
    expect(fieldOf(() => req.addTab(""))).toBe("title");
    expect(fieldOf(() => req.renameTab("Log", ""))).toBe("title");
    expect(fieldOf(() => req.duplicateTab("Log", ""))).toBe("newTitle");
    expect(fieldOf(() => req.moveTab("Log", -1))).toBe("index");
    expect(fieldOf(() => req.addTab("X", { index: -1 }))).toBe("index");
    expect(fieldOf(() => req.addTab("X", { rows: 0 }))).toBe("rows");
    expect(fieldOf(() => req.addTab("X", { columns: 1.5 }))).toBe("columns");
    expect(fieldOf(() => req.addTab("X", { sheetId: -1 }))).toBe("sheetId");
  });
  it("freeze, ranges, sort, names, protect", () => {
    expect(fieldOf(() => req.freeze("Log", {}))).toBe("freeze");
    expect(fieldOf(() => req.freeze("Log", { rows: -1 }))).toBe("rows");
    expect(fieldOf(() => req.merge("Log", "garbage!"))).toBe("range");
    expect(fieldOf(() => req.merge("Log", "A1:B2", "x" as never))).toBe("type");
    expect(fieldOf(() => req.format("Log", "A1", {}, ""))).toBe("fields");
    expect(fieldOf(() => req.sort("Log", "A1:B2", [{ column: "1" }]))).toBe(
      "specs",
    );
    expect(fieldOf(() => req.sort("Log", "A1:B2", []))).toBe("specs");
    expect(fieldOf(() => req.addNamedRange("1bad", "Log", "A1"))).toBe("name");
    expect(fieldOf(() => req.addNamedRange("a-b", "Log", "A1"))).toBe("name");
    // Names Google refuses because they read as references or booleans.
    for (const name of [
      "A1",
      "xfd99",
      "ZZZ1",
      "R1C1",
      "r2c",
      "RC",
      "R5C",
      "true",
      "FALSE",
    ]) {
      expect(
        fieldOf(() => req.addNamedRange(name, "Log", "A1")),
        name,
      ).toBe("name");
    }
    for (const name of ["AAAA1", "R1C1x", "Totals_2026", "_A1", "A1_"]) {
      expect(() => req.addNamedRange(name, "Log", "A1"), name).not.toThrow();
    }
    expect(fieldOf(() => req.deleteNamedRange(""))).toBe("namedRangeId");
    expect(fieldOf(() => req.unprotect(1.5))).toBe("protectedRangeId");
    expect(fieldOf(() => req.protect("Log", { range: "" }))).toBe("range");
    expect(
      fieldOf(() =>
        req.copyPaste({ tab: "", range: "A1" }, { tab: "Log", range: "A1" }),
      ),
    ).toBe("from");
    expect(
      fieldOf(() =>
        req.copyPaste(
          { tab: "Log", range: "A1" },
          { tab: "Log", range: "A1" },
          "x" as never,
        ),
      ),
    ).toBe("pasteType");
  });
});
