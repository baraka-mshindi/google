import { describe, expect, it } from "vitest";
import { InvalidSheetsInputError } from "../../src/core/errors.js";
import { a1 } from "../../src/sheets/a1.js";

function fieldOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidSheetsInputError);
    return (err as InvalidSheetsInputError).field;
  }
  throw new Error("expected throw");
}

describe("a1.quoteTab", () => {
  it("always quotes and doubles apostrophes", () => {
    expect(a1.quoteTab("Sheet1")).toBe("'Sheet1'");
    expect(a1.quoteTab("Bob's")).toBe("'Bob''s'");
    expect(a1.quoteTab("A1")).toBe("'A1'");
  });
  it("rejects an empty title", () => {
    expect(fieldOf(() => a1.quoteTab(""))).toBe("tab");
  });
});

describe("a1.range", () => {
  it("joins tab and range", () => {
    expect(a1.range("Q1 2026", "A1:B2")).toBe("'Q1 2026'!A1:B2");
    expect(a1.range("Q1 2026")).toBe("'Q1 2026'");
  });
});

describe("a1.split", () => {
  it("splits unquoted and quoted refs", () => {
    expect(a1.split("Sheet1!A1:B2")).toEqual({ tab: "Sheet1", range: "A1:B2" });
    expect(a1.split("'Q1 2026'!A:A")).toEqual({ tab: "Q1 2026", range: "A:A" });
    expect(a1.split("'It''s'!B2")).toEqual({ tab: "It's", range: "B2" });
    expect(a1.split("'Log'")).toEqual({ tab: "Log", range: null });
  });
  it("handles a quoted tab containing '!'", () => {
    expect(a1.split("'Hi!'!A1")).toEqual({ tab: "Hi!", range: "A1" });
  });
  it("requires a tab", () => {
    expect(fieldOf(() => a1.split("A1:B2"))).toBe("range");
    expect(fieldOf(() => a1.split("'Log"))).toBe("range");
    expect(fieldOf(() => a1.split("!A1"))).toBe("range");
  });
});

describe("a1.parse", () => {
  it("parses cells, ranges, and open ranges", () => {
    expect(a1.parse("B2")).toEqual({
      startRow: 2,
      endRow: 2,
      startColumn: 2,
      endColumn: 2,
    });
    expect(a1.parse("A1:C10")).toEqual({
      startRow: 1,
      endRow: 10,
      startColumn: 1,
      endColumn: 3,
    });
    expect(a1.parse("B:D")).toEqual({
      startRow: null,
      endRow: null,
      startColumn: 2,
      endColumn: 4,
    });
    expect(a1.parse("2:5")).toEqual({
      startRow: 2,
      endRow: 5,
      startColumn: null,
      endColumn: null,
    });
    expect(a1.parse("A2:C")).toEqual({
      startRow: 2,
      endRow: null,
      startColumn: 1,
      endColumn: 3,
    });
  });
  it("normalises reversed bounds", () => {
    expect(a1.parse("C3:A1")).toEqual({
      startRow: 1,
      endRow: 3,
      startColumn: 1,
      endColumn: 3,
    });
  });
  it("accepts only cell:cell, column:column, row:row and cell:column pairs", () => {
    for (const ok of ["A1:B2", "A:C", "2:5", "A2:C", "B2"]) {
      expect(() => a1.parse(ok)).not.toThrow();
    }
    // Google answers "Unable to parse range" for these, which would read as a
    // missing tab; reject them locally instead.
    for (const bad of ["2:A", "A:2", "A1:5", "5:A1", "A:C5", "B:A1"]) {
      expect(
        fieldOf(() => a1.parse(bad)),
        bad,
      ).toBe("range");
    }
  });
  it("rejects malformed ranges", () => {
    for (const bad of ["A0", "1A", "A1:", "", ":A1", "AAAA1", "A1:B2:C3"]) {
      expect(fieldOf(() => a1.parse(bad))).toBe("range");
    }
  });
});

describe("a1 column conversion", () => {
  it("maps known columns", () => {
    expect(a1.columnToIndex("A")).toBe(1);
    expect(a1.columnToIndex("Z")).toBe(26);
    expect(a1.columnToIndex("AA")).toBe(27);
    expect(a1.columnToIndex("aa")).toBe(27);
    expect(a1.indexToColumn(1)).toBe("A");
    expect(a1.indexToColumn(27)).toBe("AA");
    expect(a1.indexToColumn(18278)).toBe("ZZZ");
  });
  it("round-trips 1..18278", () => {
    for (let n = 1; n <= 18278; n++) {
      expect(a1.columnToIndex(a1.indexToColumn(n))).toBe(n);
    }
  });
  it("rejects out-of-range input", () => {
    expect(fieldOf(() => a1.indexToColumn(0))).toBe("range");
    expect(fieldOf(() => a1.indexToColumn(18279))).toBe("range");
    expect(fieldOf(() => a1.columnToIndex(""))).toBe("range");
    expect(fieldOf(() => a1.columnToIndex("A1"))).toBe("range");
  });
});
