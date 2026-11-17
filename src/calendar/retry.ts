import {
  ConferencingUnavailableError,
  GoogleApiError,
  GoogleLibError,
} from "../core/errors.js";
import {
  asErr,
  readMessages,
  readNetCode,
  readReason,
  readRetryAfterMs,
  readStatus,
} from "../core/google-http.js";
import { RATE_REASONS, runWithRetry } from "../core/retry-loop.js";
import type { RetryOptions } from "../core/retry-loop.js";

export type { RetryOptions };

export type CalendarErrorClass =
  | { kind: "retry"; delayMs: number | null }
  | { kind: "unauthorized" }
  | { kind: "duplicate" }
  | { kind: "gone" }
  | { kind: "precondition" }
  | { kind: "fail"; error: GoogleLibError };

/** Thrown by `withCalendarRetry` when Google answered 401; the caller refreshes and retries once. */
export class CalendarUnauthorizedSignal extends Error {
  constructor() {
    super("Google rejected the access token (401)");
    this.name = "CalendarUnauthorizedSignal";
  }
}

/** Thrown by `withCalendarRetry` when Google answered 409 (event id already exists). */
export class DuplicateEventSignal extends Error {
  constructor() {
    super("Event already exists (409)");
    this.name = "DuplicateEventSignal";
  }
}

/** Thrown by `withCalendarRetry` when Google answered 404 or 410. */
export class EventGoneSignal extends Error {
  constructor() {
    super("Event not found or deleted (404/410)");
    this.name = "EventGoneSignal";
  }
}

/** Thrown by `withCalendarRetry` when Google answered 412 (`If-Match` etag is stale). */
export class PreconditionFailedSignal extends Error {
  constructor() {
    super("Event changed since it was read (412)");
    this.name = "PreconditionFailedSignal";
  }
}

const NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
]);

export function classifyCalendarError(err: unknown): CalendarErrorClass {
  if (err instanceof GoogleLibError) return { kind: "fail", error: err };
  const e = asErr(err);
  const status = readStatus(e);
  const reason = readReason(e);
  const code = readNetCode(e);
  const opts = { cause: err };

  if (
    status === 429 ||
    (status === 403 && reason !== null && RATE_REASONS.has(reason))
  ) {
    return { kind: "retry", delayMs: readRetryAfterMs(e) };
  }
  if (status === 401) return { kind: "unauthorized" };
  if (status === 409) return { kind: "duplicate" };
  if (status === 404 || status === 410) return { kind: "gone" };
  if (status === 412) return { kind: "precondition" };
  if (status === 400) {
    if (/conference/i.test(readMessages(e))) {
      return {
        kind: "fail",
        error: new ConferencingUnavailableError(undefined, opts),
      };
    }
    return { kind: "fail", error: new GoogleApiError(400, reason, opts) };
  }
  if (status !== null && status >= 500) return { kind: "retry", delayMs: null };
  if (
    (code !== null &&
      (NETWORK_CODES.has(code) ||
        code.startsWith("ERR_TLS_") ||
        code.startsWith("CERT_") ||
        code === "ABORT_ERR")) ||
    e.name === "AbortError" ||
    /socket hang up/i.test(readMessages(e))
  ) {
    return { kind: "retry", delayMs: null };
  }
  if (status !== null) {
    return { kind: "fail", error: new GoogleApiError(status, reason, opts) };
  }
  return { kind: "fail", error: new GoogleApiError(0, code, opts) };
}

/**
 * Runs `fn`, retrying rate limits, 5xx and network failures. Unlike Gmail's send
 * (I7), this deliberately retries ambiguous failures: callers only wrap idempotent
 * calls. 401/409/404/410/412 surface as internal signals; everything else as sanitized
 * `GoogleLibError`s.
 */
export function withCalendarRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  return runWithRetry(fn, {
    ...opts,
    classify: (err) => {
      const c = classifyCalendarError(err);
      switch (c.kind) {
        case "retry":
          return c;
        case "fail":
          return { kind: "throw", error: c.error };
        case "unauthorized":
          return { kind: "throw", error: new CalendarUnauthorizedSignal() };
        case "duplicate":
          return { kind: "throw", error: new DuplicateEventSignal() };
        case "gone":
          return { kind: "throw", error: new EventGoneSignal() };
        case "precondition":
          return { kind: "throw", error: new PreconditionFailedSignal() };
      }
    },
  });
}
