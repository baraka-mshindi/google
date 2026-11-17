import { OAuth2Client } from "google-auth-library";
import { loadPeer } from "../core/peer.js";

// Hand-rolled subsets of the Sheets v4 shapes the transport carries, so no
// declaration outside /sheets imports the optional `@googleapis/sheets` peer
// (like Calendar's `GEvent`). Google's own `sheets_v4` types are assignable to
// them (checked in test/sheets/google-types.typecheck.ts).

export type GValueRange = {
  range?: string | null;
  values?: unknown[][] | null;
};

/** 0-based, half-open; an omitted side is open. */
export type GGridRange = {
  sheetId?: number | null;
  startRowIndex?: number | null;
  endRowIndex?: number | null;
  startColumnIndex?: number | null;
  endColumnIndex?: number | null;
};

export type GSheetProperties = {
  sheetId?: number | null;
  title?: string | null;
  index?: number | null;
  hidden?: boolean | null;
  gridProperties?: {
    rowCount?: number | null;
    columnCount?: number | null;
    frozenRowCount?: number | null;
    frozenColumnCount?: number | null;
  } | null;
};

export type GNamedRange = {
  namedRangeId?: string | null;
  name?: string | null;
  range?: GGridRange | null;
};

export type GProtectedRange = {
  protectedRangeId?: number | null;
  range?: GGridRange | null;
  description?: string | null;
  warningOnly?: boolean | null;
};

/** The parts of a `spreadsheets.get` response the library reads. */
export type GSpreadsheet = {
  spreadsheetId?: string | null;
  properties?: {
    title?: string | null;
    locale?: string | null;
    timeZone?: string | null;
  } | null;
  sheets?:
    | {
        properties?: GSheetProperties | null;
        protectedRanges?: GProtectedRange[] | null;
      }[]
    | null;
  namedRanges?: GNamedRange[] | null;
};

/** One `batchUpdate` request (`sheets_v4.Schema$Request`), passed through as-is. */
export type GRequest = object;

/**
 * One `batchUpdate` reply (`sheets_v4.Schema$Response`), passed through as-is.
 * Only the replies that carry ids are spelled out.
 */
export type GResponse = {
  addSheet?: { properties?: GSheetProperties | null } | null;
  duplicateSheet?: { properties?: GSheetProperties | null } | null;
  addNamedRange?: { namedRange?: GNamedRange | null } | null;
  addProtectedRange?: { protectedRange?: GProtectedRange | null } | null;
};

type Target = { accessToken: string; spreadsheetId: string };

export type RenderOption = "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";
export type InputOption = "RAW" | "USER_ENTERED";

/**
 * One method per Sheets API call the library makes. Implementations throw
 * Google's errors as-is; the retry wrapper classifies and sanitizes them.
 */
export interface SheetsTransport {
  getSpreadsheet(p: Target & { fields: string }): Promise<GSpreadsheet>;
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
    p: Target & { requests: GRequest[] },
  ): Promise<{ replies?: GResponse[] | null }>;
}

/** Field mask for `getInfo()`: structure only, never cell data. */
export const INFO_FIELDS =
  "spreadsheetId,properties(title,locale,timeZone),sheets(properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)),protectedRanges(protectedRangeId,range,description,warningOnly)),namedRanges(namedRangeId,name,range)";

/** Field mask for resolving tab titles and ids. */
export const TAB_FIELDS = "sheets.properties(sheetId,title)";

type Call<D> = (params: Record<string, unknown>) => Promise<{ data: D }>;
type SheetsApi = {
  spreadsheets: {
    get: Call<GSpreadsheet>;
    batchUpdate: Call<{ replies?: GResponse[] | null }>;
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
