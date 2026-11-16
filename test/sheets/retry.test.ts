import { describe, expect, it, vi } from "vitest";
import {
  GoogleApiError,
  GoogleLibError,
  InvalidSheetsInputError,
  RateLimitedError,
  SheetTabNotFoundError,
  SheetsWriteOutcomeUnknownError,
  SpreadsheetAccessDeniedError,
  SpreadsheetNotFoundError,
} from "../../src/core/errors.js";
import {
  SheetsUnauthorizedSignal,
  classifySheetsError,
  withSheetsRetry,
} from "../../src/sheets/retry.js";

const http = (
  status: number,
  reason?: string,
  extra: { headers?: Record<string, string>; message?: string } = {},
) =>
  Object.assign(new Error(extra.message ?? `http ${status}`), {
    response: {
      status,
      headers: extra.headers ?? {},
      data: {
        error: { errors: reason ? [{ reason }] : [], message: extra.message },
      },
    },
  });
const net = (code: string) => Object.assign(new Error(code), { code });
const ids = { tenantId: "t1", connectionId: "c1" };
const opts = (idempotent: boolean) => ({
  idempotent,
  ids,
  sleep: vi.fn().mockResolvedValue(undefined),
  random: () => 1,
});
const failOf = (err: unknown, idempotent: boolean): GoogleLibError => {
  const c = classifySheetsError(err, idempotent);
  expect(c.kind).toBe("fail");
  if (c.kind !== "fail") throw new Error("unreachable");
  return c.error;
};
const run = async (
  errs: unknown[],
  idempotent: boolean,
): Promise<{
  err: any;
  fn: ReturnType<typeof vi.fn>;
  o: ReturnType<typeof opts>;
}> => {
  const fn = vi.fn();
  for (const e of errs) fn.mockRejectedValueOnce(e);
  fn.mockRejectedValue(errs[errs.length - 1]);
  const o = opts(idempotent);
  const err = await withSheetsRetry(fn, o).catch((e: unknown) => e);
  return { err, fn, o };
};

const BOTH = [true, false] as const;

describe("classifySheetsError", () => {
  it.each(BOTH)("passes GoogleLibError through (idempotent=%s)", (idem) => {
    const e = new InvalidSheetsInputError("range");
    expect(classifySheetsError(e, idem)).toEqual({ kind: "fail", error: e });
  });

  describe.each(BOTH)("rate limits retry (idempotent=%s)", (idem) => {
    it.each([
      ["429", http(429), null],
      ["403 rateLimitExceeded", http(403, "rateLimitExceeded"), null],
      ["403 userRateLimitExceeded", http(403, "userRateLimitExceeded"), null],
      [
        "429 retry-after",
        http(429, undefined, { headers: { "retry-after": "2" } }),
        2000,
      ],
    ])("%s", (_n, err, delayMs) => {
      expect(classifySheetsError(err, idem)).toEqual({
        kind: "retry",
        delayMs,
      });
    });
  });

  it.each(BOTH)("401 → unauthorized (idempotent=%s)", (idem) => {
    expect(classifySheetsError(http(401), idem)).toEqual({
      kind: "unauthorized",
    });
  });

  it.each(BOTH)("404 → SpreadsheetNotFoundError (idempotent=%s)", (idem) => {
    expect(failOf(http(404, "notFound"), idem)).toBeInstanceOf(
      SpreadsheetNotFoundError,
    );
  });

  it.each(BOTH)(
    "non-rate 403 → SpreadsheetAccessDeniedError (idempotent=%s)",
    (idem) => {
      expect(failOf(http(403, "forbidden"), idem)).toBeInstanceOf(
        SpreadsheetAccessDeniedError,
      );
      expect(failOf(http(403), idem)).toBeInstanceOf(
        SpreadsheetAccessDeniedError,
      );
    },
  );

  describe.each(BOTH)(
    "400 Unable to parse range → SheetTabNotFoundError (idempotent=%s)",
    (idem) => {
      it.each([
        ["plain tab", "Unable to parse range: Missing!A1:B2", "Missing"],
        [
          "quoted tab with spaces and an escaped quote",
          "Unable to parse range: 'Bob''s Tab'!A1",
          "Bob's Tab",
        ],
        ["tab without cells", "Unable to parse range: Ghost", "Ghost"],
        [
          "quoted tab with ! and no cells",
          "Unable to parse range: 'A!B'",
          "A!B",
        ],
        [
          "quoted tab with ! and cells",
          "Unable to parse range: 'A!B'!C1",
          "A!B",
        ],
        ["unparseable message", "unable to parse range", ""],
      ])("%s", (_n, message, tab) => {
        const e = failOf(http(400, "badRequest", { message }), idem);
        expect(e).toBeInstanceOf(SheetTabNotFoundError);
        expect((e as SheetTabNotFoundError).tab).toBe(tab);
      });
    },
  );

  it.each(BOTH)(
    "reads the tab from the response message when the top-level message differs (idempotent=%s)",
    (idem) => {
      const err = Object.assign(new Error("Request failed"), {
        response: {
          status: 400,
          data: {
            error: {
              message: "Unable to parse range: Q4 Sales!A:A",
              errors: [],
            },
          },
        },
      });
      const e = failOf(err, idem);
      expect(e).toBeInstanceOf(SheetTabNotFoundError);
      expect((e as SheetTabNotFoundError).tab).toBe("Q4 Sales");
    },
  );

  describe.each(BOTH)("other 4xx → GoogleApiError (idempotent=%s)", (idem) => {
    it.each([
      [
        http(400, "badRequest", { message: "Invalid values" }),
        400,
        "badRequest",
      ],
      [http(409, "conflict"), 409, "conflict"],
      [http(418), 418, null],
    ] as const)("%#", (err, status, reason) => {
      const e = failOf(err, idem);
      expect(e).toBeInstanceOf(GoogleApiError);
      expect((e as GoogleApiError).status).toBe(status);
      expect((e as GoogleApiError).reason).toBe(reason);
    });
  });

  const AMBIGUOUS: [string, unknown][] = [
    ["500", http(500)],
    ["503", http(503, "backendError")],
    ["ETIMEDOUT", net("ETIMEDOUT")],
    ["ECONNRESET", net("ECONNRESET")],
    ["ESOCKETTIMEDOUT", net("ESOCKETTIMEDOUT")],
    ["ABORT_ERR", net("ABORT_ERR")],
    ["AbortError", Object.assign(new Error("x"), { name: "AbortError" })],
    ["socket hang up", new Error("socket hang up")],
    [
      "code on cause",
      Object.assign(new Error("fetch failed"), {
        cause: { code: "ECONNRESET" },
      }),
    ],
  ];
  const PRE_SEND: [string, unknown][] = [
    ["TLS", net("ERR_TLS_CERT_ALTNAME_INVALID")],
    ["CERT", net("CERT_HAS_EXPIRED")],
    ["ENOTFOUND", net("ENOTFOUND")],
    ["EAI_AGAIN", net("EAI_AGAIN")],
    ["ECONNREFUSED", net("ECONNREFUSED")],
  ];

  it.each([...AMBIGUOUS, ...PRE_SEND])("idempotent: retries %s", (_n, err) => {
    expect(classifySheetsError(err, true)).toEqual({
      kind: "retry",
      delayMs: null,
    });
  });

  it.each(PRE_SEND)("non-idempotent: retries pre-send %s", (_n, err) => {
    expect(classifySheetsError(err, false)).toEqual({
      kind: "retry",
      delayMs: null,
    });
  });

  it.each(AMBIGUOUS)(
    "non-idempotent: %s → SheetsWriteOutcomeUnknownError",
    (_n, err) => {
      expect(failOf(err, false)).toBeInstanceOf(SheetsWriteOutcomeUnknownError);
    },
  );

  it("unknown failure: idempotent → GoogleApiError(0, code); non-idempotent → outcome unknown", () => {
    const e = failOf(net("EWEIRD"), true);
    expect(e).toBeInstanceOf(GoogleApiError);
    expect((e as GoogleApiError).status).toBe(0);
    expect((e as GoogleApiError).reason).toBe("EWEIRD");
    expect(failOf(net("EWEIRD"), false)).toBeInstanceOf(
      SheetsWriteOutcomeUnknownError,
    );
    expect(failOf(new Error("?"), false)).toBeInstanceOf(
      SheetsWriteOutcomeUnknownError,
    );
  });

  it("classified errors carry the raw error as a scrubbed cause", () => {
    const raw = http(404);
    const e = failOf(raw, true);
    expect(e.cause).toBeInstanceOf(Error);
    expect((e.cause as Error).message).toBe("http 404");
    expect(e.cause).not.toBe(raw);
  });
});

describe("withSheetsRetry", () => {
  it("append-style ETIMEDOUT → SheetsWriteOutcomeUnknownError after exactly 1 call", async () => {
    const { err, fn, o } = await run([net("ETIMEDOUT")], false);
    expect(err).toBeInstanceOf(SheetsWriteOutcomeUnknownError);
    expect(err).toMatchObject(ids);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(o.sleep).not.toHaveBeenCalled();
  });

  it("append-style 503 → SheetsWriteOutcomeUnknownError after exactly 1 call", async () => {
    const { err, fn, o } = await run([http(503)], false);
    expect(err).toBeInstanceOf(SheetsWriteOutcomeUnknownError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(o.sleep).not.toHaveBeenCalled();
  });

  it("append-style ECONNREFUSED is retried", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(net("ECONNREFUSED"))
      .mockResolvedValue("ok");
    const o = opts(false);
    await expect(withSheetsRetry(fn, o)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(o.sleep).toHaveBeenCalledTimes(1);
  });

  it("append-style ECONNREFUSED exhausted → GoogleApiError(0, ECONNREFUSED)", async () => {
    const { err, fn } = await run([net("ECONNREFUSED")], false);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).toMatchObject({ status: 0, reason: "ECONNREFUSED", ...ids });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it.each(BOTH)(
    "429 then success → 2 calls, sleeps the Retry-After value (idempotent=%s)",
    async (idem) => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(
          http(429, undefined, { headers: { "retry-after": "2" } }),
        )
        .mockResolvedValue("ok");
      const o = opts(idem);
      await expect(withSheetsRetry(fn, o)).resolves.toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
      expect(o.sleep).toHaveBeenCalledTimes(1);
      expect(o.sleep).toHaveBeenCalledWith(2000);
    },
  );

  it("idempotent 503 twice then success → 3 calls", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(http(503))
      .mockRejectedValueOnce(net("ETIMEDOUT"))
      .mockResolvedValue("ok");
    const o = opts(true);
    await expect(withSheetsRetry(fn, o)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(o.sleep).toHaveBeenCalledTimes(2);
  });

  it("idempotent exhausted 5xx → GoogleApiError(status, reason)", async () => {
    const { err, fn } = await run([http(503, "backendError")], true);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).toMatchObject({ status: 503, reason: "backendError", ...ids });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("idempotent exhausted ETIMEDOUT → GoogleApiError(0, ETIMEDOUT)", async () => {
    const { err } = await run([net("ETIMEDOUT")], true);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).toMatchObject({ status: 0, reason: "ETIMEDOUT" });
  });

  it.each(BOTH)(
    "exhausted 429 / rate-limit 403 → RateLimitedError (idempotent=%s)",
    async (idem) => {
      for (const e of [http(429), http(403, "userRateLimitExceeded")]) {
        const { err, fn } = await run([e], idem);
        expect(err).toBeInstanceOf(RateLimitedError);
        expect(err).toMatchObject(ids);
        expect(fn).toHaveBeenCalledTimes(3);
      }
    },
  );

  it.each(BOTH)(
    "Retry-After above the cap → RateLimitedError without sleeping (idempotent=%s)",
    async (idem) => {
      const { err, fn, o } = await run(
        [http(429, undefined, { headers: { "retry-after": "30" } })],
        idem,
      );
      expect(err).toBeInstanceOf(RateLimitedError);
      expect(err.retryAfterMs).toBe(30000);
      expect(err).toMatchObject(ids);
      expect(o.sleep).not.toHaveBeenCalled();
      expect(fn).toHaveBeenCalledTimes(1);
    },
  );

  it.each(BOTH)(
    "401 → SheetsUnauthorizedSignal without retrying (idempotent=%s)",
    async (idem) => {
      const { err, fn } = await run([http(401)], idem);
      expect(err).toBeInstanceOf(SheetsUnauthorizedSignal);
      expect(fn).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [http(404), SpreadsheetNotFoundError],
    [http(403, "forbidden"), SpreadsheetAccessDeniedError],
    [
      http(400, "badRequest", { message: "Unable to parse range: X!A1" }),
      SheetTabNotFoundError,
    ],
    [http(400, "badRequest"), GoogleApiError],
  ] as const)(
    "terminal %# → classified error with ids after 1 call",
    async (raw, Cls) => {
      const { err, fn } = await run([raw], true);
      expect(err).toBeInstanceOf(Cls);
      expect(err).toMatchObject(ids);
      expect(fn).toHaveBeenCalledTimes(1);
    },
  );

  it("a GoogleLibError thrown by fn passes through unchanged", async () => {
    const e = new InvalidSheetsInputError("values");
    const { err, fn } = await run([e], false);
    expect(err).toBe(e);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it.each(BOTH)(
    "classified errors never carry the bearer token (plain object, idempotent=%s)",
    async (idem) => {
      const raw = {
        message: "Request failed ya29.SECRET",
        code: 500,
        config: { headers: { Authorization: "Bearer ya29.SECRET" } },
        response: { status: 500 },
      };
      const { err, fn } = await run([raw], idem);
      expect(err).toBeInstanceOf(
        idem ? GoogleApiError : SheetsWriteOutcomeUnknownError,
      );
      expect(fn).toHaveBeenCalledTimes(idem ? 3 : 1);
      expect(err.message).not.toContain("ya29.SECRET");
      expect(String(err)).not.toContain("ya29.SECRET");
      expect(JSON.stringify(err)).not.toContain("ya29.SECRET");
      expect(String(err.cause)).not.toContain("ya29.SECRET");
      expect(JSON.stringify(err.cause)).not.toContain("ya29.SECRET");
    },
  );

  it.each(BOTH)(
    "classified errors never carry the bearer token (Error, idempotent=%s)",
    async (idem) => {
      const raw = Object.assign(new Error("Request failed ya29.SECRET"), {
        code: 500,
        config: { headers: { Authorization: "Bearer ya29.SECRET" } },
        response: { status: 500 },
      });
      const { err, fn } = await run([raw], idem);
      expect(err).toBeInstanceOf(
        idem ? GoogleApiError : SheetsWriteOutcomeUnknownError,
      );
      expect(fn).toHaveBeenCalledTimes(idem ? 3 : 1);
      // Redaction actually ran: the scrubbed cause keeps the message shape.
      expect(err.cause.message).toBe("Request failed [REDACTED]");
      expect(err.message).not.toContain("ya29.SECRET");
      expect(String(err)).not.toContain("ya29.SECRET");
      expect(JSON.stringify(err)).not.toContain("ya29.SECRET");
      expect(String(err.cause)).not.toContain("ya29.SECRET");
      expect(err.cause.stack).toBeTypeOf("string");
      expect(err.cause.stack).not.toContain("ya29.SECRET");
    },
  );
});
