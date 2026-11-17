import { OAuth2Client } from "google-auth-library";
import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createCalendarApiTransport } from "../../src/calendar/transport.js";
import { peerAuthClient } from "../../src/core/peer-auth.js";
import { createGmailApiTransport } from "../../src/gmail/transport.js";
import { createSheetsApiTransport } from "../../src/sheets/transport.js";

/** Answers Google's API hosts here and records the Authorization header sent. */
function interceptGoogle(body: unknown) {
  let authorization: string | undefined;
  const reply = (scope: nock.Interceptor) =>
    scope.reply(function () {
      authorization = this.req.headers.authorization;
      return [200, body];
    });
  const google = nock(/^https:\/\/[a-z]+\.googleapis\.com(:443)?$/).persist();
  reply(google.get(() => true));
  reply(google.post(() => true));
  return () => authorization;
}

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());
afterAll(() => nock.enableNetConnect());

describe("peerAuthClient", () => {
  it("builds the client from the module's own auth", () => {
    class ModuleOAuth2 {
      credentials: unknown;
      setCredentials(c: unknown) {
        this.credentials = c;
      }
    }
    const auth = peerAuthClient({ auth: { OAuth2: ModuleOAuth2 } }, "tok");
    expect(auth).toBeInstanceOf(ModuleOAuth2);
    expect((auth as ModuleOAuth2).credentials).toEqual({ access_token: "tok" });
  });

  it("falls back to this package's client for a module without auth", () => {
    expect(peerAuthClient({}, "tok")).toBeInstanceOf(OAuth2Client);
  });
});

// Through the real @googleapis modules: a client from another google-auth-library
// major is accepted but sends no Authorization header (Google: 403 "unregistered
// callers").
describe("the API transports send the access token", () => {
  const window = {
    timeMin: "2026-12-01T07:00:00Z",
    timeMax: "2026-12-01T08:00:00Z",
  };

  it("calendar", async () => {
    const authorization = interceptGoogle({ calendars: {} });
    await createCalendarApiTransport().freeBusy({
      accessToken: "tok-calendar",
      ...window,
      emails: ["a@example.com"],
    });
    expect(authorization()).toBe("Bearer tok-calendar");
  });

  it("gmail", async () => {
    const authorization = interceptGoogle({ id: "m1", threadId: "t1" });
    await createGmailApiTransport().send({
      accessToken: "tok-gmail",
      raw: Buffer.from("Subject: hi\r\n\r\nhello"),
      threadId: null,
    });
    expect(authorization()).toBe("Bearer tok-gmail");
  });

  it("sheets", async () => {
    const authorization = interceptGoogle({ spreadsheetId: "s1" });
    await createSheetsApiTransport().getSpreadsheet({
      accessToken: "tok-sheets",
      spreadsheetId: "s1",
      fields: "spreadsheetId",
    });
    expect(authorization()).toBe("Bearer tok-sheets");
  });
});
