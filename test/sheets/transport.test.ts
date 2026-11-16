import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  get: vi.fn(),
  batchUpdate: vi.fn(),
  vGet: vi.fn(),
  vBatchGet: vi.fn(),
  vUpdate: vi.fn(),
  vBatchUpdate: vi.fn(),
  vAppend: vi.fn(),
  vBatchClear: vi.fn(),
  sheets: vi.fn(),
}));
vi.mock("@googleapis/sheets", () => ({
  sheets: (...a: unknown[]) => {
    h.sheets(...a);
    return {
      spreadsheets: {
        get: h.get,
        batchUpdate: h.batchUpdate,
        values: {
          get: h.vGet,
          batchGet: h.vBatchGet,
          update: h.vUpdate,
          batchUpdate: h.vBatchUpdate,
          append: h.vAppend,
          batchClear: h.vBatchClear,
        },
      },
    };
  },
}));

import { createSheetsApiTransport } from "../../src/sheets/transport.js";

const base = { accessToken: "tok", spreadsheetId: "sp1" };

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
});

describe("createSheetsApiTransport", () => {
  it("builds a v4 client authed with only the access token", async () => {
    h.get.mockResolvedValue({ data: {} });
    await createSheetsApiTransport().getSpreadsheet({ ...base, fields: "f" });
    const arg = h.sheets.mock.calls[0]![0];
    expect(arg.version).toBe("v4");
    expect((await arg.auth.getAccessToken()).token).toBe("tok");
    expect(arg.auth.credentials).toEqual({ access_token: "tok" });
  });

  it("getSpreadsheet sends fields and includeGridData:false", async () => {
    h.get.mockResolvedValue({ data: { spreadsheetId: "sp1" } });
    const out = await createSheetsApiTransport().getSpreadsheet({
      ...base,
      fields: "sheets.properties",
    });
    expect(h.get).toHaveBeenCalledWith({
      spreadsheetId: "sp1",
      fields: "sheets.properties",
      includeGridData: false,
    });
    expect(out).toEqual({ spreadsheetId: "sp1" });
  });

  it("valuesGet sends range and valueRenderOption", async () => {
    h.vGet.mockResolvedValue({ data: { values: [["a"]] } });
    const out = await createSheetsApiTransport().valuesGet({
      ...base,
      range: "A1:B2",
      valueRenderOption: "FORMULA",
    });
    expect(h.vGet).toHaveBeenCalledWith({
      spreadsheetId: "sp1",
      range: "A1:B2",
      valueRenderOption: "FORMULA",
    });
    expect(out).toEqual({ values: [["a"]] });
  });

  it("valuesBatchGet sends ranges and valueRenderOption", async () => {
    h.vBatchGet.mockResolvedValue({ data: { valueRanges: [] } });
    const out = await createSheetsApiTransport().valuesBatchGet({
      ...base,
      ranges: ["A1", "B1"],
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    expect(h.vBatchGet).toHaveBeenCalledWith({
      spreadsheetId: "sp1",
      ranges: ["A1", "B1"],
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    expect(out).toEqual({ valueRanges: [] });
  });

  it("valuesUpdate sends range, valueInputOption and requestBody.values", async () => {
    h.vUpdate.mockResolvedValue({
      data: { updatedRange: "A1:B1", updatedCells: 2 },
    });
    const out = await createSheetsApiTransport().valuesUpdate({
      ...base,
      range: "A1:B1",
      values: [[1, 2]],
      valueInputOption: "RAW",
    });
    expect(h.vUpdate).toHaveBeenCalledWith({
      spreadsheetId: "sp1",
      range: "A1:B1",
      valueInputOption: "RAW",
      requestBody: { values: [[1, 2]] },
    });
    expect(out).toEqual({ updatedRange: "A1:B1", updatedCells: 2 });
  });

  it("valuesBatchUpdate sends valueInputOption and data in the body", async () => {
    h.vBatchUpdate.mockResolvedValue({ data: { totalUpdatedCells: 3 } });
    const data = [{ range: "A1", values: [["x"]] }];
    const out = await createSheetsApiTransport().valuesBatchUpdate({
      ...base,
      data,
      valueInputOption: "USER_ENTERED",
    });
    expect(h.vBatchUpdate).toHaveBeenCalledWith({
      spreadsheetId: "sp1",
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });
    expect(out).toEqual({ totalUpdatedCells: 3 });
  });

  it("valuesAppend sends range, options and requestBody.values", async () => {
    h.vAppend.mockResolvedValue({ data: { updates: { updatedRange: "A2" } } });
    const out = await createSheetsApiTransport().valuesAppend({
      ...base,
      range: "Sheet1",
      values: [["r"]],
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
    });
    expect(h.vAppend).toHaveBeenCalledWith({
      spreadsheetId: "sp1",
      range: "Sheet1",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [["r"]] },
    });
    expect(out).toEqual({ updates: { updatedRange: "A2" } });
  });

  it("valuesBatchClear sends ranges in the body and resolves void", async () => {
    h.vBatchClear.mockResolvedValue({ data: { clearedRanges: ["A1"] } });
    await expect(
      createSheetsApiTransport().valuesBatchClear({
        ...base,
        ranges: ["A1"],
      }),
    ).resolves.toBeUndefined();
    expect(h.vBatchClear).toHaveBeenCalledWith({
      spreadsheetId: "sp1",
      requestBody: { ranges: ["A1"] },
    });
  });

  it("batchUpdate sends requests and includeSpreadsheetInResponse:false", async () => {
    h.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });
    const requests = [{ addSheet: { properties: { title: "T" } } }];
    const out = await createSheetsApiTransport().batchUpdate({
      ...base,
      requests,
    });
    expect(h.batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: "sp1",
      requestBody: { requests, includeSpreadsheetInResponse: false },
    });
    expect(out).toEqual({ replies: [{}] });
  });

  it("rethrows API errors unchanged (same object)", async () => {
    const err = Object.assign(new Error("boom"), { code: 403 });
    h.vGet.mockRejectedValue(err);
    await expect(
      createSheetsApiTransport().valuesGet({
        ...base,
        range: "A1",
        valueRenderOption: "FORMATTED_VALUE",
      }),
    ).rejects.toBe(err);
  });

  it("loads the peer via loadPeer and surfaces MissingPeerDependencyError naming it", async () => {
    vi.resetModules();
    const loadPeer = vi.fn(async (specifier: string) => {
      const { MissingPeerDependencyError } =
        await import("../../src/core/errors.js");
      throw new MissingPeerDependencyError(specifier);
    });
    vi.doMock("../../src/core/peer.js", () => ({ loadPeer }));
    const { createSheetsApiTransport: create } =
      await import("../../src/sheets/transport.js");
    await expect(
      create().getSpreadsheet({ ...base, fields: "f" }),
    ).rejects.toMatchObject({
      name: "MissingPeerDependencyError",
      message: expect.stringContaining("@googleapis/sheets"),
    });
    expect(loadPeer).toHaveBeenCalledWith("@googleapis/sheets");
    vi.doUnmock("../../src/core/peer.js");
  });
});
