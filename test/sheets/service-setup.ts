// Shared setup for the Sheets service tests: a core with one connected account
// and a FakeSheets transport. Not a test file (vitest only collects *.test.ts).
import { createGoogle } from "../../src/core/create-google.js";
import type { GoogleEvent } from "../../src/core/events.js";
import type { GoogleService } from "../../src/core/scopes.js";
import { createSheets } from "../../src/sheets/service.js";
import type { SheetsOptions } from "../../src/sheets/service.js";
import { FakeGoogleOAuth } from "../../src/testing/fake-google-oauth.js";
import { FakeSheets } from "../../src/testing/fake-sheets.js";
import type { FakeSheetsTab } from "../../src/testing/fake-sheets.js";
import { InMemoryStore } from "../../src/testing/in-memory-store.js";
import { LocalKeyProvider } from "../../src/testing/local-key-provider.js";

export const SPREADSHEET_ID = "ss-1";

export async function setup(
  o: {
    tabs?: FakeSheetsTab[];
    services?: GoogleService[];
    options?: Omit<SheetsOptions, "transport">;
  } = {},
) {
  const store = new InMemoryStore();
  const oauth = new FakeGoogleOAuth();
  const events: GoogleEvent[] = [];
  const google = createGoogle({
    store,
    keyProvider: new LocalKeyProvider(),
    callbackUrl: "https://hrms.io/cb",
    oauthGateway: oauth,
    onEvent: (e) => {
      events.push(e);
    },
    logger: { warn: () => {}, error: () => {} },
  });
  await google.clients.configure({
    tenantId: "t1",
    actorId: "admin1",
    clientId: "123-abc.apps.googleusercontent.com",
    clientSecret: "GOCSPX-abcdx7Qa",
  });
  const { url } = await google.oauth.createAuthUrl({
    tenantId: "t1",
    actorId: "u1",
    services: o.services ?? ["sheets"],
  });
  const { code, state } = oauth.consent(url, {
    sub: "s1",
    email: "careers@sunculture.io",
    hd: "sunculture.io",
  });
  const connectionId = (await google.oauth.handleCallback({ code, state }))
    .connection.id;
  events.length = 0;

  const fake = new FakeSheets({ spreadsheetId: SPREADSHEET_ID, tabs: o.tabs });
  const sheets = createSheets(google, {
    transport: fake,
    sleep: async () => {},
    random: () => 0,
    ...o.options,
  });
  const sheet = sheets.open({
    tenantId: "t1",
    connectionId,
    spreadsheetId: SPREADSHEET_ID,
  });
  const ops = (op: string) => fake.calls.filter((c) => c.op === op);
  const refreshes = () =>
    oauth.calls.filter((c) => c.method === "refreshAccessToken").length;
  return {
    store,
    oauth,
    events,
    google,
    fake,
    sheets,
    sheet,
    connectionId,
    ops,
    refreshes,
  };
}

/** A gaxios-shaped network error (no HTTP status). */
export const netError = (code: string): Error =>
  Object.assign(new Error(`network: ${code}`), { code });
