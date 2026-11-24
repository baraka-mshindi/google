import { JWT } from "google-auth-library";
import {
  GoogleApiError,
  InvalidConfigError,
  ServiceAccountRejectedError,
} from "./errors.js";
import { SERVICE_SCOPES } from "./scopes.js";
import type { GoogleService } from "./scopes.js";

/**
 * Something that hands out Google access tokens for one identity. The Sheets
 * service accepts any implementation; `createServiceAccountTokenSource` is the
 * built-in one, and `/testing` has a static one for tests.
 */
export interface AccessTokenSource {
  /** The identity the tokens belong to; safe to show (e.g. "share the sheet with …"). */
  readonly clientEmail: string;
  /**
   * A token valid for at least the next minute. `forceRefresh` skips the cache,
   * for when Google has just rejected the cached token.
   */
  getAccessToken(opts?: { forceRefresh?: boolean }): Promise<string>;
}

export type MintRequest = {
  clientEmail: string;
  privateKey: string;
  scopes: string[];
};
export type MintedToken = { accessToken: string; expiresAt: number };

export type ServiceAccountOptions = {
  /** `client_email` from the service account's JSON key. */
  clientEmail: string;
  /** `private_key` from the JSON key (PEM). Escaped `\n` from an env var is accepted. */
  privateKey: string;
  /** The services the tokens are for; their scopes are requested. */
  services: GoogleService[];
  /** Tests only: replaces the request to Google's token endpoint. */
  mint?: (req: MintRequest) => Promise<MintedToken>;
  /** Tests only: the clock, in epoch milliseconds. */
  now?: () => number;
};

/** A cached token is replaced this long before Google's expiry. */
const EXPIRY_SKEW_MS = 60_000;
/** Assumed lifetime when Google omits one (its default is an hour). */
const DEFAULT_LIFETIME_MS = 3_600_000;
const PEM_KEY =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----/;

function httpStatus(err: unknown): number | null {
  const status = (err as { response?: { status?: unknown } } | null)?.response
    ?.status;
  return typeof status === "number" ? status : null;
}

function networkCode(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^E[A-Z_]+$/.test(code) ? code : null;
}

/**
 * Token request failures. Google refusing the grant (4xx) is permanent. A 5xx or
 * a network failure may pass, so it is a `GoogleApiError` the caller can retry.
 * Anything else failed before a request was made, which with a valid config means
 * the key could not sign: permanent too.
 */
function mintFailure(clientEmail: string, err: unknown): Error {
  const status = httpStatus(err);
  if (status !== null && status >= 400 && status < 500) {
    return new ServiceAccountRejectedError(clientEmail, undefined, {
      cause: err,
    });
  }
  if (status !== null || networkCode(err) !== null) {
    return new GoogleApiError(status ?? 0, "token_request_failed", {
      cause: err,
    });
  }
  return new ServiceAccountRejectedError(
    clientEmail,
    "The service account's private key could not be used",
    { cause: err },
  );
}

function googleMinter(): (req: MintRequest) => Promise<MintedToken> {
  let client: JWT | null = null;
  return async (req) => {
    client ??= new JWT({
      email: req.clientEmail,
      key: req.privateKey,
      scopes: req.scopes,
    });
    const credentials = await client.authorize();
    if (!credentials.access_token) {
      throw new GoogleApiError(0, "token_request_failed");
    }
    return {
      accessToken: credentials.access_token,
      expiresAt: credentials.expiry_date ?? Date.now() + DEFAULT_LIFETIME_MS,
    };
  };
}

/**
 * Access tokens for a Google service account, through the OAuth 2.0 JWT bearer
 * grant. No store, key provider or tenant is involved: the account itself holds
 * access, so a spreadsheet must be shared with `clientEmail`.
 *
 * Tokens are cached until a minute before they expire, and concurrent callers
 * share one token request. Failures are `ServiceAccountRejectedError`
 * (permanent) or `GoogleApiError` (may pass on retry); the private key never
 * appears in either.
 */
export function createServiceAccountTokenSource(
  opts: ServiceAccountOptions,
): AccessTokenSource {
  const { clientEmail } = opts;
  if (
    typeof clientEmail !== "string" ||
    !/^[^\s@]+@[^\s@]+$/.test(clientEmail)
  ) {
    throw new InvalidConfigError(
      "clientEmail must be the service account's email address",
    );
  }
  const privateKey =
    typeof opts.privateKey === "string"
      ? opts.privateKey.replace(/\\n/g, "\n")
      : "";
  if (!PEM_KEY.test(privateKey)) {
    throw new InvalidConfigError(
      "privateKey must be the PEM private key from the service account's JSON key",
    );
  }
  if (!Array.isArray(opts.services) || opts.services.length === 0) {
    throw new InvalidConfigError("services must name at least one service");
  }
  const scopes = [
    ...new Set(opts.services.flatMap((s) => [...SERVICE_SCOPES[s]])),
  ];
  const mint = opts.mint ?? googleMinter();
  const now = opts.now ?? Date.now;

  let cached: MintedToken | null = null;
  let inFlight: Promise<string> | null = null;

  const refresh = (): Promise<string> => {
    inFlight ??= (async () => {
      try {
        cached = await mint({ clientEmail, privateKey, scopes });
        return cached.accessToken;
      } catch (err) {
        cached = null;
        throw err instanceof ServiceAccountRejectedError ||
          err instanceof GoogleApiError
          ? err
          : mintFailure(clientEmail, err);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  return {
    clientEmail,
    getAccessToken({ forceRefresh = false } = {}) {
      if (inFlight) return inFlight;
      if (
        !forceRefresh &&
        cached &&
        cached.expiresAt - EXPIRY_SKEW_MS > now()
      ) {
        return Promise.resolve(cached.accessToken);
      }
      return refresh();
    },
  };
}
