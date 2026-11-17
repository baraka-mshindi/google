import {
  GoogleApiError,
  GoogleLibError,
  SheetTabNotFoundError,
  SheetsWriteOutcomeUnknownError,
  SpreadsheetAccessDeniedError,
  SpreadsheetNotFoundError,
} from "../core/errors.js";
import type { GoogleErrorOptions } from "../core/errors.js";
import {
  asErr,
  readMessages,
  readNetCode,
  readReason,
  readRetryAfterMs,
  readStatus,
} from "../core/google-http.js";
import type { ErrLike } from "../core/google-http.js";
import { redact } from "../core/redact.js";
import { RATE_REASONS, runWithRetry } from "../core/retry-loop.js";
import type { RetryOptions } from "../core/retry-loop.js";
import { SheetsClientInitError } from "./transport.js";

export type { RetryOptions };

export type SheetsErrorClass =
  | { kind: "retry"; delayMs: number | null }
  | { kind: "unauthorized" }
  | { kind: "fail"; error: GoogleLibError };

type Ids = { tenantId?: string; connectionId?: string };

/** Thrown by `withSheetsRetry` when Google answered 401; the caller refreshes and retries once. */
export class SheetsUnauthorizedSignal extends Error {
  constructor() {
    super("Google rejected the access token (401)");
    this.name = "SheetsUnauthorizedSignal";
  }
}

// Failures that provably happened before the request reached Google (I10): Gmail's
// pre-send set, i.e. DNS, connection refused and TLS handshake/certificate failures.
const PRE_SEND_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"]);
const isPreSend = (code: string): boolean =>
  PRE_SEND_CODES.has(code) ||
  code.startsWith("ERR_TLS_") ||
  code.startsWith("CERT_");
// Ambiguous transport failures: the request may have been applied.
const AMBIGUOUS_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ESOCKETTIMEDOUT"]);
const PARSE_RANGE = /Unable to parse range:?\s*(.*)$/i;
// Google's batchUpdate answer for a sheetId that is not in the spreadsheet.
const NO_GRID = /\bNo grid with id:\s*(\d+)/i;
// 403s that mean "the Sheets API is not enabled for the OAuth client's project",
// not "this account cannot open the spreadsheet" (ruling R7).
const API_DISABLED_REASONS = new Set([
  "accessNotConfigured",
  "SERVICE_DISABLED",
]);

/**
 * `errors[].reason`, else the first `google.rpc.ErrorInfo` reason in
 * `error.details[]` (newer APIs send `SERVICE_DISABLED` only there).
 */
function readSheetsReason(e: ErrLike): string | null {
  const reason = readReason(e);
  if (reason !== null) return reason;
  const details = (e.response?.data?.error as { details?: unknown } | undefined)
    ?.details;
  if (!Array.isArray(details)) return null;
  for (const d of details) {
    const r = (d as { reason?: unknown } | null)?.reason;
    if (typeof r === "string") return r;
  }
  return null;
}
// A quoted tab title ('' escapes '), alone or followed by "!<cells>".
const QUOTED_TAB = /^'((?:[^']|'')*)'(?:!|$)/;

/** The tab named in Google's "Unable to parse range: <range>", else "". */
function tabFromParseError(e: ErrLike): string {
  const sources = [e.response?.data?.error?.message, e.message];
  for (const s of sources) {
    if (typeof s !== "string") continue;
    const range = PARSE_RANGE.exec(s)?.[1]?.trim();
    if (!range) continue;
    const quoted = QUOTED_TAB.exec(range)?.[1];
    if (quoted !== undefined) return redact(quoted.replace(/''/g, "'"));
    const bang = range.lastIndexOf("!");
    return redact(bang === -1 ? range : range.slice(0, bang));
  }
  return "";
}

function classify(
  err: unknown,
  idempotent: boolean,
  ids: Ids,
): SheetsErrorClass {
  if (err instanceof GoogleLibError) return { kind: "fail", error: err };
  if (err instanceof SheetsClientInitError) {
    // Provably never sent: fail without retrying and without "maybe applied".
    return {
      kind: "fail",
      error: new GoogleApiError(0, "client_init_failed", {
        ...ids,
        cause: err.cause,
      }),
    };
  }
  const e = asErr(err);
  const status = readStatus(e);
  const reason = readSheetsReason(e);
  const code = readNetCode(e);
  const opts: GoogleErrorOptions = { ...ids, cause: err };
  const unknown = (): SheetsErrorClass => ({
    kind: "fail",
    error: new SheetsWriteOutcomeUnknownError(undefined, opts),
  });

  if (
    status === 429 ||
    (status === 403 && reason !== null && RATE_REASONS.has(reason))
  ) {
    return { kind: "retry", delayMs: readRetryAfterMs(e) };
  }
  if (status === 401) return { kind: "unauthorized" };
  if (status === 404) {
    return {
      kind: "fail",
      error: new SpreadsheetNotFoundError(undefined, opts),
    };
  }
  if (status === 403 && reason !== null && API_DISABLED_REASONS.has(reason)) {
    return { kind: "fail", error: new GoogleApiError(403, reason, opts) };
  }
  if (status === 403) {
    return {
      kind: "fail",
      error: new SpreadsheetAccessDeniedError(undefined, opts),
    };
  }
  if (status === 400 && PARSE_RANGE.test(readMessages(e))) {
    return {
      kind: "fail",
      error: new SheetTabNotFoundError(tabFromParseError(e), undefined, opts),
    };
  }
  const noGrid = status === 400 ? NO_GRID.exec(readMessages(e)) : null;
  if (noGrid) {
    const id = noGrid[1]!; // digits only, so nothing to redact
    return {
      kind: "fail",
      error: new SheetTabNotFoundError(
        id,
        `Sheet tab not found: sheetId ${id}`,
        opts,
      ),
    };
  }
  if (status !== null && status >= 500) {
    return idempotent ? { kind: "retry", delayMs: null } : unknown();
  }
  if (status !== null) {
    return { kind: "fail", error: new GoogleApiError(status, reason, opts) };
  }
  if (code !== null && isPreSend(code)) {
    return { kind: "retry", delayMs: null };
  }
  if (
    (code !== null && (AMBIGUOUS_CODES.has(code) || code === "ABORT_ERR")) ||
    e.name === "AbortError" ||
    /socket hang up/i.test(readMessages(e))
  ) {
    return idempotent ? { kind: "retry", delayMs: null } : unknown();
  }
  // No HTTP status and not provably pre-send: a write may have been applied (I10).
  if (!idempotent) return unknown();
  return { kind: "fail", error: new GoogleApiError(0, code, opts) };
}

/**
 * Classifies a raw Sheets transport error. With `idempotent: false` (`append`,
 * `batch`) only rate limits and pre-send network failures are retryable (I10);
 * any other ambiguous failure becomes `SheetsWriteOutcomeUnknownError`.
 */
export function classifySheetsError(
  err: unknown,
  idempotent: boolean,
): SheetsErrorClass {
  return classify(err, idempotent, {});
}

/**
 * Runs `fn` under the Sheets retry policy (see `classifySheetsError`). 401 surfaces
 * as `SheetsUnauthorizedSignal`; everything else as sanitized `GoogleLibError`s that
 * carry `ids`.
 */
export function withSheetsRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions & {
    idempotent: boolean;
    ids?: { tenantId?: string; connectionId?: string };
  },
): Promise<T> {
  const { idempotent, ids = {}, ...retry } = opts;
  return runWithRetry(fn, {
    ...retry,
    ids,
    classify: (err) => {
      const c = classify(err, idempotent, ids);
      if (c.kind === "retry") return c;
      if (c.kind === "unauthorized") {
        return { kind: "throw", error: new SheetsUnauthorizedSignal() };
      }
      return { kind: "throw", error: c.error };
    },
  });
}
