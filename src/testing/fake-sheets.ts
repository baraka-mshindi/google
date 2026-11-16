import type { sheets_v4 } from "@googleapis/sheets";
import { a1 } from "../sheets/a1.js";
import type {
  GValueRange,
  InputOption,
  RenderOption,
  SheetsTransport,
} from "../sheets/transport.js";

type Scalar = string | number | boolean;
type Op = keyof SheetsTransport;
type Target = { accessToken: string; spreadsheetId: string };
type Obj = Record<string, unknown>;

export type FakeSheetsTab = {
  title: string;
  sheetId?: number;
  rows?: (string | number | boolean)[][];
};

export type FakeSheetsCall = {
  op: keyof SheetsTransport;
  ranges?: string[];
  valueInputOption?: string;
  requests?: number;
  /** The field mask of a `getSpreadsheet` call. */
  fields?: string;
};

/** A stored cell. `f` marks a formula; `fmt` overrides the formatted text. */
type Cell = { v: Scalar; f?: string; fmt?: string };

type Tab = {
  sheetId: number;
  title: string;
  hidden: boolean;
  frozenRows: number;
  frozenColumns: number;
  rowCount: number;
  columnCount: number;
  cells: (Cell | undefined)[][];
};

type NamedRange = {
  namedRangeId: string;
  name: string;
  range: sheets_v4.Schema$GridRange;
};

type State = {
  tabs: Tab[]; // in index order
  named: NamedRange[];
  protected: sheets_v4.Schema$ProtectedRange[];
  nextSheetId: number;
  nextNamedId: number;
  nextProtectedId: number;
};

// Every key of sheets_v4.Schema$Request (types are not available at runtime).
const REQUEST_KEYS = new Set(
  (
    "addBanding addChart addConditionalFormatRule addDataSource addDimensionGroup " +
    "addFilterView addNamedRange addProtectedRange addSheet addSlicer addTable " +
    "appendCells appendDimension autoFill autoResizeDimensions " +
    "cancelDataSourceRefresh clearBasicFilter copyPaste createDeveloperMetadata " +
    "cutPaste deleteBanding deleteConditionalFormatRule deleteDataSource " +
    "deleteDeveloperMetadata deleteDimension deleteDimensionGroup deleteDuplicates " +
    "deleteEmbeddedObject deleteFilterView deleteNamedRange deleteProtectedRange " +
    "deleteRange deleteSheet deleteTable duplicateFilterView duplicateSheet " +
    "findReplace insertDimension insertRange mergeCells moveDimension pasteData " +
    "randomizeRange refreshDataSource repeatCell setBasicFilter setDataValidation " +
    "sortRange textToColumns trimWhitespace unmergeCells updateBanding updateBorders " +
    "updateCells updateChartSpec updateConditionalFormatRule updateDataSource " +
    "updateDeveloperMetadata updateDimensionGroup updateDimensionProperties " +
    "updateEmbeddedObjectBorder updateEmbeddedObjectPosition updateFilterView " +
    "updateNamedRange updateProtectedRange updateSheetProperties updateSlicerSpec " +
    "updateSpreadsheetProperties updateTable"
  ).split(" "),
);

const DEFAULT_ROWS = 1000;
const DEFAULT_COLUMNS = 26;
const NUMBER = /^[+-]?\d+(\.\d+)?$/;
const PERCENT = /^[+-]?\d+(\.\d+)?%$/;
const BOOLEAN = /^(true|false)$/i;
const DATE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/;
/**
 * The year given to a year-less `M/D` under USER_ENTERED. Google uses the current
 * year; the fake pins it so results never depend on the wall clock.
 */
const FIXED_YEAR = 2026;

// Recorded-only requests whose `fields` mask Google requires (per v4.d.ts).
const NEEDS_FIELDS = new Set(
  (
    "appendCells repeatCell updateBanding updateCells updateDataSource " +
    "updateDeveloperMetadata updateDimensionGroup updateDimensionProperties " +
    "updateEmbeddedObjectBorder updateFilterView updateNamedRange " +
    "updateProtectedRange updateSlicerSpec updateSpreadsheetProperties updateTable"
  ).split(" "),
);
// Recorded-only requests' required ranges: each entry lists alternative paths.
// A range found there must be on an existing sheet (no `sheetId` means 0).
const NEEDS_RANGE: Record<string, string[][]> = {
  repeatCell: [["range"]],
  mergeCells: [["range"]],
  unmergeCells: [["range"]],
  sortRange: [["range"]],
  updateBorders: [["range"]],
  setDataValidation: [["range"]],
  insertRange: [["range"]],
  deleteRange: [["range"]],
  updateCells: [["range", "start"]],
  setBasicFilter: [["filter.range", "filter.tableId"]],
  updateDimensionProperties: [["range", "dataSourceSheetRange"]],
  autoResizeDimensions: [["dimensions", "dataSourceSheetDimensions"]],
  copyPaste: [["source"], ["destination"]],
  cutPaste: [["source"], ["destination"]],
  moveDimension: [["source"]],
};
// Recorded-only requests addressing a sheet by a top-level `sheetId` (omitted = 0).
const ON_SHEET = new Set(["clearBasicFilter", "appendDimension"]);

const clone = <T>(v: T): T => structuredClone(v);
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const sameTitle = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

/** A gaxios-shaped HTTP error, as the googleapis client throws it. */
export function sheetsHttpError(
  status: number,
  reason: string,
  message: string,
): Error {
  return Object.assign(new Error(message), {
    code: status,
    response: {
      status,
      data: { error: { code: status, message, errors: [{ reason }] } },
    },
  });
}

const badRequest = (message: string): Error =>
  sheetsHttpError(400, "badRequest", message);
const parseError = (ref: string): Error =>
  badRequest(`Unable to parse range: ${ref}`);

// ---- cell encoding (Google's RAW vs USER_ENTERED handling) ----

const CLEAR = "clear" as const;
const SKIP = "skip" as const;

/** The date serial (days since 1899-12-30) for M/D[/Y], or null if not a date. */
function dateCell(m: RegExpExecArray): Cell | null {
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = m[3] === undefined ? FIXED_YEAR : Number(m[3]);
  if (m[3]?.length === 2) year += year < 30 ? 2000 : 1900;
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { v: ms / 86_400_000 + 25_569, fmt: `${month}/${day}/${year}` };
}

function userEntered(s: string): Cell {
  if (s.startsWith("'")) return { v: s.slice(1) };
  if (s.startsWith("=")) return { v: "", f: s };
  if (NUMBER.test(s)) return { v: Number(s) };
  if (PERCENT.test(s)) return { v: Number(s.slice(0, -1)) / 100, fmt: s };
  if (BOOLEAN.test(s)) return { v: s.toLowerCase() === "true" };
  const date = DATE.exec(s);
  const asDate = date ? dateCell(date) : null;
  if (asDate) return asDate;
  if (s.startsWith("+") || s.startsWith("-")) return { v: "", f: s };
  return { v: s };
}

function toCell(
  value: unknown,
  option: InputOption,
): Cell | typeof CLEAR | typeof SKIP {
  if (value === null || value === undefined) return SKIP;
  if (typeof value === "boolean") return { v: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw badRequest("Invalid values: non-finite number");
    return { v: value };
  }
  if (typeof value !== "string") {
    throw badRequest(
      "Invalid values: cells must be strings, numbers or booleans",
    );
  }
  if (value === "") return CLEAR;
  return option === "RAW" ? { v: value } : userEntered(value);
}

function render(cell: Cell, mode: RenderOption): Scalar {
  if (cell.f !== undefined) return mode === "FORMULA" ? cell.f : "";
  if (mode !== "FORMATTED_VALUE") return cell.v;
  if (cell.fmt !== undefined) return cell.fmt;
  if (typeof cell.v === "boolean") return cell.v ? "TRUE" : "FALSE";
  return String(cell.v);
}

/** Rows of rendered values with trailing empty cells and rows dropped. */
function trimmed(
  tab: Tab,
  rows: [number, number],
  cols: [number, number],
  mode: RenderOption,
): Scalar[][] {
  const out: Scalar[][] = [];
  const lastRow = Math.min(rows[1], tab.cells.length);
  for (let r = rows[0]; r <= lastRow; r++) {
    const src = tab.cells[r - 1] ?? [];
    const row: Scalar[] = [];
    let keep = 0;
    for (let c = cols[0]; c <= Math.min(cols[1], src.length); c++) {
      const cell = src[c - 1];
      row.push(cell ? render(cell, mode) : "");
      if (cell) keep = row.length;
    }
    out.push(row.slice(0, keep));
  }
  while (out.length > 0 && out[out.length - 1]!.length === 0) out.pop();
  return out;
}

function setCell(tab: Tab, r: number, c: number, cell: Cell | undefined): void {
  if (cell === undefined && c > (tab.cells[r - 1]?.length ?? 0)) return;
  while (tab.cells.length < r) tab.cells.push([]); // no holes in the row list
  const row = tab.cells[r - 1]!;
  row[c - 1] = cell;
}

/** The tab as Google writes it in returned refs: quoted only when it has to be. */
function tabPart(title: string): string {
  const plain =
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(title) &&
    !/^[A-Za-z]{1,3}\d+$/.test(title) && // looks like a cell, e.g. A1
    !/^R\d*C\d*$/i.test(title); // looks like R1C1
  return plain ? title : a1.quoteTab(title);
}

const typed = (v: Scalar): sheets_v4.Schema$ExtendedValue =>
  typeof v === "number"
    ? { numberValue: v }
    : typeof v === "boolean"
      ? { boolValue: v }
      : { stringValue: v };

function cellData(cell: Cell): sheets_v4.Schema$CellData {
  if (cell.f !== undefined)
    return { userEnteredValue: { formulaValue: cell.f } };
  return {
    userEnteredValue: typed(cell.v),
    effectiveValue: typed(cell.v),
    formattedValue: String(render(cell, "FORMATTED_VALUE")),
  };
}

function at(v: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((o, k) => (isObj(o) ? o[k] : undefined), v);
}

function cellRef(row: number, col: number): string {
  return `${a1.indexToColumn(col)}${row}`;
}

function blockRef(
  tab: Tab,
  r0: number,
  c0: number,
  r1: number,
  c1: number,
): string {
  const tl = cellRef(r0, c0);
  return `${tabPart(tab.title)}!${r0 === r1 && c0 === c1 ? tl : `${tl}:${cellRef(r1, c1)}`}`;
}

// ---- field masks ----

type Mask = Map<string, Mask | true>;

function addPath(mask: Mask, path: string[], sub: Mask | true): void {
  let m = mask;
  for (const seg of path.slice(0, -1)) {
    const next = m.get(seg);
    if (next === true) return;
    if (next === undefined) m.set(seg, (m = new Map()));
    else m = next;
  }
  const last = path[path.length - 1]!;
  const existing = m.get(last);
  if (existing === true || sub === true || existing === undefined) {
    m.set(last, existing === undefined ? sub : true);
  } else {
    for (const [k, v] of sub) addPath(existing, [k], v);
  }
}

/** Parses Google's partial-response syntax, e.g. `a,b.c(d,e(f))`. */
function parseMask(src: string): Mask {
  const text = src.replace(/\s+/g, "");
  let i = 0;
  const invalid = () => badRequest(`Invalid field selection ${src}`);
  const list = (): Mask => {
    const mask: Mask = new Map();
    for (;;) {
      const start = i;
      while (i < text.length && /[A-Za-z0-9_.*]/.test(text[i]!)) i++;
      const path = text.slice(start, i).split(".");
      if (path.some((seg) => seg === "")) throw invalid();
      let sub: Mask | true = true;
      if (text[i] === "(") {
        i++;
        sub = list();
        if (text[i] !== ")") throw invalid();
        i++;
      }
      addPath(mask, path, sub);
      if (text[i] !== ",") return mask;
      i++;
    }
  };
  const mask = list();
  if (i !== text.length) throw invalid();
  return mask;
}

function project(value: unknown, mask: Mask | true): unknown {
  if (mask === true || mask.has("*")) return value;
  if (Array.isArray(value)) return value.map((v) => project(v, mask));
  if (!isObj(value)) return value;
  const out: Obj = {};
  for (const [k, sub] of mask) {
    if (value[k] !== undefined) out[k] = project(value[k], sub);
  }
  return out;
}

/** Google omits a zero `sheetId` from GridRanges in responses. */
function outRange(
  r: sheets_v4.Schema$GridRange | undefined,
): sheets_v4.Schema$GridRange {
  const out = clone(r ?? {});
  if (!out.sheetId) delete out.sheetId;
  return out;
}

/**
 * In-memory Google Sheets transport for tests: one spreadsheet with tabs, cell
 * values and formulas, named and protected ranges. Every operation runs on a
 * copy of the state that is committed only if it succeeds, so a failing
 * `batchUpdate` applies nothing.
 *
 * Simplifications to know about:
 * - `valuesAppend` table detection is "after the last row with any stored cell"
 *   (from the range's start column), not Google's full table heuristics.
 * - USER_ENTERED parses only `'`-literals, `=`/`+`/`-` formulas, plain numbers,
 *   percents, TRUE/FALSE and `M/D[/Y]` dates (year-less → {@link FIXED_YEAR}).
 *   ISO dates, `1,000`, `$5`, `1e5`, times and padded text stay text. Formulas
 *   are not evaluated: they read as `""` except under `FORMULA`.
 * - Requests that would change values but are recorded only (cells untouched):
 *   copyPaste, cutPaste, moveDimension, insertRange/deleteRange, updateCells,
 *   appendCells, appendDimension, autoFill, findReplace, sortRange and the rest
 *   outside the structural set.
 */
export class FakeSheets implements SheetsTransport {
  readonly calls: FakeSheetsCall[] = [];
  /** Every request of each committed `batchUpdate`, in order. */
  readonly appliedRequests: sheets_v4.Schema$Request[] = [];

  private readonly spreadsheetId: string;
  private readonly title: string;
  private state: State;
  private readonly failures = new Map<
    Op,
    { error: unknown; afterApply: boolean }[]
  >();

  constructor(
    opts: {
      spreadsheetId?: string;
      title?: string;
      tabs?: FakeSheetsTab[];
    } = {},
  ) {
    this.spreadsheetId = opts.spreadsheetId ?? "fake-spreadsheet";
    this.title = opts.title ?? "Fake Spreadsheet";
    const seeds = opts.tabs ?? [{ title: "Sheet1", sheetId: 0 }];
    if (seeds.length === 0)
      throw new Error("FakeSheets needs at least one tab");
    const used = new Set(
      seeds.flatMap((t) => (t.sheetId === undefined ? [] : [t.sheetId])),
    );
    if (used.size !== seeds.filter((t) => t.sheetId !== undefined).length) {
      throw new Error("FakeSheets: duplicate sheetId in tabs");
    }
    let next = 0;
    const tabs = seeds.map((seed): Tab => {
      if (seeds.filter((t) => sameTitle(t.title, seed.title)).length > 1) {
        throw new Error(`FakeSheets: duplicate tab title ${seed.title}`);
      }
      let sheetId = seed.sheetId;
      if (sheetId === undefined) {
        while (used.has(next)) next++;
        used.add((sheetId = next));
      }
      const rows = seed.rows ?? [];
      return {
        sheetId,
        title: seed.title,
        hidden: false,
        frozenRows: 0,
        frozenColumns: 0,
        rowCount: Math.max(DEFAULT_ROWS, rows.length),
        columnCount: Math.max(DEFAULT_COLUMNS, ...rows.map((r) => r.length)),
        cells: rows.map((r) => r.map((v) => (v === "" ? undefined : { v }))),
      };
    });
    this.state = {
      tabs,
      named: [],
      protected: [],
      nextSheetId: Math.max(...used) + 1,
      nextNamedId: 1,
      nextProtectedId: 1,
    };
  }

  // ---- inspection helpers ----

  tab(title: string):
    | {
        sheetId: number;
        hidden: boolean;
        frozenRows: number;
        frozenColumns: number;
        index: number;
      }
    | undefined {
    const index = this.state.tabs.findIndex((t) => t.title === title);
    const t = this.state.tabs[index];
    if (!t) return undefined;
    return {
      sheetId: t.sheetId,
      hidden: t.hidden,
      frozenRows: t.frozenRows,
      frozenColumns: t.frozenColumns,
      index,
    };
  }

  /** The tab's values (formulas read as `""`), trailing empty cells and rows trimmed. */
  values(title: string): (string | number | boolean)[][] {
    const t = this.mustTab(title);
    return trimmed(
      t,
      [1, t.cells.length],
      [1, Number.MAX_SAFE_INTEGER],
      "UNFORMATTED_VALUE",
    );
  }

  /** The formula stored at `cell` (e.g. `"C2"`), or null if the cell holds none. */
  formulaAt(title: string, cell: string): string | null {
    const t = this.mustTab(title);
    const b = a1.parse(cell);
    if (b.startRow === null || b.startColumn === null) {
      throw new Error(`FakeSheets: not a cell reference: ${cell}`);
    }
    return t.cells[b.startRow - 1]?.[b.startColumn - 1]?.f ?? null;
  }

  failNext(
    op: keyof SheetsTransport,
    error: unknown,
    opts: { afterApply?: boolean } = {},
  ): void {
    const q = this.failures.get(op) ?? [];
    q.push({ error, afterApply: opts.afterApply ?? false });
    this.failures.set(op, q);
  }

  // ---- SheetsTransport ----

  async getSpreadsheet(
    p: Target & { fields: string },
  ): Promise<sheets_v4.Schema$Spreadsheet> {
    this.calls.push({ op: "getSpreadsheet", fields: p.fields });
    return this.run(
      "getSpreadsheet",
      p,
      (s) =>
        project(
          this.full(s),
          parseMask(p.fields),
        ) as sheets_v4.Schema$Spreadsheet,
    );
  }

  async valuesGet(
    p: Target & { range: string; valueRenderOption: RenderOption },
  ): Promise<GValueRange> {
    this.calls.push({ op: "valuesGet", ranges: [p.range] });
    return this.run("valuesGet", p, (s) =>
      this.read(s, p.range, p.valueRenderOption),
    );
  }

  async valuesBatchGet(
    p: Target & { ranges: string[]; valueRenderOption: RenderOption },
  ): Promise<{ valueRanges?: GValueRange[] | null }> {
    this.calls.push({ op: "valuesBatchGet", ranges: [...p.ranges] });
    return this.run("valuesBatchGet", p, (s) => ({
      spreadsheetId: this.spreadsheetId,
      valueRanges: p.ranges.map((r) => this.read(s, r, p.valueRenderOption)),
    }));
  }

  async valuesUpdate(
    p: Target & {
      range: string;
      values: unknown[][];
      valueInputOption: InputOption;
    },
  ): Promise<{ updatedRange?: string | null; updatedCells?: number | null }> {
    this.calls.push({
      op: "valuesUpdate",
      ranges: [p.range],
      valueInputOption: p.valueInputOption,
    });
    return this.run("valuesUpdate", p, (s) => ({
      spreadsheetId: this.spreadsheetId,
      ...this.write(s, p.range, p.values, p.valueInputOption),
    }));
  }

  async valuesBatchUpdate(
    p: Target & {
      data: { range: string; values: unknown[][] }[];
      valueInputOption: InputOption;
    },
  ): Promise<{ totalUpdatedCells?: number | null }> {
    this.calls.push({
      op: "valuesBatchUpdate",
      ranges: p.data.map((d) => d.range),
      valueInputOption: p.valueInputOption,
    });
    return this.run("valuesBatchUpdate", p, (s) => {
      const responses = p.data.map((d) =>
        this.write(s, d.range, d.values, p.valueInputOption),
      );
      return {
        spreadsheetId: this.spreadsheetId,
        totalUpdatedCells: responses.reduce((n, r) => n + r.updatedCells, 0),
        responses,
      };
    });
  }

  async valuesAppend(
    p: Target & {
      range: string;
      values: unknown[][];
      valueInputOption: InputOption;
      insertDataOption: "INSERT_ROWS" | "OVERWRITE";
    },
  ): Promise<{ updates?: { updatedRange?: string | null } | null }> {
    this.calls.push({
      op: "valuesAppend",
      ranges: [p.range],
      valueInputOption: p.valueInputOption,
    });
    return this.run("valuesAppend", p, (s) => {
      const { tab, bounds } = this.resolve(s, p.range);
      let last = tab.cells.length;
      while (last > 0 && !tab.cells[last - 1]?.some(Boolean)) last--;
      const row = last + 1;
      const column = bounds?.startColumn ?? 1;
      if (p.insertDataOption === "INSERT_ROWS") tab.rowCount += p.values.length;
      const out = this.writeAt(tab, row, column, p.values, p.valueInputOption);
      return { spreadsheetId: this.spreadsheetId, updates: out };
    });
  }

  async valuesBatchClear(p: Target & { ranges: string[] }): Promise<void> {
    this.calls.push({ op: "valuesBatchClear", ranges: [...p.ranges] });
    return this.run("valuesBatchClear", p, (s) => {
      for (const ref of p.ranges) {
        const { tab, bounds } = this.resolve(s, ref);
        const r0 = bounds?.startRow ?? 1;
        const r1 = Math.min(bounds?.endRow ?? Infinity, tab.cells.length);
        for (let r = r0; r <= r1; r++) {
          const row = tab.cells[r - 1] ?? [];
          const c0 = bounds?.startColumn ?? 1;
          const c1 = Math.min(bounds?.endColumn ?? Infinity, row.length);
          for (let c = c0; c <= c1; c++) row[c - 1] = undefined;
        }
      }
    });
  }

  async batchUpdate(
    p: Target & { requests: sheets_v4.Schema$Request[] },
  ): Promise<{ replies?: sheets_v4.Schema$Response[] | null }> {
    this.calls.push({
      op: "batchUpdate",
      requests: Array.isArray(p.requests) ? p.requests.length : 0,
    });
    return this.run("batchUpdate", p, (s) => {
      if (!Array.isArray(p.requests) || p.requests.length === 0) {
        throw badRequest(
          "Invalid requests: must specify at least one request.",
        );
      }
      const replies = p.requests.map((req, i) => this.apply(s, req, i));
      this.appliedRequests.push(...clone(p.requests));
      return { spreadsheetId: this.spreadsheetId, replies };
    });
  }

  // ---- internals ----

  /** Injected failure, 404 check, then `fn` on a draft that is committed on success. */
  private run<T>(op: Op, target: Target, fn: (draft: State) => T): T {
    const f = this.failures.get(op)?.shift();
    if (f && !f.afterApply) throw f.error;
    if (target.spreadsheetId !== this.spreadsheetId) {
      throw sheetsHttpError(404, "notFound", "Requested entity was not found.");
    }
    const draft = clone(this.state);
    const result = clone(fn(draft));
    this.state = draft;
    if (f) throw f.error;
    return result;
  }

  private mustTab(title: string): Tab {
    const t = this.state.tabs.find((x) => x.title === title);
    if (!t)
      throw new Error(`FakeSheets: no tab titled ${JSON.stringify(title)}`);
    return t;
  }

  /**
   * Resolves an A1 ref to its tab and bounds (null bounds = whole tab), as Google
   * does: `'quoted'` or unquoted title (no `'` in it) before `!`; a bare quoted
   * title is the whole tab; a bare ref that parses as A1 addresses the first
   * visible tab; any other bare text is a whole-tab title.
   */
  private resolve(
    s: State,
    ref: string,
  ): { tab: Tab; bounds: ReturnType<typeof a1.parse> | null; closed: boolean } {
    if (typeof ref !== "string" || ref === "") throw parseError(String(ref));
    const byTitle = (title: string): Tab | undefined => {
      if (title.includes("'")) throw parseError(ref); // must be quoted
      return s.tabs.find((t) => sameTitle(t.title, title));
    };
    const isRange = (text: string): boolean => {
      try {
        a1.parse(text);
        return true;
      } catch {
        return false;
      }
    };
    let tab: Tab | undefined;
    let rangePart: string | null;
    if (ref.startsWith("'")) {
      let split: ReturnType<typeof a1.split>;
      try {
        split = a1.split(ref);
      } catch {
        throw parseError(ref);
      }
      tab = s.tabs.find((t) => sameTitle(t.title, split.tab));
      rangePart = split.range;
    } else if (!ref.includes("!")) {
      if (isRange(ref)) [tab, rangePart] = [s.tabs.find((t) => !t.hidden), ref];
      else [tab, rangePart] = [byTitle(ref), null];
    } else {
      const bang = ref.indexOf("!");
      tab = byTitle(ref.slice(0, bang));
      rangePart = ref.slice(bang + 1);
      if (bang === 0 || rangePart === "") throw parseError(ref);
    }
    if (!tab) throw parseError(ref);
    if (rangePart === null) return { tab, bounds: null, closed: false };
    try {
      return {
        tab,
        bounds: a1.parse(rangePart),
        closed: rangePart.includes(":"),
      };
    } catch {
      throw parseError(ref);
    }
  }

  private read(s: State, ref: string, mode: RenderOption): GValueRange & Obj {
    const { tab, bounds } = this.resolve(s, ref);
    const maxRow = Math.max(bounds?.startRow ?? 0, bounds?.endRow ?? 0);
    const maxCol = Math.max(bounds?.startColumn ?? 0, bounds?.endColumn ?? 0);
    if (maxRow > tab.rowCount || maxCol > tab.columnCount) {
      throw badRequest(
        `Range (${ref}) exceeds grid limits. Max rows: ${tab.rowCount}, max columns: ${tab.columnCount}`,
      );
    }
    const r0 = bounds?.startRow ?? 1;
    const r1 = bounds?.endRow ?? tab.rowCount;
    const c0 = bounds?.startColumn ?? 1;
    const c1 = bounds?.endColumn ?? tab.columnCount;
    const values = trimmed(tab, [r0, r1], [c0, c1], mode);
    return {
      range: blockRef(tab, r0, c0, r1, c1),
      majorDimension: "ROWS",
      ...(values.length > 0 ? { values } : {}),
    };
  }

  private write(
    s: State,
    ref: string,
    values: unknown[][],
    option: InputOption,
  ): {
    updatedRange: string;
    updatedRows: number;
    updatedColumns: number;
    updatedCells: number;
  } {
    const { tab, bounds, closed } = this.resolve(s, ref);
    const r0 = bounds?.startRow ?? 1;
    const c0 = bounds?.startColumn ?? 1;
    if (closed && Array.isArray(values)) {
      const lastRow = r0 + values.length - 1;
      const width = Math.max(
        0,
        ...values.map((r) => (Array.isArray(r) ? r.length : 0)),
      );
      if (bounds?.endRow != null && lastRow > bounds.endRow) {
        throw badRequest(
          `Requested writing within range [${ref}], but tried writing to row [${lastRow}]`,
        );
      }
      if (bounds?.endColumn != null && c0 + width - 1 > bounds.endColumn) {
        throw badRequest(
          `Requested writing within range [${ref}], but tried writing to column [${a1.indexToColumn(c0 + width - 1)}]`,
        );
      }
    }
    return this.writeAt(tab, r0, c0, values, option);
  }

  private writeAt(
    tab: Tab,
    r0: number,
    c0: number,
    values: unknown[][],
    option: InputOption,
  ): {
    updatedRange: string;
    updatedRows: number;
    updatedColumns: number;
    updatedCells: number;
  } {
    if (!Array.isArray(values) || !values.every(Array.isArray)) {
      throw badRequest("Invalid values: expected an array of rows");
    }
    const width = Math.max(1, ...values.map((r) => r.length));
    const height = Math.max(1, values.length);
    let cells = 0;
    values.forEach((row, i) =>
      row.forEach((value, j) => {
        const cell = toCell(value, option);
        if (cell === SKIP) return;
        cells++;
        setCell(tab, r0 + i, c0 + j, cell === CLEAR ? undefined : cell);
      }),
    );
    tab.rowCount = Math.max(tab.rowCount, r0 + height - 1);
    tab.columnCount = Math.max(tab.columnCount, c0 + width - 1);
    return {
      updatedRange: blockRef(tab, r0, c0, r0 + height - 1, c0 + width - 1),
      updatedRows: values.length,
      updatedColumns: width,
      updatedCells: cells,
    };
  }

  private sheetProps(s: State, t: Tab): sheets_v4.Schema$SheetProperties {
    return {
      sheetId: t.sheetId,
      title: t.title,
      index: s.tabs.indexOf(t),
      sheetType: "GRID",
      // Like Google, false / zero values are omitted.
      ...(t.hidden ? { hidden: true } : {}),
      gridProperties: {
        rowCount: t.rowCount,
        columnCount: t.columnCount,
        ...(t.frozenRows ? { frozenRowCount: t.frozenRows } : {}),
        ...(t.frozenColumns ? { frozenColumnCount: t.frozenColumns } : {}),
      },
    };
  }

  private full(s: State): sheets_v4.Schema$Spreadsheet {
    return {
      spreadsheetId: this.spreadsheetId,
      properties: { title: this.title, locale: "en_US", timeZone: "Etc/GMT" },
      sheets: s.tabs.map((t) => {
        const prs = s.protected
          .filter((pr) => (pr.range?.sheetId ?? 0) === t.sheetId)
          .map((pr) => ({ ...clone(pr), range: outRange(pr.range) }));
        const rowData = t.cells.map((row) =>
          row.length > 0
            ? { values: Array.from(row, (c) => (c ? cellData(c) : {})) }
            : {},
        );
        return {
          properties: this.sheetProps(s, t),
          ...(prs.length > 0 ? { protectedRanges: prs } : {}),
          // A broad mask (`*`, `sheets`) returns grid data, as on Google.
          data: [rowData.length > 0 ? { rowData } : {}],
        };
      }),
      ...(s.named.length > 0
        ? {
            namedRanges: s.named.map((n) => ({
              ...clone(n),
              range: outRange(n.range),
            })),
          }
        : {}),
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${this.spreadsheetId}/edit`,
    };
  }

  private apply(s: State, req: unknown, i: number): sheets_v4.Schema$Response {
    const keys = isObj(req) ? Object.keys(req) : [];
    if (keys.length !== 1) {
      throw badRequest(
        `Invalid requests[${i}]: exactly one kind of request must be set.`,
      );
    }
    const key = keys[0]!;
    if (!REQUEST_KEYS.has(key)) {
      throw badRequest(
        `Invalid JSON payload received. Unknown name "${key}" at 'requests[${i}]'.`,
      );
    }
    const body = (req as Obj)[key];
    const fail = (msg: string) =>
      badRequest(`Invalid requests[${i}].${key}: ${msg}`);
    if (!isObj(body)) throw fail("request body must be an object.");
    const byId = (id: unknown): Tab => {
      const t = s.tabs.find((x) => x.sheetId === (id ?? 0));
      if (!t) throw fail(`No grid with id: ${String(id)}`);
      return t;
    };
    const titleFree = (title: unknown, except?: Tab): string => {
      if (typeof title !== "string" || title.trim() === "") {
        throw fail("Sheet title must not be empty.");
      }
      if (s.tabs.some((t) => t !== except && sameTitle(t.title, title))) {
        throw fail(
          `A sheet with the name "${title}" already exists. Please enter another name.`,
        );
      }
      return title;
    };
    const idFree = (id: unknown): number => {
      if (!Number.isInteger(id) || (id as number) < 0)
        throw fail(`Invalid sheet id: ${String(id)}`);
      if (s.tabs.some((t) => t.sheetId === id))
        throw fail(`A sheet with id ${String(id)} already exists.`);
      return id as number;
    };
    const newId = (): number => {
      while (s.tabs.some((t) => t.sheetId === s.nextSheetId)) s.nextSheetId++;
      return s.nextSheetId++;
    };
    const insertAt = (t: Tab, index: unknown) => {
      const at =
        typeof index === "number"
          ? Math.max(0, Math.min(index, s.tabs.length))
          : s.tabs.length;
      s.tabs.splice(at, 0, t);
    };

    switch (key) {
      case "addSheet": {
        const props = (body.properties ??
          {}) as sheets_v4.Schema$SheetProperties;
        const grid = props.gridProperties ?? {};
        let title = props.title;
        if (title == null) {
          let n = s.tabs.length + 1;
          while (s.tabs.some((t) => sameTitle(t.title, `Sheet${n}`))) n++;
          title = `Sheet${n}`;
        }
        const t: Tab = {
          sheetId: props.sheetId == null ? newId() : idFree(props.sheetId),
          title: titleFree(title),
          hidden: props.hidden ?? false,
          frozenRows: grid.frozenRowCount ?? 0,
          frozenColumns: grid.frozenColumnCount ?? 0,
          rowCount: grid.rowCount ?? DEFAULT_ROWS,
          columnCount: grid.columnCount ?? DEFAULT_COLUMNS,
          cells: [],
        };
        insertAt(t, props.index);
        return { addSheet: { properties: this.sheetProps(s, t) } };
      }
      case "deleteSheet": {
        const t = byId(body.sheetId);
        if (s.tabs.length === 1)
          throw fail("You can't remove all the sheets in a document.");
        s.tabs.splice(s.tabs.indexOf(t), 1);
        const onTab = (r?: sheets_v4.Schema$GridRange) =>
          (r?.sheetId ?? 0) === t.sheetId;
        s.named = s.named.filter((n) => !onTab(n.range));
        s.protected = s.protected.filter((pr) => !onTab(pr.range));
        return {};
      }
      case "updateSheetProperties": {
        const props = (body.properties ??
          {}) as sheets_v4.Schema$SheetProperties;
        if (typeof body.fields !== "string" || body.fields.trim() === "") {
          throw fail("At least one field must be specified in 'fields'.");
        }
        const t = byId(props.sheetId);
        const mask = parseMask(body.fields);
        const all = mask.has("*");
        const grid = props.gridProperties ?? {};
        const gridMask = all ? true : mask.get("gridProperties");
        const wantsGrid = (k: string) =>
          gridMask === true || (gridMask instanceof Map && gridMask.has(k));
        for (const [k] of mask) {
          if (
            ![
              "*",
              "title",
              "index",
              "hidden",
              "gridProperties",
              "tabColor",
              "tabColorStyle",
              "rightToLeft",
            ].includes(k)
          ) {
            throw fail(`Invalid field: ${k}`);
          }
        }
        if (gridMask instanceof Map) {
          for (const [k] of gridMask) {
            if (
              ![
                "rowCount",
                "columnCount",
                "frozenRowCount",
                "frozenColumnCount",
                "hideGridlines",
                "rowGroupControlAfter",
                "columnGroupControlAfter",
              ].includes(k)
            ) {
              throw fail(`Invalid field: gridProperties.${k}`);
            }
          }
        }
        if (all || mask.has("title")) t.title = titleFree(props.title, t);
        if (all || mask.has("hidden")) t.hidden = props.hidden ?? false;
        if (wantsGrid("frozenRowCount"))
          t.frozenRows = grid.frozenRowCount ?? 0;
        if (wantsGrid("frozenColumnCount"))
          t.frozenColumns = grid.frozenColumnCount ?? 0;
        if (wantsGrid("rowCount") && grid.rowCount != null)
          t.rowCount = grid.rowCount;
        if (wantsGrid("columnCount") && grid.columnCount != null)
          t.columnCount = grid.columnCount;
        if (all || mask.has("index")) {
          // Indexes count positions before the move (Google's documented semantics).
          const cur = s.tabs.indexOf(t);
          const target = props.index ?? s.tabs.length;
          s.tabs.splice(cur, 1);
          insertAt(t, target > cur ? target - 1 : target);
        }
        if (s.tabs.every((x) => x.hidden))
          throw fail("You can't hide all the sheets in a document.");
        return {};
      }
      case "duplicateSheet": {
        const src = byId(body.sourceSheetId);
        let title = body.newSheetName as string | undefined;
        if (title == null) {
          title = `Copy of ${src.title}`;
          for (let n = 2; s.tabs.some((t) => sameTitle(t.title, title!)); n++) {
            title = `Copy of ${src.title} ${n}`;
          }
        }
        const t: Tab = {
          ...clone(src),
          sheetId: body.newSheetId == null ? newId() : idFree(body.newSheetId),
          title: titleFree(title),
        };
        insertAt(t, body.insertSheetIndex ?? s.tabs.indexOf(src) + 1);
        return { duplicateSheet: { properties: this.sheetProps(s, t) } };
      }
      case "insertDimension":
      case "deleteDimension": {
        const r = (body.range ?? {}) as sheets_v4.Schema$DimensionRange;
        const t = byId(r.sheetId);
        if (r.dimension !== "ROWS" && r.dimension !== "COLUMNS") {
          throw fail("range.dimension must be ROWS or COLUMNS.");
        }
        const rows = r.dimension === "ROWS";
        const size = rows ? t.rowCount : t.columnCount;
        const start = r.startIndex ?? 0;
        const end = r.endIndex ?? size;
        const n = end - start;
        if (
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 0 ||
          n <= 0
        ) {
          throw fail(`Invalid range: [${start}, ${end}).`);
        }
        if (key === "insertDimension") {
          if (start > size)
            throw fail(
              `Cannot insert at index ${start}; the sheet has ${size}.`,
            );
          if (rows) {
            t.cells.splice(start, 0, ...Array.from({ length: n }, () => []));
            t.rowCount += n;
          } else {
            for (const row of t.cells) {
              if (row.length > start)
                row.splice(start, 0, ...new Array<undefined>(n));
            }
            t.columnCount += n;
          }
          return {};
        }
        const frozen = rows ? t.frozenRows : t.frozenColumns;
        const what = rows ? "rows" : "columns";
        if (end > size)
          throw fail(
            `Cannot delete ${what} that do not exist (sheet has ${size}).`,
          );
        if (n >= size)
          throw fail(`You can't delete all the ${what} on the sheet.`);
        if (size - n <= frozen)
          throw fail(
            `Sorry, it is not possible to delete all non-frozen ${what}.`,
          );
        const lostFrozen = Math.max(0, Math.min(end, frozen) - start);
        if (rows) {
          t.cells.splice(start, n);
          t.rowCount -= n;
          t.frozenRows -= lostFrozen;
        } else {
          for (const row of t.cells) row.splice(start, n);
          t.columnCount -= n;
          t.frozenColumns -= lostFrozen;
        }
        return {};
      }
      case "addNamedRange": {
        const nr = (body.namedRange ?? {}) as sheets_v4.Schema$NamedRange;
        const name = nr.name;
        if (
          typeof name !== "string" ||
          !/^[A-Za-z_][A-Za-z0-9_]{0,249}$/.test(name) ||
          BOOLEAN.test(name) ||
          /^[A-Za-z]{1,3}\d+$/.test(name) ||
          /^R\d*C\d*$/i.test(name)
        ) {
          throw fail(`Invalid name: ${JSON.stringify(name)}.`);
        }
        if (s.named.some((n) => sameTitle(n.name, name))) {
          throw fail(`A named range with the name "${name}" already exists.`);
        }
        byId(nr.range?.sheetId);
        const namedRangeId = nr.namedRangeId ?? `fake-named-${s.nextNamedId++}`;
        if (s.named.some((n) => n.namedRangeId === namedRangeId)) {
          throw fail(`A named range with id ${namedRangeId} already exists.`);
        }
        const stored = { namedRangeId, name, range: clone(nr.range ?? {}) };
        s.named.push(stored);
        return {
          addNamedRange: {
            namedRange: { ...clone(stored), range: outRange(stored.range) },
          },
        };
      }
      case "deleteNamedRange": {
        const at = s.named.findIndex(
          (n) => n.namedRangeId === body.namedRangeId,
        );
        if (at < 0)
          throw fail(`No named range with id: ${String(body.namedRangeId)}`);
        s.named.splice(at, 1);
        return {};
      }
      case "addProtectedRange": {
        const pr = (body.protectedRange ??
          {}) as sheets_v4.Schema$ProtectedRange;
        if (!isObj(pr.range)) throw fail("protectedRange.range is required.");
        byId(pr.range.sheetId);
        const stored = { ...clone(pr), protectedRangeId: s.nextProtectedId++ };
        s.protected.push(stored);
        return {
          addProtectedRange: {
            protectedRange: { ...clone(stored), range: outRange(stored.range) },
          },
        };
      }
      case "deleteProtectedRange": {
        const at = s.protected.findIndex(
          (pr) => pr.protectedRangeId === body.protectedRangeId,
        );
        if (at < 0)
          throw fail(
            `No protected range with id: ${String(body.protectedRangeId)}`,
          );
        s.protected.splice(at, 1);
        return {};
      }
      default: {
        // Recorded only, but checked for shape: required `fields` and ranges,
        // and every sheet it names must exist.
        if (
          NEEDS_FIELDS.has(key) &&
          (typeof body.fields !== "string" || body.fields.trim() === "")
        ) {
          throw fail("At least one field must be specified in 'fields'.");
        }
        for (const paths of NEEDS_RANGE[key] ?? []) {
          const found = paths
            .map((path) => at(body, path))
            .find((v) => v !== undefined);
          if (found === undefined)
            throw fail(`${paths.join(" or ")} is required.`);
          if (isObj(found)) byId(found.sheetId);
        }
        if (ON_SHEET.has(key)) byId(body.sheetId);
        this.checkSheetIds(body, (id) => byId(id));
        return {};
      }
    }
  }

  private checkSheetIds(v: unknown, check: (id: number) => void): void {
    if (Array.isArray(v)) v.forEach((x) => this.checkSheetIds(x, check));
    else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (k === "sheetId" && typeof x === "number") check(x);
        else this.checkSheetIds(x, check);
      }
    }
  }
}
