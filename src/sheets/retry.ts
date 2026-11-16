import {
  GoogleApiError,
  GoogleLibError,
  RateLimitedError,
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
import type { RetryOptions } from "../gmail/retry.js";

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

// Failures that provably happened before the request reached Google (I10).
const PRE_SEND_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"]);
// Ambiguous transport failures: the request may have been applied.
const AMBIGUOUS_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ESOCKETTIMEDOUT"]);
const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);
const PARSE_RANGE = /Unable to parse range:?\s*(.*)$/i;

/** The tab named in Google's "Unable to parse range: <range>", else "". */
function tabFromParseError(e: ErrLike): string {
  const sources = [e.response?.data?.error?.message, e.message];
  for (const s of sources) {
    if (typeof s !== "string") continue;
    const range = PARSE_RANGE.exec(s)?.[1]?.trim();
    if (!range) continue;
    const bang = range.lastIndexOf("!");
    let tab = bang === -1 ? range : range.slice(0, bang);
    if (tab.length >= 2 && tab.startsWith("'") && tab.endsWith("'")) {
      tab = tab.slice(1, -1).replace(/''/g, "'");
    }
    return redact(tab);
  }
  return "";
}

function classify(
  err: unknown,
  idempotent: boolean,
  ids: Ids,
): SheetsErrorClass {
  if (err instanceof GoogleLibError) return { kind: "fail", error: err };
  const e = asErr(err);
  const status = readStatus(e);
  const reason = readReason(e);
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
  if (status !== null && status >= 500) {
    return idempotent ? { kind: "retry", delayMs: null } : unknown();
  }
  if (status !== null) {
    return { kind: "fail", error: new GoogleApiError(status, reason, opts) };
  }
  if (code !== null && PRE_SEND_CODES.has(code)) {
    return { kind: "retry", delayMs: null };
  }
  if (
    (code !== null &&
      (AMBIGUOUS_CODES.has(code) ||
        code.startsWith("ERR_TLS_") ||
        code.startsWith("CERT_") ||
        code === "ABORT_ERR")) ||
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

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` under the Sheets retry policy (see `classifySheetsError`). 401 surfaces
 * as `SheetsUnauthorizedSignal`; everything else as sanitized `GoogleLibError`s that
 * carry `ids`.
 */
export async function withSheetsRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions & {
    idempotent: boolean;
    ids?: { tenantId?: string; connectionId?: string };
  },
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseMs = opts.baseMs ?? 250;
  const capMs = opts.capMs ?? 8000;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const ids: Ids = opts.ids ?? {};

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const c = classify(err, opts.idempotent, ids);
      if (c.kind === "fail") throw c.error;
      if (c.kind === "unauthorized") throw new SheetsUnauthorizedSignal();
      const errOpts = { ...ids, cause: err };
      if (c.delayMs !== null && c.delayMs > capMs) {
        throw new RateLimitedError(c.delayMs, errOpts);
      }
      if (attempt + 1 >= maxAttempts) {
        const e = asErr(err);
        const status = readStatus(e);
        if (status === 429 || status === 403) {
          throw new RateLimitedError(c.delayMs, errOpts);
        }
        if (status !== null) {
          throw new GoogleApiError(status, readReason(e), errOpts);
        }
        throw new GoogleApiError(0, readNetCode(e), errOpts);
      }
      await sleep(
        c.delayMs ?? random() * Math.min(capMs, baseMs * 2 ** attempt),
      );
    }
  }
}
