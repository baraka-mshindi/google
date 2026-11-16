import { InvalidSheetsInputError } from "../core/errors.js";
import type { GridBounds } from "./types.js";

const MAX_COLUMN = 18278; // "ZZZ"
const SIDE = /^([A-Za-z]{1,3})?(\d+)?$/;

function badRange(detail: string): InvalidSheetsInputError {
  return new InvalidSheetsInputError("range", `Invalid A1 range: ${detail}`);
}

function quoteTab(title: string): string {
  if (typeof title !== "string" || title.length === 0) {
    throw new InvalidSheetsInputError("tab", "Tab title must not be empty");
  }
  return `'${title.replace(/'/g, "''")}'`;
}

function range(tab: string, rangePart?: string): string {
  const quoted = quoteTab(tab);
  return rangePart ? `${quoted}!${rangePart}` : quoted;
}

function split(ref: string): { tab: string; range: string | null } {
  if (typeof ref !== "string") throw badRange("reference must be a string");
  if (ref.startsWith("'")) {
    let i = 1;
    let tab = "";
    for (;;) {
      if (i >= ref.length) throw badRange("unterminated tab quote");
      const ch = ref[i];
      if (ch === "'") {
        if (ref[i + 1] === "'") {
          tab += "'";
          i += 2;
          continue;
        }
        i += 1;
        break;
      }
      tab += ch;
      i += 1;
    }
    if (tab.length === 0) throw badRange("empty tab title");
    if (i === ref.length) return { tab, range: null };
    if (ref[i] !== "!" || i + 1 >= ref.length) {
      throw badRange("expected '!' followed by a range after the tab");
    }
    return { tab, range: ref.slice(i + 1) };
  }
  const bang = ref.indexOf("!");
  if (bang <= 0 || bang === ref.length - 1) {
    throw badRange("reference must include a tab, e.g. Sheet1!A1");
  }
  return { tab: ref.slice(0, bang), range: ref.slice(bang + 1) };
}

function columnToIndex(col: string): number {
  if (typeof col !== "string" || !/^[A-Za-z]{1,3}$/.test(col)) {
    throw badRange(`bad column ${JSON.stringify(col)}`);
  }
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function indexToColumn(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > MAX_COLUMN) {
    throw badRange(`column index out of range: ${String(n)}`);
  }
  let out = "";
  let rest = n;
  while (rest > 0) {
    const r = (rest - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    rest = (rest - 1 - r) / 26;
  }
  return out;
}

type Side = { col: number | null; row: number | null };

function parseSide(text: string, whole: string): Side {
  const m = SIDE.exec(text);
  if (!m || (m[1] === undefined && m[2] === undefined)) {
    throw badRange(JSON.stringify(whole));
  }
  let row: number | null = null;
  if (m[2] !== undefined) {
    row = Number(m[2]);
    if (!Number.isSafeInteger(row) || row < 1) {
      throw badRange(JSON.stringify(whole));
    }
  }
  return { col: m[1] === undefined ? null : columnToIndex(m[1]), row };
}

function ordered(
  a: number | null,
  b: number | null,
): [number | null, number | null] {
  return a !== null && b !== null && a > b ? [b, a] : [a, b];
}

function parse(rangeText: string): GridBounds {
  if (typeof rangeText !== "string") throw badRange("range must be a string");
  const parts = rangeText.split(":");
  if (parts.length > 2) throw badRange(JSON.stringify(rangeText));
  const start = parseSide(parts[0] ?? "", rangeText);
  const end = parts.length === 2 ? parseSide(parts[1] ?? "", rangeText) : start;
  const [startRow, endRow] = ordered(start.row, end.row);
  const [startColumn, endColumn] = ordered(start.col, end.col);
  return { startRow, endRow, startColumn, endColumn };
}

export const a1 = {
  quoteTab,
  range,
  split,
  columnToIndex,
  indexToColumn,
  parse,
};
