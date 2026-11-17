import { InvalidSheetsInputError } from "../core/errors.js";
import type { CellInput, InputMode } from "./types.js";

type Encoded = string | number | boolean;

function isFormula(cell: unknown): cell is { formula: string } {
  return (
    typeof cell === "object" &&
    cell !== null &&
    !Array.isArray(cell) &&
    Object.keys(cell).length === 1 &&
    typeof (cell as { formula?: unknown }).formula === "string" &&
    (cell as { formula: string }).formula.startsWith("=") &&
    (cell as { formula: string }).formula.slice(1).trim() !== ""
  );
}

/**
 * Encodes cells for `values.update` / `values.append`. Under `raw` (default)
 * plain strings must stay literal; if any cell is a formula the request has to
 * be USER_ENTERED, so every non-empty plain string gets a leading `'` to keep
 * it literal there too.
 */
export function encodeRows(
  rows: CellInput[][],
  mode: InputMode,
  field = "values",
): {
  valueInputOption: "RAW" | "USER_ENTERED";
  values: Encoded[][];
} {
  if (mode !== "raw" && mode !== "user_entered") {
    throw new InvalidSheetsInputError(
      "input",
      'Invalid input mode: expected "raw" or "user_entered"',
    );
  }
  const invalid = (detail: string) =>
    new InvalidSheetsInputError(field, `Invalid ${field}: ${detail}`);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw invalid("expected a non-empty array of rows");
  }
  let hasFormula = false;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length === 0) {
      throw invalid("every row must be a non-empty array");
    }
    for (const cell of row as unknown[]) {
      if (isFormula(cell)) hasFormula = true;
      else if (
        cell !== null &&
        typeof cell !== "string" &&
        typeof cell !== "boolean" &&
        !(typeof cell === "number" && Number.isFinite(cell))
      ) {
        throw invalid(
          "cells must be string, finite number, boolean, null, or { formula: '=...' }",
        );
      }
    }
  }
  const userEntered = mode === "user_entered" || hasFormula;
  const prefix = mode === "raw" && hasFormula;
  const values = rows.map((row) =>
    row.map((cell): Encoded => {
      if (cell === null) return "";
      if (typeof cell === "object") return cell.formula;
      if (prefix && typeof cell === "string" && cell !== "") return `'${cell}`;
      return cell;
    }),
  );
  return {
    valueInputOption: userEntered ? "USER_ENTERED" : "RAW",
    values,
  };
}
