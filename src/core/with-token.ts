// Shared connection token path for the service modules. Internal: not part of /core.
import type { GoogleCore } from "./create-google.js";
import { internals } from "./create-google.js";
import { ConnectionRevokedError } from "./errors.js";
import { assertServiceScopes } from "./scopes.js";
import type { GoogleService } from "./scopes.js";
import type { ConnectionView } from "./types.js";

/**
 * Gets an access token, checks the connection holds `service`'s scopes, then runs
 * `fn`. When `fn` fails with an error `isUnauthorized` accepts (Google answered 401,
 * so the request was not applied), the token is force-refreshed and `fn` runs once
 * more; a second 401 marks the connection revoked, emits `connection.revoked` and
 * throws `ConnectionRevokedError`. A success touches the connection (best effort).
 */
export async function withConnectionToken<T>(
  google: GoogleCore,
  p: {
    tenantId: string;
    connectionId: string;
    service: GoogleService;
    isUnauthorized: (err: unknown) => boolean;
  },
  fn: (accessToken: string, connection: ConnectionView) => Promise<T>,
): Promise<T> {
  const { tenantId, connectionId } = p;
  const { store, tokens, emit, now, logger } = google[internals];
  const first = await tokens.getAccessToken(tenantId, connectionId);
  const { refreshToken: _omit, ...view } = first.connection;
  void _omit;
  assertServiceScopes(view.scopes, [p.service], { tenantId, connectionId });

  let result: T;
  try {
    result = await fn(first.accessToken, view);
  } catch (err) {
    if (!p.isUnauthorized(err)) throw err;
    const fresh = await tokens.getAccessToken(tenantId, connectionId, {
      forceRefresh: true,
    });
    try {
      result = await fn(fresh.accessToken, view);
    } catch (err2) {
      if (!p.isUnauthorized(err2)) throw err2;
      await store.updateConnectionStatus(
        tenantId,
        connectionId,
        "revoked",
        "unauthorized",
      );
      tokens.evict(connectionId);
      await emit({
        type: "connection.revoked",
        tenantId,
        connectionId,
        reason: "unauthorized",
        at: now(),
      });
      throw new ConnectionRevokedError("unauthorized", {
        tenantId,
        connectionId,
      });
    }
  }
  try {
    await store.touchConnection(tenantId, connectionId, now());
  } catch {
    try {
      logger?.warn("google touchConnection failed");
    } catch {
      // logging must never break the caller
    }
  }
  return result;
}
