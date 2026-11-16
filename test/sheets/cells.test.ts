import { describe, expect, it } from "vitest";
import { InvalidSheetsInputError } from "../../src/core/errors.js";
import { encodeRows } from "../../src/sheets/cells.js";
import type { CellInput } from "../../src/sheets/types.js";

function fieldOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidSheetsInputError);
    return (err as InvalidSheetsInputError).field;
  }
  throw new Error("expected throw");
}

describe("encodeRows without formulas", () => {
  it("raw mode sends RAW with values unchanged and null as empty", () => {
    expect(encodeRows([["=1+1", 2, true, null, ""]], "raw")).toEqual({
      valueInputOption: "RAW",
      values: [["=1+1", 2, true, "", ""]],
    });
  });
});

describe("encodeRows with a formula under raw", () => {
  const out = encodeRows(
    [
      [{ formula: '=HYPERLINK("u","P")' }, "=1+1", "+254 712", "-5"],
      ["1/2", "5%", "TRUE", "'quoted"],
      ["", 7, false, null],
    ],
    "raw",
  );
  it("switches to USER_ENTERED", () => {
    expect(out.valueInputOption).toBe("USER_ENTERED");
  });
  it("sends the formula as-is and prefixes plain strings", () => {
    expect(out.values).toEqual([
      ['=HYPERLINK("u","P")', "'=1+1", "'+254 712", "'-5"],
      ["'1/2", "'5%", "'TRUE", "''quoted"],
      ["", 7, false, ""],
    ]);
  });
});

describe("encodeRows in user_entered mode", () => {
  it("leaves strings unprefixed and formulas as-is", () => {
    expect(
      encodeRows([["=1+1", { formula: "=SUM(A1)" }, null, 3]], "user_entered"),
    ).toEqual({
      valueInputOption: "USER_ENTERED",
      values: [["=1+1", "=SUM(A1)", "", 3]],
    });
  });
});

describe("encodeRows validation", () => {
  const bad = (rows: unknown, field?: string) =>
    fieldOf(() => encodeRows(rows as CellInput[][], "raw", field));

  it("rejects bad shapes with the default field", () => {
    expect(bad("x")).toBe("values");
    expect(bad([])).toBe("values");
    expect(bad([[]])).toBe("values");
    expect(bad(["a"])).toBe("values");
  });
  it("rejects bad cells", () => {
    expect(bad([[undefined]])).toBe("values");
    expect(bad([[Number.NaN]])).toBe("values");
    expect(bad([[Number.POSITIVE_INFINITY]])).toBe("values");
    expect(bad([[{}]])).toBe("values");
    expect(bad([[{ other: 1 }]])).toBe("values");
    expect(bad([[{ formula: "SUM(A1)" }]])).toBe("values");
    expect(bad([[{ formula: 42 }]])).toBe("values");
    expect(bad([[[1]]])).toBe("values");
  });
  it("uses a custom field name", () => {
    expect(bad([], "rows")).toBe("rows");
  });
  it("rejects empty formulas", () => {
    expect(bad([[{ formula: "=" }]])).toBe("values");
    expect(bad([[{ formula: "=   " }]])).toBe("values");
  });
  it("fails closed on an unknown input mode", () => {
    const rows: CellInput[][] = [["=1+1", { formula: "=A1" }]];
    expect(fieldOf(() => encodeRows(rows, "RAW" as never))).toBe("input");
    expect(fieldOf(() => encodeRows(rows, undefined as never))).toBe("input");
  });
});
