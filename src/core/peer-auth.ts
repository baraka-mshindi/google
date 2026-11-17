import { OAuth2Client } from "google-auth-library";

/** What a `@googleapis/*` module exports for auth (googleapis-common's AuthPlus). */
export type PeerAuthModule = {
  auth?: { OAuth2?: new () => PeerOAuth2Client };
};

type PeerOAuth2Client = {
  setCredentials(credentials: { access_token: string }): void;
};

/**
 * An OAuth2 client holding `accessToken`, built from the API module's own
 * `auth.OAuth2` so it matches the google-auth-library that module calls with.
 * A client from another major version is accepted but adds no Authorization
 * header (v9's client with v10's googleapis-common), so Google answers 403
 * "unregistered callers". Falls back to this package's client for a module
 * without `auth`.
 */
export function peerAuthClient(
  mod: PeerAuthModule,
  accessToken: string,
): unknown {
  const Client = mod.auth?.OAuth2 ?? OAuth2Client;
  const auth = new Client();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}
