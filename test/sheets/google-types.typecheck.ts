// Compiled by `npm run typecheck`, never run. Keeps the hand-rolled Google shapes
// in src/sheets/transport.ts honest: Google's own `sheets_v4` types must stay
// assignable to them, so the real client and custom transports keep compiling.
import type { sheets_v4 } from "@googleapis/sheets";
import type {
  GGridRange,
  GNamedRange,
  GProtectedRange,
  GRequest,
  GResponse,
  GSheetProperties,
  GSpreadsheet,
  SheetsTransport,
} from "../../src/sheets/transport.js";

declare const spreadsheet: sheets_v4.Schema$Spreadsheet;
declare const request: sheets_v4.Schema$Request;
declare const response: sheets_v4.Schema$Response;
declare const grid: sheets_v4.Schema$GridRange;
declare const props: sheets_v4.Schema$SheetProperties;
declare const named: sheets_v4.Schema$NamedRange;
declare const protectedRange: sheets_v4.Schema$ProtectedRange;

export const checks: [
  GSpreadsheet,
  GRequest,
  GResponse,
  GGridRange,
  GSheetProperties,
  GNamedRange,
  GProtectedRange,
] = [spreadsheet, request, response, grid, props, named, protectedRange];

// A transport typed with Google's own shapes still implements SheetsTransport.
declare const googleTyped: Omit<
  SheetsTransport,
  "getSpreadsheet" | "batchUpdate"
> & {
  getSpreadsheet(
    p: Parameters<SheetsTransport["getSpreadsheet"]>[0],
  ): Promise<sheets_v4.Schema$Spreadsheet>;
  batchUpdate(
    p: Parameters<SheetsTransport["batchUpdate"]>[0],
  ): Promise<{ replies?: sheets_v4.Schema$Response[] | null }>;
};
export const transport: SheetsTransport = googleTyped;
