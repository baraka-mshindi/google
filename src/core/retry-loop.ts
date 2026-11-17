// Shared retry loop for the service modules. Internal: not part of /core.
import { GoogleApiError, RateLimitedError } from "./errors.js";
import { asErr, readNetCode, readReason, readStatus } from "./google-http.js";

export type RetryOptions = {
  maxAttempts?: number;
  baseMs?: number;
  capMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

/** What the loop does with one failure: back off and retry, or throw `error` as-is. */
export type RetryStep =
  { kind: "retry"; delayMs: number | null } | { kind: "throw"; error: unknown };

/** 403 reasons Google uses for rate limits (as opposed to permission denials). */
export const RATE_REASONS: ReadonlySet<string> = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn`, asking `classify` what to do with each failure. Retries back off with
 * full jitter (or sleep `delayMs`, e.g. Retry-After). A `delayMs` above `capMs`
 * throws `RateLimitedError` at once; when attempts run out the last failure becomes
 * `RateLimitedError` (429/403) or `GoogleApiError`. Thrown library errors carry `ids`.
 */
export async function runWithRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions & {
    classify: (err: unknown) => RetryStep;
    ids?: { tenantId?: string; connectionId?: string };
  },
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseMs = opts.baseMs ?? 250;
  const capMs = opts.capMs ?? 8000;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const c = opts.classify(err);
      if (c.kind === "throw") throw c.error;
      const errOpts = { ...opts.ids, cause: err };
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
