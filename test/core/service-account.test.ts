import { generateKeyPairSync } from "node:crypto";
import nock from "nock";
import { afterEach, describe, expect, it } from "vitest";
import {
  GoogleApiError,
  InvalidConfigError,
  ServiceAccountRejectedError,
} from "../../src/core/errors.js";
import { SERVICE_SCOPES } from "../../src/core/scopes.js";
import {
  createServiceAccountTokenSource,
  type MintRequest,
  type MintedToken,
} from "../../src/core/service-account.js";
import { PEM_LABEL, fakePem } from "./fixtures/fake-pem.js";

const EMAIL = "amt-sheets@amt-prod.iam.gserviceaccount.com";
const PEM = fakePem("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC-not-a-real-key");

function minter(answers: (MintedToken | Error)[]): {
  mint: (r: MintRequest) => Promise<MintedToken>;
  requests: MintRequest[];
} {
  const requests: MintRequest[] = [];
  return {
    requests,
    mint: async (r) => {
      requests.push(r);
      const next = answers.shift();
      if (!next) throw new Error("no more answers");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const httpError = (status: number, body: object): Error =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: body },
  });

describe("createServiceAccountTokenSource: configuration", () => {
  it("rejects an empty or malformed client email", () => {
    for (const clientEmail of ["", "not-an-email", 42 as unknown as string]) {
      expect(() =>
        createServiceAccountTokenSource({
          clientEmail,
          privateKey: PEM,
          services: ["sheets"],
        }),
      ).toThrow(InvalidConfigError);
    }
  });

  it("rejects a private key that is not PEM, without echoing it", () => {
    const secret = "super-secret-material";
    try {
      createServiceAccountTokenSource({
        clientEmail: EMAIL,
        privateKey: secret,
        services: ["sheets"],
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidConfigError);
      expect(String((err as Error).message)).not.toContain(secret);
    }
  });

  it("accepts a key whose newlines arrived escaped from an env var", async () => {
    const { mint, requests } = minter([
      { accessToken: "ya29.a", expiresAt: Date.now() + 3600_000 },
    ]);
    const source = createServiceAccountTokenSource({
      clientEmail: EMAIL,
      privateKey: PEM.replace(/\n/g, "\\n"),
      services: ["sheets"],
      mint,
    });
    await source.getAccessToken();
    expect(requests[0]!.privateKey).toBe(PEM);
  });

  it("requires at least one service", () => {
    expect(() =>
      createServiceAccountTokenSource({
        clientEmail: EMAIL,
        privateKey: PEM,
        services: [],
      }),
    ).toThrow(InvalidConfigError);
  });

  it("asks for exactly the services' scopes, without the OAuth base scopes", async () => {
    const { mint, requests } = minter([
      { accessToken: "ya29.a", expiresAt: Date.now() + 3600_000 },
    ]);
    const source = createServiceAccountTokenSource({
      clientEmail: EMAIL,
      privateKey: PEM,
      services: ["sheets"],
      mint,
    });
    await source.getAccessToken();
    expect(requests[0]!.scopes).toEqual([...SERVICE_SCOPES.sheets]);
    expect(source.clientEmail).toBe(EMAIL);
  });
});

describe("createServiceAccountTokenSource: caching", () => {
  it("reuses a token until shortly before it expires", async () => {
    let now = 1_000_000;
    const { mint, requests } = minter([
      { accessToken: "ya29.first", expiresAt: now + 3600_000 },
      { accessToken: "ya29.second", expiresAt: now + 7200_000 },
    ]);
    const source = createServiceAccountTokenSource({
      clientEmail: EMAIL,
      privateKey: PEM,
      services: ["sheets"],
      mint,
      now: () => now,
    });
    expect(await source.getAccessToken()).toBe("ya29.first");
    now += 3600_000 - 61_000;
    expect(await source.getAccessToken()).toBe("ya29.first");
    now += 2_000;
    expect(await source.getAccessToken()).toBe("ya29.second");
    expect(requests).toHaveLength(2);
  });

  it("mints once for concurrent callers", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const source = createServiceAccountTokenSource({
      clientEmail: EMAIL,
      privateKey: PEM,
      services: ["sheets"],
      mint: async () => {
        calls += 1;
        await gate;
        return { accessToken: "ya29.one", expiresAt: Date.now() + 3600_000 };
      },
    });
    const all = Promise.all([
      source.getAccessToken(),
      source.getAccessToken(),
      source.getAccessToken({ forceRefresh: true }),
    ]);
    release();
    expect(await all).toEqual(["ya29.one", "ya29.one", "ya29.one"]);
    expect(calls).toBe(1);
  });

  it("forceRefresh mints a new token even when the cached one is fresh", async () => {
    const { mint } = minter([
      { accessToken: "ya29.first", expiresAt: Date.now() + 3600_000 },
      { accessToken: "ya29.second", expiresAt: Date.now() + 3600_000 },
    ]);
    const source = createServiceAccountTokenSource({
      clientEmail: EMAIL,
      privateKey: PEM,
      services: ["sheets"],
      mint,
    });
    expect(await source.getAccessToken()).toBe("ya29.first");
    expect(await source.getAccessToken({ forceRefresh: true })).toBe(
      "ya29.second",
    );
  });

  it("does not cache a failed mint", async () => {
    const { mint } = minter([
      Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
      { accessToken: "ya29.ok", expiresAt: Date.now() + 3600_000 },
    ]);
    const source = createServiceAccountTokenSource({
      clientEmail: EMAIL,
      privateKey: PEM,
      services: ["sheets"],
      mint,
    });
    await expect(source.getAccessToken()).rejects.toBeInstanceOf(
      GoogleApiError,
    );
    expect(await source.getAccessToken()).toBe("ya29.ok");
  });
});

describe("createServiceAccountTokenSource: failures", () => {
  it.each([
    [
      400,
      { error: "invalid_grant", error_description: "Invalid JWT Signature." },
    ],
    [401, { error: "unauthorized_client" }],
    [403, { error: "access_denied" }],
  ])(
    "a %i from the token endpoint is ServiceAccountRejectedError",
    async (status, body) => {
      const { mint } = minter([httpError(status, body)]);
      const source = createServiceAccountTokenSource({
        clientEmail: EMAIL,
        privateKey: PEM,
        services: ["sheets"],
        mint,
      });
      const err = await source.getAccessToken().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ServiceAccountRejectedError);
      expect((err as ServiceAccountRejectedError).code).toBe(
        "service_account_rejected",
      );
      expect((err as ServiceAccountRejectedError).clientEmail).toBe(EMAIL);
    },
  );

  it("a network failure or 5xx is a GoogleApiError a caller may retry", async () => {
    const { mint } = minter([
      httpError(503, { error: "backendError" }),
      Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
    ]);
    const source = createServiceAccountTokenSource({
      clientEmail: EMAIL,
      privateKey: PEM,
      services: ["sheets"],
      mint,
    });
    const first = await source.getAccessToken().catch((e: unknown) => e);
    expect(first).toBeInstanceOf(GoogleApiError);
    expect((first as GoogleApiError).status).toBe(503);
    const second = await source.getAccessToken().catch((e: unknown) => e);
    expect(second).toBeInstanceOf(GoogleApiError);
    expect((second as GoogleApiError).reason).toBe("token_request_failed");
  });

  it("never lets the private key into an error, even when the cause quotes it", async () => {
    const { mint } = minter([
      httpError(400, { error: "invalid_grant", error_description: PEM }),
      new Error(`bad key ${PEM}`),
    ]);
    const source = createServiceAccountTokenSource({
      clientEmail: EMAIL,
      privateKey: PEM,
      services: ["sheets"],
      mint,
    });
    for (let i = 0; i < 2; i++) {
      const err = (await source
        .getAccessToken()
        .catch((e: unknown) => e)) as Error;
      const seen = [
        err.message,
        err.stack ?? "",
        (err.cause as Error | undefined)?.message ?? "",
        (err.cause as Error | undefined)?.stack ?? "",
        JSON.stringify(err),
      ].join("\n");
      expect(seen).not.toContain("not-a-real-key");
      expect(seen).not.toContain(`BEGIN ${PEM_LABEL}`);
    }
  });
});

describe("createServiceAccountTokenSource: default minter", () => {
  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it("signs a JWT grant with the key and returns Google's token", async () => {
    nock.disableNetConnect();
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    let assertion = "";
    nock("https://www.googleapis.com")
      .post("/oauth2/v4/token", (body: Record<string, string>) => {
        assertion = body.assertion ?? "";
        return (
          body.grant_type === "urn:ietf:params:oauth:grant-type:jwt-bearer"
        );
      })
      .reply(200, {
        access_token: "ya29.minted",
        expires_in: 3599,
        token_type: "Bearer",
      });

    const source = createServiceAccountTokenSource({
      clientEmail: EMAIL,
      privateKey: pem,
      services: ["sheets"],
    });
    expect(await source.getAccessToken()).toBe("ya29.minted");
    const claims = JSON.parse(
      Buffer.from(assertion.split(".")[1]!, "base64url").toString(),
    ) as { iss: string; scope: string };
    expect(claims.iss).toBe(EMAIL);
    expect(claims.scope).toBe(SERVICE_SCOPES.sheets.join(" "));
  });

  it("maps Google's invalid_grant to ServiceAccountRejectedError", async () => {
    nock.disableNetConnect();
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    nock("https://www.googleapis.com").post("/oauth2/v4/token").reply(400, {
      error: "invalid_grant",
      error_description: "Invalid JWT Signature.",
    });
    const source = createServiceAccountTokenSource({
      clientEmail: EMAIL,
      privateKey: pem,
      services: ["sheets"],
    });
    await expect(source.getAccessToken()).rejects.toBeInstanceOf(
      ServiceAccountRejectedError,
    );
  });
});
