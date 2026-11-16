import { describe, expect, it } from "vitest";
import {
  ConnectionRevokedError,
  GoogleApiError,
  InvalidSheetsInputError,
  SheetsWriteOutcomeUnknownError,
} from "../../src/core/errors.js";
import type { CellInput } from "../../src/sheets/types.js";
import { sheetsHttpError } from "../../src/testing/fake-sheets.js";
import { netError, setup } from "./service-setup.js";

/** Strings that Sheets would parse under USER_ENTERED; "" stays mid-row so it reads back. */
const TRICKY = [
  "=1+1",
  "+254 712 345 678",
  "-5",
  "1/2",
  "5%",
  "TRUE",
  "'quoted",
  "",
  "=SUM(A1)",
  "end",
];

describe("round trip next to a { formula } cell", () => {
  const row: CellInput[] = [{ formula: "=1+1" }, ...TRICKY];

  it("update stores every plain string unchanged", async () => {
    const { sheet, fake, ops } = await setup();
    await sheet.update({ tab: "Sheet1", range: "A1" }, [row]);

    expect(ops("valuesUpdate")[0]!.valueInputOption).toBe("USER_ENTERED");
    expect(fake.values("Sheet1")).toEqual([["", ...TRICKY]]);
    expect(fake.formulaAt("Sheet1", "A1")).toBe("=1+1");
    expect(fake.formulaAt("Sheet1", "B1")).toBeNull();
    expect(
      await sheet.getValues(
        { tab: "Sheet1", range: "B1:K1" },
        { valueRender: "unformatted" },
      ),
    ).toEqual([TRICKY]);
  });

  it("append stores every plain string unchanged", async () => {
    const { sheet, fake, ops } = await setup();
    await sheet.append("Sheet1", [row]);

    expect(ops("valuesAppend")[0]!.valueInputOption).toBe("USER_ENTERED");
    expect(fake.values("Sheet1")).toEqual([["", ...TRICKY]]);
    expect(fake.formulaAt("Sheet1", "A1")).toBe("=1+1");
  });

  it("updateBatch prefixes plain strings in every entry", async () => {
    const { sheet, fake, ops } = await setup();
    const r = await sheet.updateBatch([
      { range: { tab: "Sheet1", range: "A1" }, values: [TRICKY] },
      { range: "'Sheet1'!A2", values: [[{ formula: "=1+1" }]] },
    ]);

    expect(ops("valuesBatchUpdate")).toEqual([
      {
        op: "valuesBatchUpdate",
        ranges: ["'Sheet1'!A1", "'Sheet1'!A2"],
        valueInputOption: "USER_ENTERED",
      },
    ]);
    expect(fake.values("Sheet1")).toEqual([TRICKY, [""]]);
    expect(fake.formulaAt("Sheet1", "A2")).toBe("=1+1");
    expect(r.updatedCells).toBe(TRICKY.length + 1);
  });
});

describe("input modes", () => {
  it("default raw with no formula sends RAW and keeps text literal", async () => {
    const { sheet, fake, ops } = await setup();
    const r = await sheet.update({ tab: "Sheet1", range: "A1" }, [
      ["=SUM(A1)", 5, true, null, "5%"],
    ]);

    expect(ops("valuesUpdate")[0]!.valueInputOption).toBe("RAW");
    expect(fake.values("Sheet1")).toEqual([["=SUM(A1)", 5, true, "", "5%"]]);
    expect(fake.formulaAt("Sheet1", "A1")).toBeNull();
    expect(r).toEqual({ updatedRange: "Sheet1!A1:E1", updatedCells: 5 });
  });

  it("user_entered sends strings unprefixed", async () => {
    const { sheet, fake, ops } = await setup();
    await sheet.update(
      { tab: "Sheet1", range: "A1" },
      [["5%", "=1+1", { formula: "=2+2" }]],
      { input: "user_entered" },
    );

    expect(ops("valuesUpdate")[0]!.valueInputOption).toBe("USER_ENTERED");
    expect(fake.values("Sheet1")).toEqual([[0.05, "", ""]]);
    expect(fake.formulaAt("Sheet1", "B1")).toBe("=1+1");
    expect(fake.formulaAt("Sheet1", "C1")).toBe("=2+2");
  });

  it("updateBatch without formulas sends RAW", async () => {
    const { sheet, ops } = await setup();
    await sheet.updateBatch([
      { range: { tab: "Sheet1", range: "A1" }, values: [["=x"]] },
    ]);
    expect(ops("valuesBatchUpdate")[0]!.valueInputOption).toBe("RAW");
  });
});

describe("update", () => {
  it("writes to a { sheetId } tab after one lookup", async () => {
    const { sheet, fake } = await setup({
      tabs: [
        { title: "Sheet1", sheetId: 0 },
        { title: "Log", sheetId: 9 },
      ],
    });
    await sheet.update({ tab: { sheetId: 9 }, range: "B2" }, [["x"]]);
    expect(fake.values("Log")).toEqual([[], ["", "x"]]);
    expect(fake.calls.map((c) => c.op)).toEqual([
      "getSpreadsheet",
      "valuesUpdate",
    ]);
  });

  it("5xx then success → retried", async () => {
    const { sheet, fake, ops } = await setup();
    fake.failNext("valuesUpdate", sheetsHttpError(503, "backendError", "x"));
    await sheet.update({ tab: "Sheet1", range: "A1" }, [["ok"]]);
    expect(ops("valuesUpdate")).toHaveLength(2);
    expect(fake.values("Sheet1")).toEqual([["ok"]]);
  });

  it("maxAttempts caps the retries", async () => {
    const { sheet, fake, ops } = await setup({ options: { maxAttempts: 1 } });
    fake.failNext("valuesUpdate", sheetsHttpError(503, "backendError", "x"));
    await expect(
      sheet.update({ tab: "Sheet1", range: "A1" }, [["ok"]]),
    ).rejects.toBeInstanceOf(GoogleApiError);
    expect(ops("valuesUpdate")).toHaveLength(1);
  });
});

describe("clear", () => {
  it("clears one range or many with valuesBatchClear", async () => {
    const { sheet, fake, ops } = await setup({
      tabs: [
        { title: "Sheet1", sheetId: 0, rows: [["a", "b", "c"], ["d"]] },
        { title: "Q1 2026", sheetId: 1, rows: [["q"]] },
      ],
    });
    await sheet.clear({ tab: "Sheet1", range: "A1" });
    await sheet.clear(["'Sheet1'!C1", { tab: { sheetId: 1 } }]);

    expect(fake.values("Sheet1")).toEqual([["", "b"], ["d"]]);
    expect(fake.values("Q1 2026")).toEqual([]);
    expect(ops("valuesBatchClear").map((c) => c.ranges)).toEqual([
      ["'Sheet1'!A1"],
      ["'Sheet1'!C1", "'Q1 2026'"],
    ]);
  });

  it("rejects an empty list", async () => {
    const { sheet, fake } = await setup();
    await expect(sheet.clear([])).rejects.toMatchObject({ field: "range" });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("append", () => {
  it("anchors at A1 of the tab and returns the rows written", async () => {
    const { sheet, ops } = await setup({
      tabs: [{ title: "Sheet1", rows: [["Name"], ["Ann"]] }],
    });
    expect(await sheet.append("Sheet1", [["Bob"], ["Cy"]])).toEqual({
      range: "Sheet1!A3:A4",
      firstRow: 3,
      lastRow: 4,
    });
    expect(ops("valuesAppend")[0]!.ranges).toEqual(["'Sheet1'!A1"]);
  });

  it("parses a quoted tab in Google's updatedRange", async () => {
    const { sheet } = await setup({ tabs: [{ title: "Q1 2026" }] });
    expect(await sheet.append("Q1 2026", [["x", "y"]])).toEqual({
      range: "'Q1 2026'!A1:B1",
      firstRow: 1,
      lastRow: 1,
    });
  });

  it("insert_rows (default) inserts rows; overwrite does not", async () => {
    const { sheet } = await setup({
      tabs: [{ title: "Sheet1", rows: [["Name"]] }],
    });
    const rowCount = async () => (await sheet.getInfo()).tabs[0]!.rowCount;
    await sheet.append("Sheet1", [["a"]]);
    expect(await rowCount()).toBe(1001);
    await sheet.append("Sheet1", [["b"]], { insert: "overwrite" });
    expect(await rowCount()).toBe(1001);
  });

  it("401 then success → refreshed, one row written", async () => {
    const { sheet, fake, ops, refreshes } = await setup();
    await sheet.getInfo(); // warm the token cache
    const before = refreshes();
    fake.failNext("valuesAppend", sheetsHttpError(401, "authError", "unauth"));

    await sheet.append("Sheet1", [["once"]]);

    expect(refreshes() - before).toBe(1);
    expect(ops("valuesAppend")).toHaveLength(2);
    expect(fake.values("Sheet1")).toEqual([["once"]]);
  });

  it("401 twice → ConnectionRevokedError, nothing written", async () => {
    const { sheet, fake, store, connectionId } = await setup();
    fake.failNext("valuesAppend", sheetsHttpError(401, "authError", "unauth"));
    fake.failNext("valuesAppend", sheetsHttpError(401, "authError", "unauth"));
    await expect(sheet.append("Sheet1", [["x"]])).rejects.toBeInstanceOf(
      ConnectionRevokedError,
    );
    expect((await store.getConnection("t1", connectionId))!.status).toBe(
      "revoked",
    );
    expect(fake.values("Sheet1")).toEqual([]);
  });
});

describe("append outcome unknown is not retried", () => {
  it.each(["ETIMEDOUT", "ECONNRESET"])(
    "%s after Google applied it",
    async (code) => {
      const { sheet, fake, ops } = await setup();
      fake.failNext("valuesAppend", netError(code), { afterApply: true });
      const err = await sheet
        .append("Sheet1", [["maybe"]])
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SheetsWriteOutcomeUnknownError);
      expect(err).toMatchObject({ tenantId: "t1" });
      expect(ops("valuesAppend")).toHaveLength(1);
      expect(fake.values("Sheet1")).toEqual([["maybe"]]);
    },
  );

  it("5xx", async () => {
    const { sheet, fake, ops } = await setup();
    fake.failNext("valuesAppend", sheetsHttpError(500, "backendError", "x"));
    await expect(sheet.append("Sheet1", [["x"]])).rejects.toBeInstanceOf(
      SheetsWriteOutcomeUnknownError,
    );
    expect(ops("valuesAppend")).toHaveLength(1);
  });
});

describe("append retries only when Google did not apply it", () => {
  it("429 then success → rows written once", async () => {
    const { sheet, fake, ops } = await setup();
    fake.failNext(
      "valuesAppend",
      sheetsHttpError(429, "rateLimitExceeded", "slow down"),
    );
    await sheet.append("Sheet1", [["once"]]);
    expect(ops("valuesAppend")).toHaveLength(2);
    expect(fake.values("Sheet1")).toEqual([["once"]]);
  });

  it("ECONNREFUSED (pre-send) then success → rows written once", async () => {
    const { sheet, fake, ops } = await setup();
    fake.failNext("valuesAppend", netError("ECONNREFUSED"));
    await sheet.append("Sheet1", [["once"]]);
    expect(ops("valuesAppend")).toHaveLength(2);
    expect(fake.values("Sheet1")).toEqual([["once"]]);
  });
});

describe("rejects bad writes before any Google call", () => {
  it("throws InvalidSheetsInputError before fetching a token", async () => {
    const { sheets, fake } = await setup();
    // An unknown connection: a token fetch would throw ConnectionNotFoundError.
    const sheet = sheets.open({
      tenantId: "t1",
      connectionId: "no-such-connection",
      spreadsheetId: "ss-1",
    });
    const r = { tab: "Sheet1", range: "A1" };
    const attempts: [string, () => Promise<unknown>][] = [
      ["append []", () => sheet.append("Sheet1", [])],
      ["update [[]]", () => sheet.update(r, [[]])],
      ["NaN", () => sheet.update(r, [[NaN]])],
      ["undefined", () => sheet.update(r, [[undefined as never]])],
      ["bad formula", () => sheet.append("Sheet1", [[{ formula: "SUM()" }]])],
      ["input", () => sheet.update(r, [["x"]], { input: "bogus" as never })],
      [
        "insert",
        () => sheet.append("Sheet1", [["x"]], { insert: "bogus" as never }),
      ],
      ["append tab", () => sheet.append({ sheetId: -1 }, [["x"]])],
      ["updateBatch []", () => sheet.updateBatch([])],
      [
        "updateBatch entry",
        () => sheet.updateBatch([{ range: r, values: [[NaN]] }]),
      ],
      [
        "updateBatch range",
        () => sheet.updateBatch([{ range: "A1", values: [["x"]] }]),
      ],
      ["clear range", () => sheet.clear("A1")],
    ];
    for (const [name, attempt] of attempts) {
      const err = await attempt().catch((e: unknown) => e);
      expect(err, name).toBeInstanceOf(InvalidSheetsInputError);
    }
    expect(fake.calls).toHaveLength(0);
  });
});
