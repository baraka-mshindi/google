// Pure mapping of Sheets API responses into the library's public shapes.
import { InvalidSheetsInputError } from "../core/errors.js";
import { a1 } from "./a1.js";
import type { GGridRange, GSpreadsheet } from "./transport.js";
import type {
  AppendResult,
  CellValue,
  SpreadsheetInfo,
  TabInfo,
} from "./types.js";

export const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === "";

export const headerText = (v: unknown): string =>
  isEmpty(v) ? "" : String(v).trim();

/**
 * Keys for `width` columns starting at sheet column `first`: trimmed header text,
 * `column_<letter>` for blank or missing headers, `_2`, `_3`… for repeats.
 */
export function headerKeys(
  header: unknown[],
  width: number,
  first: number,
): string[] {
  const used = new Set<string>();
  const keys: string[] = [];
  for (let j = 0; j < width; j++) {
    const text = headerText(header[j]);
    const base = text === "" ? `column_${a1.indexToColumn(first + j)}` : text;
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}_${String(n)}`;
    used.add(key);
    keys.push(key);
  }
  return keys;
}

export function pad(
  row: readonly CellValue[] | undefined,
  width: number,
): (CellValue | null)[] {
  return Array.from({ length: width }, (_, j) => row?.[j] ?? null);
}

export const widest = (rows: readonly (readonly unknown[])[]): number =>
  rows.reduce((w, r) => Math.max(w, r.length), 0);

/** Inverse of `toGridRange` for one tab: a quoted A1 reference. */
function gridToA1(g: GGridRange | null | undefined, tab: TabInfo): string {
  const r0 = g?.startRowIndex ?? null;
  const r1 = g?.endRowIndex ?? null;
  const c0 = g?.startColumnIndex ?? null;
  const c1 = g?.endColumnIndex ?? null;
  const rowsOpen = r0 === null && r1 === null;
  const colsOpen = c0 === null && c1 === null;
  if (rowsOpen && colsOpen) return a1.range(tab.title);
  const col = (i: number) => a1.indexToColumn(i);
  const sc = (c0 ?? 0) + 1;
  const ec = c1 ?? tab.columnCount;
  const sr = (r0 ?? 0) + 1;
  const er = r1 ?? tab.rowCount;
  if (rowsOpen) return a1.range(tab.title, `${col(sc)}:${col(ec)}`);
  if (colsOpen) return a1.range(tab.title, `${String(sr)}:${String(er)}`);
  return a1.range(tab.title, `${col(sc)}${String(sr)}:${col(ec)}${String(er)}`);
}

export function toInfo(
  s: GSpreadsheet,
  spreadsheetId: string,
): SpreadsheetInfo {
  const sheets = s.sheets ?? [];
  const tabs: TabInfo[] = sheets.map((sh) => {
    const p = sh.properties ?? {};
    const g = p.gridProperties ?? {};
    return {
      sheetId: p.sheetId ?? 0,
      title: p.title ?? "",
      index: p.index ?? 0,
      hidden: p.hidden ?? false,
      rowCount: g.rowCount ?? 0,
      columnCount: g.columnCount ?? 0,
      frozenRows: g.frozenRowCount ?? 0,
      frozenColumns: g.frozenColumnCount ?? 0,
    };
  });
  const byId = new Map(tabs.map((t) => [t.sheetId, t]));
  return {
    spreadsheetId: s.spreadsheetId ?? spreadsheetId,
    title: s.properties?.title ?? "",
    locale: s.properties?.locale ?? null,
    timeZone: s.properties?.timeZone ?? null,
    tabs,
    namedRanges: (s.namedRanges ?? []).map((n) => {
      const tab = byId.get(n.range?.sheetId ?? 0);
      return {
        namedRangeId: n.namedRangeId ?? "",
        name: n.name ?? "",
        range: tab ? gridToA1(n.range, tab) : "",
      };
    }),
    protectedRanges: sheets.flatMap((sh, i) =>
      (sh.protectedRanges ?? []).map((pr) => ({
        protectedRangeId: pr.protectedRangeId ?? 0,
        range: gridToA1(pr.range, tabs[i]!),
        description: pr.description ?? null,
        warningOnly: pr.warningOnly ?? false,
      })),
    ),
  };
}

/**
 * `{ range, firstRow, lastRow }` from Google's `updates.updatedRange` (the tab is
 * quoted only when needed). The rows are already written, so a range a1 cannot
 * parse never throws: rows read as 0. Any other error is a bug and propagates.
 */
export function appendResult(
  updatedRange: string | null | undefined,
): AppendResult {
  const range = updatedRange ?? "";
  try {
    const part = a1.split(range).range;
    const b = part === null ? null : a1.parse(part);
    const firstRow = b?.startRow ?? 0;
    return { range, firstRow, lastRow: b?.endRow ?? firstRow };
  } catch (err) {
    if (!(err instanceof InvalidSheetsInputError)) throw err;
    return { range, firstRow: 0, lastRow: 0 };
  }
}
