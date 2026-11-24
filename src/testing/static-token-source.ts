import type { AccessTokenSource } from "../core/service-account.js";

/**
 * An `AccessTokenSource` for tests: hands out fixed tokens with no key and no
 * network. Each forced refresh moves to the next token (the last one repeats);
 * `requests` records every call and `failNext` queues an error.
 */
export class StaticTokenSource implements AccessTokenSource {
  readonly clientEmail: string;
  readonly requests: { forceRefresh: boolean }[] = [];
  private readonly tokens: string[];
  private index = 0;
  private readonly failures: unknown[] = [];

  constructor(o: { clientEmail?: string; tokens?: string[] } = {}) {
    this.clientEmail =
      o.clientEmail ?? "sheets-test@example.iam.gserviceaccount.com";
    this.tokens = o.tokens && o.tokens.length > 0 ? o.tokens : ["test-token"];
  }

  failNext(err: unknown): void {
    this.failures.push(err);
  }

  async getAccessToken({ forceRefresh = false } = {}): Promise<string> {
    this.requests.push({ forceRefresh });
    if (this.failures.length > 0) throw this.failures.shift();
    if (forceRefresh) {
      this.index = Math.min(this.index + 1, this.tokens.length - 1);
    }
    return this.tokens[this.index]!;
  }
}
