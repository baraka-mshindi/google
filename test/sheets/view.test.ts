import { describe, expect, it } from "vitest";
import { appendResult } from "../../src/sheets/view.js";

describe("appendResult", () => {
  it("reads the rows from Google's updatedRange", () => {
    expect(appendResult("'Q1 2026'!A5:C6")).toEqual({
      range: "'Q1 2026'!A5:C6",
      firstRow: 5,
      lastRow: 6,
    });
    expect(appendResult("Log!A7")).toEqual({
      range: "Log!A7",
      firstRow: 7,
      lastRow: 7,
    });
  });

  it("an unparseable or missing range gives rows 0 instead of throwing", () => {
    for (const range of ["no-tab", "Log!garbage", "'unterminated", ""]) {
      expect(appendResult(range)).toEqual({ range, firstRow: 0, lastRow: 0 });
    }
    expect(appendResult(undefined)).toEqual({
      range: "",
      firstRow: 0,
      lastRow: 0,
    });
  });
});
