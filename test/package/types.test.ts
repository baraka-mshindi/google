import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Requires `npm run build` first (see the test:package script).
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dist = resolve(root, "dist");
const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/lib/tsc.js");

const PEER = "@googleapis/sheets";
const NON_SHEETS = ["core", "gmail", "calendar", "postgres", "testing"];

/** Every specifier in `import … from '…'`, `export … from '…'` and `import '…'`. */
function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g))
    out.push(m[1]!);
  for (const m of source.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) {
    out.push(m[1]!);
  }
  return out;
}

/** The declaration files reachable from `entry` through relative imports. */
function reachable(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    const source = readFileSync(file, "utf8");
    seen.set(file, source);
    for (const spec of specifiers(source)) {
      if (!spec.startsWith(".")) continue;
      const target = resolve(dirname(file), spec)
        .replace(/\.cjs$/, ".d.cts")
        .replace(/\.js$/, ".d.ts");
      visit(target);
    }
  };
  visit(entry);
  return seen;
}

describe("type declarations", () => {
  it.each(NON_SHEETS.flatMap((e) => [`${e}.d.ts`, `${e}.d.cts`]))(
    "%s reaches no declaration that imports the optional Sheets peer",
    (file) => {
      const files = reachable(resolve(dist, file));
      expect(files.size).toBeGreaterThan(0);
      for (const [path, source] of files) {
        expect(
          specifiers(source).filter(
            (s) => s === PEER || s.startsWith(`${PEER}/`),
          ),
          path,
        ).toEqual([]);
      }
    },
  );

  describe("a consumer without the Sheets peer installed", () => {
    // A copy, not a symlink: a symlink would resolve to the repo, whose
    // node_modules has the peer, and the check would pass for the wrong reason.
    let app: string;

    beforeAll(() => {
      app = mkdtempSync(join(tmpdir(), "mshindi-google-types-"));
      const pkg = join(app, "node_modules", "@mshindi-labs", "google");
      mkdirSync(pkg, { recursive: true });
      cpSync(dist, join(pkg, "dist"), { recursive: true });
      cpSync(join(root, "package.json"), join(pkg, "package.json"));
      writeFileSync(
        join(app, "package.json"),
        JSON.stringify({ name: "consumer", private: true, type: "module" }),
      );
    });

    afterAll(() => {
      if (app) rmSync(app, { recursive: true, force: true });
    });

    /** Type-checks `files` in the sandbox with `skipLibCheck: false`; returns tsc output. */
    function typecheck(files: Record<string, string>): {
      ok: boolean;
      output: string;
    } {
      for (const [name, source] of Object.entries(files)) {
        writeFileSync(join(app, name), source);
      }
      writeFileSync(
        join(app, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "nodenext",
            moduleResolution: "nodenext",
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            types: ["node"],
            typeRoots: [join(root, "node_modules", "@types")],
          },
          files: Object.keys(files),
        }),
      );
      try {
        const output = execFileSync(
          process.execPath,
          [tsc, "-p", join(app, "tsconfig.json")],
          { cwd: app, encoding: "utf8", stdio: "pipe" },
        );
        return { ok: true, output };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string };
        return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
      }
    }

    it("the sandbox cannot resolve the peer", () => {
      expect(existsSync(join(app, "node_modules", "@googleapis"))).toBe(false);
      // Control: /sheets needs the peer's types, so without it tsc must fail.
      const r = typecheck({
        "sheets.mts": `import { req } from "@mshindi-labs/google/sheets";\nexport const r = req.hideTab("Log");\n`,
      });
      expect(r.ok, r.output).toBe(false);
      expect(r.output).toContain("TS2307");
      expect(r.output).toContain(PEER);
    }, 60_000);

    it("/testing, /core, /gmail, /calendar and /postgres type-check (ESM and CJS)", () => {
      const imports = [
        `import { InMemoryStore, FakeSheets, FakeCalendar } from "@mshindi-labs/google/testing";`,
        `import { createGoogle } from "@mshindi-labs/google/core";`,
        `import { createGmail } from "@mshindi-labs/google/gmail";`,
        `import { createCalendar } from "@mshindi-labs/google/calendar";`,
        `import { createPostgresStore } from "@mshindi-labs/google/postgres";`,
      ].join("\n");
      const body = [
        `export const store = new InMemoryStore();`,
        `export const fake = new FakeSheets();`,
        `export const used = [createGoogle, createGmail, createCalendar, createPostgresStore, FakeCalendar];`,
      ].join("\n");
      // In a .cts file the same imports resolve through the "require"
      // condition, so this checks the .d.cts declarations too.
      const r = typecheck({
        "esm.mts": `${imports}\n${body}\n`,
        "cjs.cts": `${imports}\n${body}\n`,
      });
      expect(r.ok, r.output).toBe(true);
    }, 60_000);
  });
});
