import type { GoogleCore } from "../core/create-google.js";
import {
  InvalidSheetsInputError,
  SheetTabNotFoundError,
} from "../core/errors.js";
import { withConnectionToken } from "../core/with-token.js";
import { a1 } from "./a1.js";
import { encodeRows } from "./cells.js";
import { SheetsUnauthorizedSignal, withSheetsRetry } from "./retry.js";
import {
  createSheetsApiTransport,
  INFO_FIELDS,
  TAB_FIELDS,
} from "./transport.js";
import type { RenderOption, SheetsTransport } from "./transport.js";
import { SHEETS_REQUEST } from "./types.js";
import type {
  AppendResult,
  CellValue,
  FoundRow,
  InputMode,
  OpenInput,
  RowObject,
  SheetsRequest,
  SpreadsheetHandle,
  TabRef,
  ValueRender,
} from "./types.js";
import {
  appendResult,
  headerKeys,
  headerText,
  isEmpty,
  pad,
  toInfo,
  widest,
} from "./view.js";

export type SheetsOptions = {
  transport?: SheetsTransport;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Attempts per Google call under the retry policy (default 3). */
  maxAttempts?: number;
};

export type SheetsApi = { open(input: OpenInput): SpreadsheetHandle };

type Target = { accessToken: string; spreadsheetId: string };
/** Runs one transport call under the retry policy for its idempotency class. */
type Send = <T>(
  op: (target: Target) => Promise<T>,
  idempotent: boolean,
) => Promise<T>;
/** A validated range whose tab may still be a `{ sheetId }` to look up. */
type PendingRange = { tab: TabRef; range: string | null };
type TabEntry = { sheetId: number; title: string };

const RENDER: Record<ValueRender, RenderOption> = {
  formatted: "FORMATTED_VALUE",
  unformatted: "UNFORMATTED_VALUE",
  formula: "FORMULA",
};

const INSERT = {
  insert_rows: "INSERT_ROWS",
  overwrite: "OVERWRITE",
} as const;

const COLUMN_LETTERS = /^[A-Za-z]{1,3}$/;

function bad(field: string, message?: string): InvalidSheetsInputError {
  return new InvalidSheetsInputError(field, message);
}

/** Runs `fn`, re-labelling an `InvalidSheetsInputError` with `field`. */
function asField<T>(field: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof InvalidSheetsInputError && err.field !== field) {
      throw bad(field, err.message);
    }
    throw err;
  }
}

function requireId(input: unknown, field: keyof OpenInput): string {
  const v = (input as Record<string, unknown> | null | undefined)?.[field];
  if (typeof v !== "string" || v === "") {
    throw bad(field, `${field} must be a non-empty string`);
  }
  return v;
}

function parseRender(v: unknown): RenderOption {
  if (v === undefined) return RENDER.formatted;
  if (typeof v !== "string" || !Object.hasOwn(RENDER, v)) {
    throw bad(
      "valueRender",
      'valueRender must be "formatted", "unformatted" or "formula"',
    );
  }
  return RENDER[v as ValueRender];
}

function parseTab(tab: unknown, field = "tab"): TabRef {
  if (typeof tab === "string") {
    if (tab === "") throw bad(field, `${field} must not be empty`);
    return tab;
  }
  const id = (tab as { sheetId?: unknown } | null)?.sheetId;
  if (
    typeof tab !== "object" ||
    tab === null ||
    typeof id !== "number" ||
    !Number.isInteger(id) ||
    id < 0
  ) {
    throw bad(field, `${field} must be a title or { sheetId: integer >= 0 }`);
  }
  return { sheetId: id };
}

/**
 * A string must include its tab (a bare `A1:B2` would read the FIRST tab); its
 * range part must parse. The object form names the tab and an optional range.
 */
function parseRange(ref: unknown): PendingRange {
  if (typeof ref === "string") {
    const { tab, range } = a1.split(ref);
    if (range !== null) a1.parse(range);
    return { tab, range };
  }
  if (typeof ref !== "object" || ref === null) {
    throw bad("range", "range must be an A1 string or { tab, range? }");
  }
  const { tab, range } = ref as { tab?: unknown; range?: unknown };
  const t = parseTab(tab);
  if (range === undefined) return { tab: t, range: null };
  if (typeof range !== "string") throw bad("range", "range must be a string");
  a1.parse(range);
  return { tab: t, range };
}

function parseRangeList(list: unknown, field: string): PendingRange[] {
  if (!Array.isArray(list) || list.length === 0) {
    throw bad(field, `${field} must be a non-empty array`);
  }
  return list.map(parseRange);
}

function parseHeaderRow(v: unknown, min: number, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min) {
    throw bad("headerRow", `headerRow must be an integer >= ${String(min)}`);
  }
  return v;
}

/** `"B:F"` → its 1-based first column and the normalized `B:F` text. */
function parseColumns(v: unknown): { first: number; text: string } {
  const b = asField("columns", () => {
    if (typeof v !== "string") throw bad("columns");
    return a1.parse(v);
  });
  if (
    b.startRow !== null ||
    b.endRow !== null ||
    b.startColumn === null ||
    b.endColumn === null
  ) {
    throw bad("columns", 'columns must look like "B:F"');
  }
  return {
    first: b.startColumn,
    text: `${a1.indexToColumn(b.startColumn)}:${a1.indexToColumn(b.endColumn)}`,
  };
}

function parseColumn(column: unknown): number | { header: string } {
  if (typeof column === "string") {
    if (!COLUMN_LETTERS.test(column)) {
      throw bad("column", "column must be a letter such as C, or { header }");
    }
    return a1.columnToIndex(column);
  }
  const header = (column as { header?: unknown } | null)?.header;
  if (typeof header !== "string" || header.trim() === "") {
    throw bad("column", "column must be a letter such as C, or { header }");
  }
  return { header: header.trim() };
}

const lower = (s: string): string => s.toLowerCase();

function isSheetsRequest(r: unknown): r is SheetsRequest {
  return (
    typeof r === "object" &&
    r !== null &&
    (r as { [SHEETS_REQUEST]?: unknown })[SHEETS_REQUEST] === true
  );
}

/**
 * Creates the Sheets service. `open()` returns a handle on one spreadsheet as one
 * of a tenant's connections; every handle call fetches its own token, checks the
 * Sheets scope, and throws only `GoogleLibError`s.
 */
export function createSheets(
  google: GoogleCore,
  opts: SheetsOptions = {},
): SheetsApi {
  const transport = opts.transport ?? createSheetsApiTransport();
  const retryOpts = {
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
    ...(opts.random ? { random: opts.random } : {}),
    ...(opts.maxAttempts !== undefined
      ? { maxAttempts: opts.maxAttempts }
      : {}),
  };

  function open(input: OpenInput): SpreadsheetHandle {
    const tenantId = requireId(input, "tenantId");
    const connectionId = requireId(input, "connectionId");
    const spreadsheetId = requireId(input, "spreadsheetId");
    const ids = { tenantId, connectionId };

    /** One token for the whole handle call; each Google call retried on its own. */
    const session = <T>(fn: (send: Send) => Promise<T>): Promise<T> =>
      withConnectionToken(
        google,
        {
          tenantId,
          connectionId,
          service: "sheets",
          isUnauthorized: (e) => e instanceof SheetsUnauthorizedSignal,
        },
        (accessToken) =>
          fn((op, idempotent) =>
            withSheetsRetry(() => op({ accessToken, spreadsheetId }), {
              ...retryOpts,
              idempotent,
              ids,
            }),
          ),
      );

    const tabNotFound = (tab: TabRef): SheetTabNotFoundError =>
      typeof tab === "string"
        ? new SheetTabNotFoundError(tab, undefined, ids)
        : new SheetTabNotFoundError(
            String(tab.sheetId),
            `Sheet tab not found: sheetId ${String(tab.sheetId)}`,
            ids,
          );

    const listTabs = async (send: Send): Promise<TabEntry[]> => {
      const s = await send(
        (t) => transport.getSpreadsheet({ ...t, fields: TAB_FIELDS }),
        true,
      );
      return (s.sheets ?? []).map((sh) => ({
        sheetId: sh.properties?.sheetId ?? 0,
        title: sh.properties?.title ?? "",
      }));
    };

    /** Quoted, tab-qualified refs; one tab lookup when any tab is a `{ sheetId }`. */
    const toRefs = async (
      send: Send,
      ranges: PendingRange[],
    ): Promise<string[]> => {
      const needIds = ranges.some((r) => typeof r.tab !== "string");
      const tabs = needIds ? await listTabs(send) : [];
      return ranges.map(({ tab, range }) => {
        let title: string;
        if (typeof tab === "string") title = tab;
        else {
          const found = tabs.find((t) => t.sheetId === tab.sheetId);
          if (!found) throw tabNotFound(tab);
          title = found.title;
        }
        return a1.range(title, range ?? undefined);
      });
    };

    const readValues = async (
      send: Send,
      range: PendingRange,
      render: RenderOption,
    ): Promise<CellValue[][]> => {
      const [ref] = await toRefs(send, [range]);
      const res = await send(
        (t) =>
          transport.valuesGet({ ...t, range: ref!, valueRenderOption: render }),
        true,
      );
      return (res.values ?? []) as CellValue[][];
    };

    return {
      spreadsheetId,

      async getInfo() {
        const s = await session((send) =>
          send(
            (t) => transport.getSpreadsheet({ ...t, fields: INFO_FIELDS }),
            true,
          ),
        );
        return toInfo(s, spreadsheetId);
      },

      async getValues(range, o = {}) {
        const r = parseRange(range);
        const render = parseRender(o.valueRender);
        return session((send) => readValues(send, r, render));
      },

      async getValuesBatch(ranges, o = {}) {
        const rs = parseRangeList(ranges, "ranges");
        const render = parseRender(o.valueRender);
        const res = await session(async (send) => {
          const refs = await toRefs(send, rs);
          return send(
            (t) =>
              transport.valuesBatchGet({
                ...t,
                ranges: refs,
                valueRenderOption: render,
              }),
            true,
          );
        });
        const out = res.valueRanges ?? [];
        return rs.map((_, i) => (out[i]?.values ?? []) as CellValue[][]);
      },

      async getRows(tab, o = {}): Promise<RowObject[]> {
        const t = parseTab(tab);
        const headerRow = parseHeaderRow(o.headerRow, 1, 1);
        const columns =
          o.columns === undefined ? null : parseColumns(o.columns);
        const render = parseRender(o.valueRender);
        const rows = await session((send) =>
          readValues(send, { tab: t, range: columns?.text ?? null }, render),
        );
        const header = rows[headerRow - 1] ?? [];
        const body = rows.slice(headerRow);
        const keys = headerKeys(
          header,
          Math.max(header.length, widest(body)),
          columns?.first ?? 1,
        );
        const out: RowObject[] = [];
        body.forEach((row, i) => {
          if (row.every(isEmpty)) return;
          out.push({
            rowNumber: headerRow + 1 + i,
            // fromEntries keeps a header such as "__proto__" as an own key.
            data: Object.fromEntries(keys.map((k, j) => [k, row[j] ?? null])),
          });
        });
        return out;
      },

      async findRows(tab, o): Promise<FoundRow[]> {
        const t = parseTab(tab);
        const column = parseColumn(o?.column);
        const headerRow = parseHeaderRow(o?.headerRow, 0, 1);
        const where = o?.where;
        if (typeof where !== "function") {
          throw bad("where", "where must be a function");
        }
        if (typeof column !== "number" && headerRow === 0) {
          throw bad("column", "{ header } needs a header row (headerRow >= 1)");
        }
        const render = parseRender(o.valueRender);
        const rows = await session((send) =>
          readValues(send, { tab: t, range: null }, render),
        );
        if (rows.length === 0) return [];
        let index: number;
        if (typeof column === "number") index = column - 1;
        else {
          const header = rows[headerRow - 1] ?? [];
          index = header.findIndex((h) => headerText(h) === column.header);
          if (index === -1) {
            throw bad(
              "column",
              `No header ${JSON.stringify(column.header).slice(0, 64)} in row ${String(headerRow)}`,
            );
          }
        }
        const width = widest(rows);
        const out: FoundRow[] = [];
        for (let i = headerRow; i < rows.length; i++) {
          const values = pad(rows[i], width);
          if (where(values[index] ?? null, values)) {
            out.push({ rowNumber: i + 1, values });
          }
        }
        return out;
      },

      async update(range, values, o = {}) {
        const r = parseRange(range);
        const enc = encodeRows(values, o.input ?? "raw");
        const res = await session(async (send) => {
          const [ref] = await toRefs(send, [r]);
          return send(
            (t) =>
              transport.valuesUpdate({
                ...t,
                range: ref!,
                values: enc.values,
                valueInputOption: enc.valueInputOption,
              }),
            true,
          );
        });
        return {
          updatedRange: res.updatedRange ?? "",
          updatedCells: res.updatedCells ?? 0,
        };
      },

      async updateBatch(entries, o = {}) {
        if (!Array.isArray(entries) || entries.length === 0) {
          throw bad("entries", "entries must be a non-empty array");
        }
        const mode: InputMode = o.input ?? "raw";
        const ranges = entries.map((e) => {
          const r = parseRange((e as { range?: unknown } | null)?.range);
          encodeRows(e.values, mode); // validates each entry on its own
          return r;
        });
        // One valueInputOption for the request: encode every row together so a
        // formula anywhere keeps every entry's plain strings literal.
        const all = encodeRows(
          entries.flatMap((e) => e.values),
          mode,
        );
        let next = 0;
        const blocks = entries.map((e) => {
          const block = all.values.slice(next, next + e.values.length);
          next += e.values.length;
          return block;
        });
        const res = await session(async (send) => {
          const refs = await toRefs(send, ranges);
          return send(
            (t) =>
              transport.valuesBatchUpdate({
                ...t,
                data: refs.map((range, i) => ({ range, values: blocks[i]! })),
                valueInputOption: all.valueInputOption,
              }),
            true,
          );
        });
        return { updatedCells: res.totalUpdatedCells ?? 0 };
      },

      async clear(range) {
        const rs = Array.isArray(range)
          ? parseRangeList(range, "range")
          : [parseRange(range)];
        await session(async (send) => {
          const refs = await toRefs(send, rs);
          await send(
            (t) => transport.valuesBatchClear({ ...t, ranges: refs }),
            true,
          );
        });
      },

      async append(tab, rows, o = {}): Promise<AppendResult> {
        const t = parseTab(tab);
        const enc = encodeRows(rows, o.input ?? "raw", "rows");
        const insert = o.insert ?? "insert_rows";
        if (typeof insert !== "string" || !Object.hasOwn(INSERT, insert)) {
          throw bad("insert", 'insert must be "insert_rows" or "overwrite"');
        }
        const res = await session(async (send) => {
          const [ref] = await toRefs(send, [{ tab: t, range: "A1" }]);
          return send(
            (x) =>
              transport.valuesAppend({
                ...x,
                range: ref!,
                values: enc.values,
                valueInputOption: enc.valueInputOption,
                insertDataOption: INSERT[insert],
              }),
            false,
          );
        });
        return appendResult(res.updates?.updatedRange);
      },

      async batch(requests) {
        if (
          !Array.isArray(requests) ||
          requests.length === 0 ||
          !requests.every(isSheetsRequest)
        ) {
          throw bad(
            "requests",
            "requests must be a non-empty array of req.* builders",
          );
        }
        const addedAt = new Map<string, number>();
        requests.forEach((r, i) => {
          if (!r.adds) return;
          const key = lower(r.adds.title);
          if (addedAt.has(key)) {
            throw bad(
              "requests",
              `Duplicate addTab title in one batch: ${JSON.stringify(r.adds.title).slice(0, 64)}`,
            );
          }
          addedAt.set(key, i);
        });
        /** The in-batch addTab a title in request `i` refers to (added earlier). */
        const addedBefore = (i: number, title: string): number | undefined => {
          const j = addedAt.get(lower(title));
          return j !== undefined && j < i ? j : undefined;
        };
        // A title needs the spreadsheet's tabs unless an earlier addTab gave it an
        // explicit sheetId (an id-less addTab needs the existing ids to pick one).
        const needLookup = requests.some((r, i) =>
          r.refs.some((tab) => {
            if (typeof tab !== "string") return false;
            const j = addedBefore(i, tab);
            return j === undefined || requests[j]!.adds!.sheetId === undefined;
          }),
        );

        const res = await session(async (send) => {
          const existing = needLookup ? await listTabs(send) : null;
          const assigned: (number | undefined)[] = [];
          if (existing) {
            let next =
              Math.max(
                -1,
                ...existing.map((t) => t.sheetId),
                ...requests.map((r) => r.adds?.sheetId ?? -1),
              ) + 1;
            requests.forEach((r, i) => {
              if (r.adds && r.adds.sheetId === undefined) assigned[i] = next++;
            });
          }
          const built = requests.map((r, i) =>
            r.build(
              {
                sheetId(tab) {
                  if (typeof tab !== "string") return tab.sheetId;
                  const j = addedBefore(i, tab);
                  const added =
                    j === undefined
                      ? undefined
                      : (requests[j]!.adds!.sheetId ?? assigned[j]);
                  if (added !== undefined) return added;
                  const found = existing?.find(
                    (t) => lower(t.title) === lower(tab),
                  );
                  if (!found) throw tabNotFound(tab);
                  return found.sheetId;
                },
              },
              assigned[i],
            ),
          );
          return send(
            (t) => transport.batchUpdate({ ...t, requests: built }),
            false,
          );
        });
        return res.replies ?? [];
      },
    };
  }

  return { open };
}
