import type { sheets_v4 } from "@googleapis/sheets";
import { InvalidSheetsInputError } from "../core/errors.js";
import { a1 } from "./a1.js";
import { SHEETS_REQUEST } from "./types.js";
import type { ResolveCtx, SheetsRequest, TabRef } from "./types.js";

type Dimension = "ROWS" | "COLUMNS";

function bad(field: string, message?: string): InvalidSheetsInputError {
  return new InvalidSheetsInputError(field, message);
}

function int(value: unknown, field: string, min: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw bad(field, `${field} must be an integer >= ${String(min)}`);
  }
  return value;
}

function optInt(
  value: number | undefined,
  field: string,
  min: number,
): number | undefined {
  return value === undefined ? undefined : int(value, field, min);
}

function title(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw bad(field, `${field} must be a non-empty string`);
  }
  return value;
}

function px(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 10000
  ) {
    throw bad("px", "px must be an integer between 1 and 10000");
  }
  return value;
}

function tabRef(tab: TabRef, field = "tab"): TabRef {
  if (typeof tab === "string") {
    if (tab.length === 0) throw bad(field, `${field} must not be empty`);
    return tab;
  }
  if (
    typeof tab !== "object" ||
    tab === null ||
    !Number.isInteger(tab.sheetId) ||
    tab.sheetId < 0
  ) {
    throw bad(field, `${field} must be a title or { sheetId }`);
  }
  return tab;
}

/** A single column given as a letter or a 1-based number → 1-based index. */
function column(value: number | string, field: string): number {
  if (typeof value === "number") return int(value, field, 1);
  if (typeof value !== "string" || !/^[A-Za-z]{1,3}$/.test(value)) {
    throw bad(field, `${field} must be a column letter or a 1-based number`);
  }
  return a1.columnToIndex(value);
}

/** `"B:D"` or `[2, 4]` → 1-based inclusive pair. */
function columnSpan(
  value: string | [number, number],
  field: string,
): [number, number] {
  if (Array.isArray(value)) {
    const [start, end] = value;
    const s = int(start, field, 1);
    const e = int(end, field, 1);
    if (s > e) throw bad(field, `${field} start must not exceed end`);
    return [s, e];
  }
  if (typeof value !== "string") throw bad(field);
  let bounds;
  try {
    bounds = a1.parse(value);
  } catch {
    throw bad(field, `${field} must look like "B:D" or [2, 4]`);
  }
  if (
    bounds.startRow !== null ||
    bounds.endRow !== null ||
    bounds.startColumn === null ||
    bounds.endColumn === null
  ) {
    throw bad(field, `${field} must look like "B:D" or [2, 4]`);
  }
  return [bounds.startColumn, bounds.endColumn];
}

function rowSpan(value: [number, number], field: string): [number, number] {
  if (!Array.isArray(value)) throw bad(field, `${field} must be [start, end]`);
  const s = int(value[0], field, 1);
  const e = int(value[1], field, 1);
  if (s > e) throw bad(field, `${field} start must not exceed end`);
  return [s, e];
}

function dimensionRange(
  sheetId: number,
  dimension: Dimension,
  start: number,
  endInclusive: number,
): sheets_v4.Schema$DimensionRange {
  return {
    sheetId,
    dimension,
    startIndex: start - 1,
    endIndex: endInclusive,
  };
}

/**
 * Converts a 1-based A1 range (no tab part) into a Google `GridRange`
 * (0-based, half-open). Open sides are omitted; `null` means the whole tab.
 */
export function toGridRange(
  sheetId: number,
  range: string | null,
): sheets_v4.Schema$GridRange {
  const grid: sheets_v4.Schema$GridRange = { sheetId };
  if (range === null) return grid;
  const b = a1.parse(range);
  if (b.startRow !== null) grid.startRowIndex = b.startRow - 1;
  if (b.endRow !== null) grid.endRowIndex = b.endRow;
  if (b.startColumn !== null) grid.startColumnIndex = b.startColumn - 1;
  if (b.endColumn !== null) grid.endColumnIndex = b.endColumn;
  return grid;
}

function rangeText(range: unknown): string {
  if (typeof range !== "string") throw bad("range", "range must be a string");
  a1.parse(range); // validate at builder call time (throws field "range")
  return range;
}

function make(
  refs: readonly TabRef[],
  build: (
    ctx: ResolveCtx,
    assignedSheetId?: number,
  ) => sheets_v4.Schema$Request,
  adds?: { title: string; sheetId?: number },
): SheetsRequest {
  return {
    [SHEETS_REQUEST]: true,
    refs,
    ...(adds ? { adds } : {}),
    build,
  };
}

function tabProps(
  tab: TabRef,
  properties: Omit<sheets_v4.Schema$SheetProperties, "sheetId">,
  fields: string,
): SheetsRequest {
  const t = tabRef(tab);
  return make([t], (ctx) => ({
    updateSheetProperties: {
      properties: { sheetId: ctx.sheetId(t), ...properties },
      fields,
    },
  }));
}

function insertDimension(
  tab: TabRef,
  dimension: Dimension,
  start: number,
  count: number,
): SheetsRequest {
  const t = tabRef(tab);
  return make([t], (ctx) => ({
    insertDimension: {
      range: dimensionRange(
        ctx.sheetId(t),
        dimension,
        start,
        start + count - 1,
      ),
      inheritFromBefore: false,
    },
  }));
}

function deleteDimension(
  tab: TabRef,
  dimension: Dimension,
  start: number,
  count: number,
): SheetsRequest {
  const t = tabRef(tab);
  return make([t], (ctx) => ({
    deleteDimension: {
      range: dimensionRange(
        ctx.sheetId(t),
        dimension,
        start,
        start + count - 1,
      ),
    },
  }));
}

function setSize(
  tab: TabRef,
  dimension: Dimension,
  span: [number, number],
  size: number,
): SheetsRequest {
  const t = tabRef(tab);
  return make([t], (ctx) => ({
    updateDimensionProperties: {
      range: dimensionRange(ctx.sheetId(t), dimension, span[0], span[1]),
      properties: { pixelSize: size },
      fields: "pixelSize",
    },
  }));
}

const MERGE_TYPES = {
  all: "MERGE_ALL",
  columns: "MERGE_COLUMNS",
  rows: "MERGE_ROWS",
} as const;

const PASTE_TYPES = {
  normal: "PASTE_NORMAL",
  values: "PASTE_VALUES",
  format: "PASTE_FORMAT",
  formula: "PASTE_FORMULA",
} as const;

const NAMED_RANGE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,249}$/;

/**
 * Batch request builders. Pure: they validate arguments and return an opaque
 * request; nothing is sent until the service's `batch()` runs them.
 *
 * Row and column positions are 1-based (like the Sheets UI); tab `index`
 * values are 0-based (like Google's tab order).
 */
export const req = {
  /** `index` is the 0-based tab position. */
  addTab(
    tabTitle: string,
    o: {
      index?: number;
      rows?: number;
      columns?: number;
      sheetId?: number;
    } = {},
  ): SheetsRequest {
    const name = title(tabTitle, "title");
    const index = optInt(o.index, "index", 0);
    const rows = optInt(o.rows, "rows", 1);
    const columns = optInt(o.columns, "columns", 1);
    const sheetId = optInt(o.sheetId, "sheetId", 0);
    return make(
      [],
      (_ctx, assignedSheetId) => {
        const id = sheetId ?? assignedSheetId;
        const properties: sheets_v4.Schema$SheetProperties = { title: name };
        if (id !== undefined) properties.sheetId = id;
        if (index !== undefined) properties.index = index;
        if (rows !== undefined || columns !== undefined) {
          properties.gridProperties = {
            ...(rows !== undefined ? { rowCount: rows } : {}),
            ...(columns !== undefined ? { columnCount: columns } : {}),
          };
        }
        return { addSheet: { properties } };
      },
      sheetId === undefined ? { title: name } : { title: name, sheetId },
    );
  },

  deleteTab(tab: TabRef): SheetsRequest {
    const t = tabRef(tab);
    return make([t], (ctx) => ({ deleteSheet: { sheetId: ctx.sheetId(t) } }));
  },

  renameTab(tab: TabRef, newTitle: string): SheetsRequest {
    return tabProps(tab, { title: title(newTitle, "title") }, "title");
  },

  /** `o.index` is the 0-based position of the copy. */
  duplicateTab(
    tab: TabRef,
    newTitle: string,
    o: { index?: number } = {},
  ): SheetsRequest {
    const t = tabRef(tab);
    const name = title(newTitle, "newTitle");
    const index = optInt(o.index, "index", 0);
    return make([t], (ctx) => ({
      duplicateSheet: {
        sourceSheetId: ctx.sheetId(t),
        newSheetName: name,
        ...(index !== undefined ? { insertSheetIndex: index } : {}),
      },
    }));
  },

  /** `index` is the 0-based target position. */
  moveTab(tab: TabRef, index: number): SheetsRequest {
    return tabProps(tab, { index: int(index, "index", 0) }, "index");
  },

  hideTab(tab: TabRef): SheetsRequest {
    return tabProps(tab, { hidden: true }, "hidden");
  },

  showTab(tab: TabRef): SheetsRequest {
    return tabProps(tab, { hidden: false }, "hidden");
  },

  /** Inserts `count` blank rows BEFORE 1-based row `at`. */
  insertRows(tab: TabRef, at: number, count: number): SheetsRequest {
    tabRef(tab);
    return insertDimension(
      tab,
      "ROWS",
      int(at, "at", 1),
      int(count, "count", 1),
    );
  },

  /** Inserts `count` blank columns BEFORE column `at` (`"C"` or `3`). */
  insertColumns(
    tab: TabRef,
    at: number | string,
    count: number,
  ): SheetsRequest {
    tabRef(tab);
    return insertDimension(
      tab,
      "COLUMNS",
      column(at, "at"),
      int(count, "count", 1),
    );
  },

  /** Deletes `count` rows starting at 1-based row `from`. */
  deleteRows(tab: TabRef, from: number, count: number): SheetsRequest {
    tabRef(tab);
    return deleteDimension(
      tab,
      "ROWS",
      int(from, "from", 1),
      int(count, "count", 1),
    );
  },

  /** Deletes `count` columns starting at column `from` (`"C"` or `3`). */
  deleteColumns(
    tab: TabRef,
    from: number | string,
    count: number,
  ): SheetsRequest {
    tabRef(tab);
    return deleteDimension(
      tab,
      "COLUMNS",
      column(from, "from"),
      int(count, "count", 1),
    );
  },

  /** `columns` is `"B:D"` or a 1-based inclusive pair `[2, 4]`. */
  setColumnWidth(
    tab: TabRef,
    columns: string | [number, number],
    pixels: number,
  ): SheetsRequest {
    tabRef(tab);
    return setSize(tab, "COLUMNS", columnSpan(columns, "columns"), px(pixels));
  },

  /** `rows` is a 1-based inclusive pair `[1, 3]`. */
  setRowHeight(
    tab: TabRef,
    rows: [number, number],
    pixels: number,
  ): SheetsRequest {
    tabRef(tab);
    return setSize(tab, "ROWS", rowSpan(rows, "rows"), px(pixels));
  },

  /** `columns` is `"B:D"` or a 1-based inclusive pair `[2, 4]`. */
  autoResizeColumns(
    tab: TabRef,
    columns: string | [number, number],
  ): SheetsRequest {
    const t = tabRef(tab);
    const [s, e] = columnSpan(columns, "columns");
    return make([t], (ctx) => ({
      autoResizeDimensions: {
        dimensions: dimensionRange(ctx.sheetId(t), "COLUMNS", s, e),
      },
    }));
  },

  /** Freezes the first N rows/columns; `0` unfreezes. */
  freeze(tab: TabRef, o: { rows?: number; columns?: number }): SheetsRequest {
    const rows = optInt(o?.rows, "rows", 0);
    const columns = optInt(o?.columns, "columns", 0);
    if (rows === undefined && columns === undefined) {
      throw bad("freeze", "freeze needs rows and/or columns");
    }
    const grid: sheets_v4.Schema$GridProperties = {};
    const fields: string[] = [];
    if (rows !== undefined) {
      grid.frozenRowCount = rows;
      fields.push("gridProperties.frozenRowCount");
    }
    if (columns !== undefined) {
      grid.frozenColumnCount = columns;
      fields.push("gridProperties.frozenColumnCount");
    }
    return tabProps(tab, { gridProperties: grid }, fields.join(","));
  },

  merge(
    tab: TabRef,
    range: string,
    type: "all" | "columns" | "rows" = "all",
  ): SheetsRequest {
    const t = tabRef(tab);
    const r = rangeText(range);
    if (!Object.hasOwn(MERGE_TYPES, type)) {
      throw bad("type", `type must be "all", "columns" or "rows"`);
    }
    return make([t], (ctx) => ({
      mergeCells: {
        range: toGridRange(ctx.sheetId(t), r),
        mergeType: MERGE_TYPES[type],
      },
    }));
  },

  unmerge(tab: TabRef, range: string): SheetsRequest {
    const t = tabRef(tab);
    const r = rangeText(range);
    return make([t], (ctx) => ({
      unmergeCells: { range: toGridRange(ctx.sheetId(t), r) },
    }));
  },

  /** `fields` is the field mask; defaults to `"userEnteredFormat"`. */
  format(
    tab: TabRef,
    range: string,
    cellFormat: sheets_v4.Schema$CellFormat,
    fields = "userEnteredFormat",
  ): SheetsRequest {
    const t = tabRef(tab);
    const r = rangeText(range);
    if (typeof cellFormat !== "object" || cellFormat === null) {
      throw bad("cellFormat", "cellFormat must be an object");
    }
    const mask = title(fields, "fields");
    return make([t], (ctx) => ({
      repeatCell: {
        range: toGridRange(ctx.sheetId(t), r),
        cell: { userEnteredFormat: cellFormat },
        fields: mask,
      },
    }));
  },

  copyPaste(
    from: { tab: TabRef; range: string },
    to: { tab: TabRef; range: string },
    pasteType: "normal" | "values" | "format" | "formula" = "normal",
  ): SheetsRequest {
    const ft = tabRef(from?.tab, "from");
    const tt = tabRef(to?.tab, "to");
    const fr = rangeText(from.range);
    const tr = rangeText(to.range);
    if (!Object.hasOwn(PASTE_TYPES, pasteType)) {
      throw bad("pasteType", "pasteType must be normal|values|format|formula");
    }
    return make([ft, tt], (ctx) => ({
      copyPaste: {
        source: toGridRange(ctx.sheetId(ft), fr),
        destination: toGridRange(ctx.sheetId(tt), tr),
        pasteType: PASTE_TYPES[pasteType],
      },
    }));
  },

  /** `column` letters are absolute sheet columns, not relative to `range`. */
  sort(
    tab: TabRef,
    range: string,
    specs: { column: string; ascending?: boolean }[],
  ): SheetsRequest {
    const t = tabRef(tab);
    const r = rangeText(range);
    if (!Array.isArray(specs) || specs.length === 0) {
      throw bad("specs", "specs must be a non-empty array");
    }
    const sortSpecs = specs.map((s) => {
      if (typeof s?.column !== "string" || !/^[A-Za-z]{1,3}$/.test(s.column)) {
        throw bad("specs", "each spec needs a column letter");
      }
      return {
        dimensionIndex: a1.columnToIndex(s.column) - 1,
        sortOrder: s.ascending === false ? "DESCENDING" : "ASCENDING",
      };
    });
    return make([t], (ctx) => ({
      sortRange: { range: toGridRange(ctx.sheetId(t), r), sortSpecs },
    }));
  },

  setBasicFilter(tab: TabRef, range: string): SheetsRequest {
    const t = tabRef(tab);
    const r = rangeText(range);
    return make([t], (ctx) => ({
      setBasicFilter: { filter: { range: toGridRange(ctx.sheetId(t), r) } },
    }));
  },

  clearBasicFilter(tab: TabRef): SheetsRequest {
    const t = tabRef(tab);
    return make([t], (ctx) => ({
      clearBasicFilter: { sheetId: ctx.sheetId(t) },
    }));
  },

  addNamedRange(name: string, tab: TabRef, range: string): SheetsRequest {
    if (typeof name !== "string" || !NAMED_RANGE_NAME.test(name)) {
      throw bad(
        "name",
        "name must start with a letter or underscore and use letters, digits or underscores (max 250)",
      );
    }
    const t = tabRef(tab);
    const r = rangeText(range);
    return make([t], (ctx) => ({
      addNamedRange: {
        namedRange: { name, range: toGridRange(ctx.sheetId(t), r) },
      },
    }));
  },

  deleteNamedRange(namedRangeId: string): SheetsRequest {
    const id = title(namedRangeId, "namedRangeId");
    return make([], () => ({ deleteNamedRange: { namedRangeId: id } }));
  },

  /** Without `range`, protects the whole tab. */
  protect(
    tab: TabRef,
    o: {
      range?: string;
      description?: string;
      warningOnly?: boolean;
      editors?: string[];
    } = {},
  ): SheetsRequest {
    const t = tabRef(tab);
    const r = o.range === undefined ? null : rangeText(o.range);
    if (o.editors !== undefined) {
      if (
        !Array.isArray(o.editors) ||
        o.editors.some((e) => typeof e !== "string" || e.length === 0)
      ) {
        throw bad("editors", "editors must be an array of emails");
      }
    }
    return make([t], (ctx) => {
      const protectedRange: sheets_v4.Schema$ProtectedRange = {
        range: toGridRange(ctx.sheetId(t), r),
      };
      if (o.description !== undefined)
        protectedRange.description = o.description;
      if (o.warningOnly !== undefined)
        protectedRange.warningOnly = o.warningOnly;
      if (o.editors !== undefined) {
        protectedRange.editors = { users: [...o.editors] };
      }
      return { addProtectedRange: { protectedRange } };
    });
  },

  unprotect(protectedRangeId: number): SheetsRequest {
    const id = int(protectedRangeId, "protectedRangeId", 0);
    return make([], () => ({ deleteProtectedRange: { protectedRangeId: id } }));
  },

  /** Passes a Google request through untouched (one key, e.g. `addChart`). */
  raw(request: sheets_v4.Schema$Request): SheetsRequest {
    if (
      typeof request !== "object" ||
      request === null ||
      Array.isArray(request) ||
      Object.keys(request).length !== 1
    ) {
      throw bad("request", "request must be an object with exactly one key");
    }
    return make([], () => request);
  },
};
