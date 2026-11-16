import type { sheets_v4 } from "@googleapis/sheets";
import { OAuth2Client } from "google-auth-library";
import { loadPeer } from "../core/peer.js";

export type GValueRange = {
  range?: string | null;
  values?: unknown[][] | null;
};

type Target = { accessToken: string; spreadsheetId: string };

export type RenderOption = "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";
export type InputOption = "RAW" | "USER_ENTERED";

/**
 * One method per Sheets API call the library makes. Implementations throw
 * Google's errors as-is; the retry wrapper classifies and sanitizes them.
 */
export interface SheetsTransport {
  getSpreadsheet(
    p: Target & { fields: string },
  ): Promise<sheets_v4.Schema$Spreadsheet>;
  valuesGet(
    p: Target & { range: string; valueRenderOption: RenderOption },
  ): Promise<GValueRange>;
  valuesBatchGet(
    p: Target & { ranges: string[]; valueRenderOption: RenderOption },
  ): Promise<{ valueRanges?: GValueRange[] | null }>;
  valuesUpdate(
    p: Target & {
      range: string;
      values: unknown[][];
      valueInputOption: InputOption;
    },
  ): Promise<{ updatedRange?: string | null; updatedCells?: number | null }>;
  valuesBatchUpdate(
    p: Target & {
      data: { range: string; values: unknown[][] }[];
      valueInputOption: InputOption;
    },
  ): Promise<{ totalUpdatedCells?: number | null }>;
  valuesAppend(
    p: Target & {
      range: string;
      values: unknown[][];
      valueInputOption: InputOption;
      insertDataOption: "INSERT_ROWS" | "OVERWRITE";
    },
  ): Promise<{ updates?: { updatedRange?: string | null } | null }>;
  valuesBatchClear(p: Target & { ranges: string[] }): Promise<void>;
  batchUpdate(
    p: Target & { requests: sheets_v4.Schema$Request[] },
  ): Promise<{ replies?: sheets_v4.Schema$Response[] | null }>;
}

/** Field mask for `getInfo()`: structure only, never cell data. */
export const INFO_FIELDS =
  "spreadsheetId,properties(title,locale,timeZone),sheets(properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)),protectedRanges(protectedRangeId,range,description,warningOnly)),namedRanges(namedRangeId,name,range)";

/** Field mask for resolving tab titles and ids. */
export const TAB_FIELDS = "sheets.properties(sheetId,title)";

type Call<D> = (params: Record<string, unknown>) => Promise<{ data: D }>;
type SheetsApi = {
  spreadsheets: {
    get: Call<sheets_v4.Schema$Spreadsheet>;
    batchUpdate: Call<{ replies?: sheets_v4.Schema$Response[] | null }>;
    values: {
      get: Call<GValueRange>;
      batchGet: Call<{ valueRanges?: GValueRange[] | null }>;
      update: Call<{
        updatedRange?: string | null;
        updatedCells?: number | null;
      }>;
      batchUpdate: Call<{ totalUpdatedCells?: number | null }>;
      append: Call<{ updates?: { updatedRange?: string | null } | null }>;
      batchClear: Call<unknown>;
    };
  };
};
type SheetsModule = {
  sheets(opts: { version: "v4"; auth: unknown }): SheetsApi;
};

/**
 * Talks to the Google Sheets API v4. Errors are thrown as-is (gaxios errors
 * carry the bearer token); the retry wrapper classifies them so only sanitized
 * GoogleLibError instances leave the library.
 */
export function createSheetsApiTransport(): SheetsTransport {
  const client = async (accessToken: string): Promise<SheetsApi> => {
    const mod = await loadPeer<
      Partial<SheetsModule> & { default?: SheetsModule }
    >("@googleapis/sheets");
    const { sheets } = (mod.sheets ? mod : mod.default) as SheetsModule;
    const auth = new OAuth2Client();
    auth.setCredentials({ access_token: accessToken });
    return sheets({ version: "v4", auth });
  };

  return {
    async getSpreadsheet({ accessToken, spreadsheetId, fields }) {
      const api = await client(accessToken);
      const { data } = await api.spreadsheets.get({
        spreadsheetId,
        fields,
        includeGridData: false,
      });
      return data;
    },
    async valuesGet({ accessToken, spreadsheetId, range, valueRenderOption }) {
      const api = await client(accessToken);
      const { data } = await api.spreadsheets.values.get({
        spreadsheetId,
        range,
        valueRenderOption,
      });
      return data;
    },
    async valuesBatchGet({
      accessToken,
      spreadsheetId,
      ranges,
      valueRenderOption,
    }) {
      const api = await client(accessToken);
      const { data } = await api.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
        valueRenderOption,
      });
      return data;
    },
    async valuesUpdate({
      accessToken,
      spreadsheetId,
      range,
      values,
      valueInputOption,
    }) {
      const api = await client(accessToken);
      const { data } = await api.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption,
        requestBody: { values },
      });
      return data;
    },
    async valuesBatchUpdate({
      accessToken,
      spreadsheetId,
      data: rows,
      valueInputOption,
    }) {
      const api = await client(accessToken);
      const { data } = await api.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption, data: rows },
      });
      return data;
    },
    async valuesAppend({
      accessToken,
      spreadsheetId,
      range,
      values,
      valueInputOption,
      insertDataOption,
    }) {
      const api = await client(accessToken);
      const { data } = await api.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption,
        insertDataOption,
        requestBody: { values },
      });
      return data;
    },
    async valuesBatchClear({ accessToken, spreadsheetId, ranges }) {
      const api = await client(accessToken);
      await api.spreadsheets.values.batchClear({
        spreadsheetId,
        requestBody: { ranges },
      });
    },
    async batchUpdate({ accessToken, spreadsheetId, requests }) {
      const api = await client(accessToken);
      const { data } = await api.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests, includeSpreadsheetInResponse: false },
      });
      return data;
    },
  };
}
