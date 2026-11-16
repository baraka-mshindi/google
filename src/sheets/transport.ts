import type { sheets_v4 } from "@googleapis/sheets";

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
