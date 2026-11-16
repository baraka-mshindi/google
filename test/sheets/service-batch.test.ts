import { describe, expect, it } from "vitest";
import {
  GoogleApiError,
  InvalidSheetsInputError,
  SheetTabNotFoundError,
  SheetsWriteOutcomeUnknownError,
} from "../../src/core/errors.js";
import { req } from "../../src/sheets/requests.js";
import { TAB_FIELDS } from "../../src/sheets/transport.js";
import type { SheetsRequest } from "../../src/sheets/types.js";
import { sheetsHttpError } from "../../src/testing/fake-sheets.js";
import { netError, setup } from "./service-setup.js";

const tabs = [
  { title: "Sheet1", sheetId: 0 },
  { title: "Log", sheetId: 5 },
];

describe("batch tab resolution", () => {
  it("a titles-only batch makes exactly one getSpreadsheet", async () => {
    const { sheet, fake } = await setup({ tabs });
    await sheet.batch([
      req.freeze("Sheet1", { rows: 1 }),
      req.hideTab("Log"),
      req.setColumnWidth("Log", "B:D", 120),
    ]);
    expect(fake.calls).toEqual([
      { op: "getSpreadsheet", fields: TAB_FIELDS },
      { op: "batchUpdate", requests: 3 },
    ]);
    expect(fake.tab("Sheet1")!.frozenRows).toBe(1);
    expect(fake.tab("Log")!.hidden).toBe(true);
    expect(fake.appliedRequests[2]).toEqual({
      updateDimensionProperties: {
        range: { sheetId: 5, dimension: "COLUMNS", startIndex: 1, endIndex: 4 },
        properties: { pixelSize: 120 },
        fields: "pixelSize",
      },
    });
  });

  it("matches titles case-insensitively, like Google", async () => {
    const { sheet, fake } = await setup({ tabs });
    await sheet.batch([req.freeze("log", { rows: 2 })]);
    expect(fake.tab("Log")!.frozenRows).toBe(2);
  });

  it("a { sheetId }-only batch makes none", async () => {
    const { sheet, fake } = await setup({ tabs });
    await sheet.batch([
      req.freeze({ sheetId: 0 }, { rows: 1 }),
      req.hideTab({ sheetId: 5 }),
    ]);
    expect(fake.calls).toEqual([{ op: "batchUpdate", requests: 2 }]);
    expect(fake.tab("Log")!.hidden).toBe(true);
  });

  it("addTab + freeze by title: one lookup, new tab frozen", async () => {
    const { sheet, fake } = await setup({ tabs });
    const replies = await sheet.batch([
      req.addTab("Archive"),
      req.freeze("Archive", { rows: 1 }),
    ]);
    expect(fake.calls.map((c) => c.op)).toEqual([
      "getSpreadsheet",
      "batchUpdate",
    ]);
    expect(fake.tab("Archive")).toMatchObject({ sheetId: 6, frozenRows: 1 });
    expect(replies).toHaveLength(2);
    expect(replies[0]?.addSheet?.properties?.sheetId).toBe(6);
  });

  it("assigns ids above every existing and in-batch id", async () => {
    const { sheet, fake } = await setup({ tabs });
    await sheet.batch([
      req.addTab("Explicit", { sheetId: 40 }),
      req.addTab("A"),
      req.addTab("B"),
      req.freeze("A", { rows: 1 }),
      req.freeze("B", { rows: 2 }),
    ]);
    expect(fake.tab("A")).toMatchObject({ sheetId: 41, frozenRows: 1 });
    expect(fake.tab("B")).toMatchObject({ sheetId: 42, frozenRows: 2 });
  });

  it("addTab with a sheetId + use by title: no lookup", async () => {
    const { sheet, fake } = await setup({ tabs });
    await sheet.batch([
      req.addTab("Archive", { sheetId: 77 }),
      req.freeze("Archive", { rows: 3 }),
    ]);
    expect(fake.calls.map((c) => c.op)).toEqual(["batchUpdate"]);
    expect(fake.tab("Archive")).toMatchObject({ sheetId: 77, frozenRows: 3 });
  });

  it("a lone addTab needs no lookup and returns the new sheetId", async () => {
    const { sheet, fake } = await setup({ tabs });
    const replies = await sheet.batch([req.addTab("New")]);
    expect(fake.calls.map((c) => c.op)).toEqual(["batchUpdate"]);
    expect(replies[0]?.addSheet?.properties?.sheetId).toBe(
      fake.tab("New")!.sheetId,
    );
  });

  it("resolves titles in request order (delete then re-add)", async () => {
    const { sheet, fake } = await setup({ tabs });
    await sheet.batch([
      req.deleteTab("Log"),
      req.addTab("Log"),
      req.freeze("Log", { rows: 1 }),
    ]);
    expect(fake.tab("Log")).toMatchObject({ sheetId: 6, frozenRows: 1 });
  });

  it("an unknown title → SheetTabNotFoundError, no batchUpdate", async () => {
    const { sheet, ops, connectionId } = await setup({ tabs });
    const err = await sheet
      .batch([req.freeze("Sheet1", { rows: 1 }), req.hideTab("Nope")])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SheetTabNotFoundError);
    expect(err).toMatchObject({ tab: "Nope", tenantId: "t1", connectionId });
    expect(ops("batchUpdate")).toHaveLength(0);
  });

  it("a title used before its addTab is not the new tab", async () => {
    const { sheet, ops } = await setup({ tabs });
    await expect(
      sheet.batch([req.freeze("Archive", { rows: 1 }), req.addTab("Archive")]),
    ).rejects.toBeInstanceOf(SheetTabNotFoundError);
    expect(ops("batchUpdate")).toHaveLength(0);
  });
});

describe("batch atomicity and results", () => {
  it("a failing batch leaves the spreadsheet unchanged", async () => {
    const { sheet, fake } = await setup({ tabs });
    await expect(
      sheet.batch([
        req.freeze("Sheet1", { rows: 2 }),
        req.deleteTab({ sheetId: 99 }),
      ]),
    ).rejects.toBeInstanceOf(GoogleApiError);
    expect(fake.tab("Sheet1")!.frozenRows).toBe(0);
    expect(fake.appliedRequests).toEqual([]);
  });

  it("returns one reply per request", async () => {
    const { sheet } = await setup({ tabs });
    const replies = await sheet.batch([
      req.hideTab({ sheetId: 5 }),
      req.addTab("X", { sheetId: 9 }),
    ]);
    expect(replies).toHaveLength(2);
    expect(replies[1]?.addSheet?.properties).toMatchObject({
      sheetId: 9,
      title: "X",
    });
  });
});

describe("batch validation", () => {
  it("rejects empty, non-array and foreign requests before any call", async () => {
    const { sheet, fake } = await setup({ tabs });
    const bad: unknown[] = [
      [],
      "x",
      undefined,
      [{}],
      [{ addSheet: {} }],
      [req.hideTab("Log"), null],
    ];
    for (const requests of bad) {
      const err = await sheet
        .batch(requests as SheetsRequest[])
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InvalidSheetsInputError);
      expect(err).toMatchObject({ field: "requests" });
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects duplicate addTab titles in one batch", async () => {
    const { sheet, fake } = await setup({ tabs });
    await expect(
      sheet.batch([req.addTab("Archive"), req.addTab("archive")]),
    ).rejects.toMatchObject({
      code: "invalid_sheets_input",
      field: "requests",
    });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("batch retries (I10)", () => {
  it("ETIMEDOUT → SheetsWriteOutcomeUnknownError after one call", async () => {
    const { sheet, fake, ops } = await setup({ tabs });
    fake.failNext("batchUpdate", netError("ETIMEDOUT"), { afterApply: true });
    await expect(
      sheet.batch([req.hideTab({ sheetId: 5 })]),
    ).rejects.toBeInstanceOf(SheetsWriteOutcomeUnknownError);
    expect(ops("batchUpdate")).toHaveLength(1);
    expect(fake.tab("Log")!.hidden).toBe(true);
  });

  it("429 then success → applied once", async () => {
    const { sheet, fake, ops } = await setup({ tabs });
    fake.failNext(
      "batchUpdate",
      sheetsHttpError(429, "rateLimitExceeded", "slow"),
    );
    await sheet.batch([req.addTab("Once", { sheetId: 8 })]);
    expect(ops("batchUpdate")).toHaveLength(2);
    expect(fake.appliedRequests).toHaveLength(1);
  });
});
