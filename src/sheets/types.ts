import type { sheets_v4 } from "@googleapis/sheets";

/** A tab by title, or by its numeric `sheetId` (`0` is the default first tab). */
export type TabRef = string | { sheetId: number };

/**
 * An A1 string that includes the tab (`"'Q1 2026'!A1:C10"`), or a tab plus an
 * optional range inside it. Omitting `range` means the whole tab.
 */
export type RangeRef = string | { tab: TabRef; range?: string };

/**
 * A cell to write. Plain strings are stored literally under the default `raw`
 * mode; `{ formula }` (starting with `=`) is the only way to write a formula.
 * `null` clears the cell.
 */
export type CellInput = string | number | boolean | null | { formula: string };

/** A cell as read back from Google. */
export type CellValue = string | number | boolean;

export type ValueRender = "formatted" | "unformatted" | "formula";

export type InputMode = "raw" | "user_entered";

export type OpenInput = {
  tenantId: string;
  connectionId: string;
  spreadsheetId: string;
};

export type TabInfo = {
  sheetId: number;
  title: string;
  index: number;
  hidden: boolean;
  rowCount: number;
  columnCount: number;
  frozenRows: number;
  frozenColumns: number;
};

export type SpreadsheetInfo = {
  spreadsheetId: string;
  title: string;
  locale: string | null;
  timeZone: string | null;
  tabs: TabInfo[];
  /** `range` is a quoted A1 reference, e.g. `'Q1 2026'!A1:C10`. */
  namedRanges: { namedRangeId: string; name: string; range: string }[];
  protectedRanges: {
    protectedRangeId: number;
    range: string;
    description: string | null;
    warningOnly: boolean;
  }[];
};

/** One row under the header, keyed by header text. `rowNumber` is the 1-based sheet row. */
export type RowObject = {
  rowNumber: number;
  data: Record<string, CellValue | null>;
};

export type FoundRow = { rowNumber: number; values: (CellValue | null)[] };

/** A column letter such as `"C"`, or a header name in the header row. */
export type ColumnRef = string | { header: string };

export type AppendResult = { range: string; firstRow: number; lastRow: number };

/** 1-based inclusive bounds; `null` means open on that side. */
export type GridBounds = {
  startRow: number | null;
  endRow: number | null;
  startColumn: number | null;
  endColumn: number | null;
};

/** Resolves a tab reference to its `sheetId`; throws `SheetTabNotFoundError`. */
export interface ResolveCtx {
  sheetId(tab: TabRef): number;
}

export const SHEETS_REQUEST: unique symbol = Symbol.for(
  "mshindi-google.sheets-request",
);

/** An opaque request from a `req.*` builder; nothing is sent until `batch()`. */
export type SheetsRequest = {
  readonly [SHEETS_REQUEST]: true;
  /** Tabs that must resolve before `build` runs. */
  readonly refs: readonly TabRef[];
  /** Set only by `req.addTab`. */
  readonly adds?: { title: string; sheetId?: number };
  build(ctx: ResolveCtx, assignedSheetId?: number): sheets_v4.Schema$Request;
};

export interface SpreadsheetHandle {
  readonly spreadsheetId: string;
  getInfo(): Promise<SpreadsheetInfo>;
  getValues(
    range: RangeRef,
    opts?: { valueRender?: ValueRender },
  ): Promise<CellValue[][]>;
  getValuesBatch(
    ranges: RangeRef[],
    opts?: { valueRender?: ValueRender },
  ): Promise<CellValue[][][]>;
  getRows(
    tab: TabRef,
    opts?: { headerRow?: number; columns?: string; valueRender?: ValueRender },
  ): Promise<RowObject[]>;
  findRows(
    tab: TabRef,
    opts: {
      column: ColumnRef;
      where: (value: CellValue | null, row: (CellValue | null)[]) => boolean;
      headerRow?: number;
      valueRender?: ValueRender;
    },
  ): Promise<FoundRow[]>;
  update(
    range: RangeRef,
    values: CellInput[][],
    opts?: { input?: InputMode },
  ): Promise<{ updatedRange: string; updatedCells: number }>;
  updateBatch(
    entries: { range: RangeRef; values: CellInput[][] }[],
    opts?: { input?: InputMode },
  ): Promise<{ updatedCells: number }>;
  clear(range: RangeRef | RangeRef[]): Promise<void>;
  append(
    tab: TabRef,
    rows: CellInput[][],
    opts?: { input?: InputMode; insert?: "insert_rows" | "overwrite" },
  ): Promise<AppendResult>;
  batch(requests: SheetsRequest[]): Promise<sheets_v4.Schema$Response[]>;
}
