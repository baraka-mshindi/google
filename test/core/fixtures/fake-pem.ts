// Key-shaped test text, built at runtime so no private-key literal is committed.
// The bodies are placeholders, not keys.
const DASHES = "-".repeat(5);
const marker = (edge: "BEGIN" | "END", label: string): string =>
  `${DASHES}${edge} ${label}${DASHES}`;

export const PEM_LABEL = ["PRIVATE", "KEY"].join(" ");

/** A PEM block around `body`; `end: false` leaves it truncated. */
export function fakePem(
  body: string,
  o: { label?: string; end?: boolean } = {},
): string {
  const label = o.label ?? PEM_LABEL;
  const head = `${marker("BEGIN", label)}\n${body}`;
  return o.end === false ? head : `${head}\n${marker("END", label)}\n`;
}
