import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionRevokedError,
  MissingScopeError,
} from "../../src/core/errors.js";
import { createGoogle } from "../../src/core/create-google.js";
import type { GoogleEvent } from "../../src/core/events.js";
import type { GoogleService } from "../../src/core/scopes.js";
import { withConnectionToken } from "../../src/core/with-token.js";
import { FakeGoogleOAuth } from "../../src/testing/fake-google-oauth.js";
import { InMemoryStore } from "../../src/testing/in-memory-store.js";
import { LocalKeyProvider } from "../../src/testing/local-key-provider.js";

const cfg = {
  actorId: "admin1",
  clientId: "123-abc.apps.googleusercontent.com",
  clientSecret: "GOCSPX-abcdx7Qa",
};
const ops = {
  sub: "s1",
  email: "ops@northwind.example",
  hd: "northwind.example",
  name: "Ops Team",
};

class Unauth extends Error {}
const isUnauthorized = (e: unknown) => e instanceof Unauth;

let store: InMemoryStore;
let fake: FakeGoogleOAuth;
let events: GoogleEvent[];
let g: ReturnType<typeof createGoogle>;
let connId: string;

const connect = async (
  services: GoogleService[],
  identity: typeof ops = ops,
) => {
  const { url } = await g.oauth.createAuthUrl({
    tenantId: "t1",
    actorId: "u1",
    services,
  });
  const { code, state } = fake.consent(url, identity);
  return (await g.oauth.handleCallback({ code, state })).connection;
};

const params = (
  over: { connectionId?: string; service?: GoogleService } = {},
) => ({
  tenantId: "t1",
  connectionId: over.connectionId ?? connId,
  service: over.service ?? ("sheets" as GoogleService),
  isUnauthorized,
});

beforeEach(async () => {
  store = new InMemoryStore();
  fake = new FakeGoogleOAuth();
  events = [];
  g = createGoogle({
    store,
    keyProvider: new LocalKeyProvider(),
    callbackUrl: "https://app.example.com/cb",
    oauthGateway: fake,
    onEvent: (e) => {
      events.push(e);
    },
    logger: { warn: () => {}, error: () => {} },
  });
  await g.clients.configure({ tenantId: "t1", ...cfg });
  connId = (await connect(["sheets"])).id;
  events.length = 0;
});

describe("withConnectionToken", () => {
  it("missing scope → MissingScopeError and fn is not called", async () => {
    const gmailOnly = (
      await connect(["gmail"], {
        sub: "s2",
        email: "admin@northwind.example",
        hd: "northwind.example",
        name: "HR",
      })
    ).id;
    const fn = vi.fn(async () => "never");
    const err: unknown = await withConnectionToken(
      g,
      params({ connectionId: gmailOnly }),
      fn,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MissingScopeError);
    expect(err).toMatchObject({ tenantId: "t1", connectionId: gmailOnly });
    expect(fn).not.toHaveBeenCalled();
  });

  it("checks the scope of the requested service", async () => {
    const fn = vi.fn(async () => "never");
    await expect(
      withConnectionToken(g, params({ service: "calendar" }), fn),
    ).rejects.toBeInstanceOf(MissingScopeError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("passes the access token and a connection view without the refresh token", async () => {
    const fn = vi.fn(async (_token: string, c: object) => c);
    const view = await withConnectionToken(g, params(), fn);
    expect(fn.mock.calls[0]![0]).toMatch(/^ya29\./);
    expect(view).toMatchObject({ id: connId, tenantId: "t1" });
    expect(view).not.toHaveProperty("refreshToken");
  });

  it("first 401 → force-refresh and fn runs again with a different token", async () => {
    const tokens: string[] = [];
    const fn = vi.fn(async (accessToken: string) => {
      tokens.push(accessToken);
      if (tokens.length === 1) throw new Unauth();
      return "ok";
    });
    await expect(withConnectionToken(g, params(), fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(tokens[0]).not.toBe(tokens[1]);
    expect(
      fake.calls.filter((c) => c.method === "refreshAccessToken"),
    ).toHaveLength(1);
    expect(events).toEqual([]);
    expect((await store.getConnection("t1", connId))!.status).toBe("active");
  });

  it("second 401 → ConnectionRevokedError, status revoked, one connection.revoked event", async () => {
    const fn = vi.fn(async () => {
      throw new Unauth();
    });
    const err: unknown = await withConnectionToken(g, params(), fn).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ConnectionRevokedError);
    expect(err).toMatchObject({
      reason: "unauthorized",
      tenantId: "t1",
      connectionId: connId,
    });
    expect(fn).toHaveBeenCalledTimes(2);
    const rec = await store.getConnection("t1", connId);
    expect(rec!.status).toBe("revoked");
    expect(rec!.statusReason).toBe("unauthorized");
    expect(events.map((e) => e.type)).toEqual(["connection.revoked"]);
    expect(events[0]).toMatchObject({
      tenantId: "t1",
      connectionId: connId,
      reason: "unauthorized",
    });
  });

  it("errors other than unauthorized propagate without a refresh", async () => {
    const boom = new Error("boom");
    const fn = vi.fn(async () => {
      throw boom;
    });
    await expect(withConnectionToken(g, params(), fn)).rejects.toBe(boom);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(
      fake.calls.filter((c) => c.method === "refreshAccessToken"),
    ).toHaveLength(0);
  });

  it("success touches the connection (lastUsedAt set)", async () => {
    expect((await store.getConnection("t1", connId))!.lastUsedAt).toBeNull();
    await withConnectionToken(g, params(), async () => 1);
    expect(
      (await store.getConnection("t1", connId))!.lastUsedAt,
    ).toBeInstanceOf(Date);
  });

  it("a failing touch does not fail the call", async () => {
    vi.spyOn(store, "touchConnection").mockRejectedValue(new Error("db down"));
    await expect(withConnectionToken(g, params(), async () => 7)).resolves.toBe(
      7,
    );
  });
});
