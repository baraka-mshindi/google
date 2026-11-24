import { describe, expect, it, vi } from "vitest";
import {
  GoogleApiError,
  InvalidSheetsInputError,
  ServiceAccountRejectedError,
  SpreadsheetAccessDeniedError,
} from "../../src/core/errors.js";
import { createServiceAccountSheets } from "../../src/sheets/service.js";
import { FakeSheets, sheetsHttpError } from "../../src/testing/fake-sheets.js";
import { StaticTokenSource } from "../../src/testing/static-token-source.js";

const SPREADSHEET_ID = "ss-sa";

function setup() {
  const source = new StaticTokenSource({ tokens: ["ya29.t1", "ya29.t2"] });
  const fake = new FakeSheets({
    spreadsheetId: SPREADSHEET_ID,
    tabs: [
      {
        title: "Log",
        sheetId: 0,
        rows: [
          ["KEY", "Name"],
          ["k1", "Ann"],
        ],
      },
    ],
  });
  const sheets = createServiceAccountSheets(source, {
    transport: fake,
    sleep: async () => {},
    random: () => 0,
  });
  const sheet = sheets.open({ spreadsheetId: SPREADSHEET_ID });
  const tokensSent = (op: "valuesGet" | "valuesAppend") => vi.spyOn(fake, op);
  return { source, fake, sheet, sheets, tokensSent };
}

describe("createServiceAccountSheets", () => {
  it("opens a spreadsheet by id alone and calls Google with the source's token", async () => {
    const { sheet, tokensSent, source } = setup();
    const spy = tokensSent("valuesGet");
    expect(await sheet.getValues({ tab: "Log" })).toEqual([
      ["KEY", "Name"],
      ["k1", "Ann"],
    ]);
    expect(spy.mock.calls[0]![0]).toMatchObject({
      accessToken: "ya29.t1",
      spreadsheetId: SPREADSHEET_ID,
    });
    expect(source.requests).toEqual([{ forceRefresh: false }]);
  });

  it("supports the full handle: find a row by key, then update or append", async () => {
    const { sheet, fake } = setup();
    const found = await sheet.findRows("Log", {
      column: { header: "KEY" },
      where: (v) => v === "k1",
    });
    expect(found.map((r) => r.rowNumber)).toEqual([2]);
    await sheet.update({ tab: "Log", range: "B2" }, [["Anne"]]);
    await sheet.append("Log", [["k2", "Bo"]]);
    expect(fake.values("Log")).toEqual([
      ["KEY", "Name"],
      ["k1", "Anne"],
      ["k2", "Bo"],
    ]);
  });

  it("requires a spreadsheetId", () => {
    const { sheets } = setup();
    expect(() =>
      sheets.open({} as unknown as { spreadsheetId: string }),
    ).toThrow(InvalidSheetsInputError);
  });

  it("a 401 forces a fresh token and retries once", async () => {
    const { sheet, fake, source, tokensSent } = setup();
    const spy = tokensSent("valuesGet");
    fake.failNext("valuesGet", sheetsHttpError(401, "authError", "unauth"));
    await sheet.getValues({ tab: "Log" });
    expect(source.requests).toEqual([
      { forceRefresh: false },
      { forceRefresh: true },
    ]);
    expect(spy.mock.calls.map((c) => c[0].accessToken)).toEqual([
      "ya29.t1",
      "ya29.t2",
    ]);
  });

  it("a second 401 is ServiceAccountRejectedError naming the account", async () => {
    const { sheet, fake, source } = setup();
    fake.failNext("valuesGet", sheetsHttpError(401, "authError", "unauth"));
    fake.failNext("valuesGet", sheetsHttpError(401, "authError", "unauth"));
    const err = await sheet.getValues({ tab: "Log" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceAccountRejectedError);
    expect((err as ServiceAccountRejectedError).clientEmail).toBe(
      source.clientEmail,
    );
  });

  it("a sheet not shared with the account is SpreadsheetAccessDeniedError", async () => {
    const { sheet, fake } = setup();
    fake.failNext(
      "valuesGet",
      sheetsHttpError(403, "forbidden", "The caller does not have permission"),
    );
    await expect(sheet.getValues({ tab: "Log" })).rejects.toBeInstanceOf(
      SpreadsheetAccessDeniedError,
    );
  });

  it("passes a token source failure through unchanged", async () => {
    const { sheet, source } = setup();
    const failure = new GoogleApiError(503, "token_request_failed");
    source.failNext(failure);
    await expect(sheet.getValues({ tab: "Log" })).rejects.toBe(failure);
  });

  it("wraps a non-library token source failure as a GoogleLibError", async () => {
    const { sheet, source } = setup();
    source.failNext(new Error("boom"));
    const err = await sheet.getValues({ tab: "Log" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect((err as GoogleApiError).reason).toBe("token_request_failed");
  });
});
