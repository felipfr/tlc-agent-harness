const ALLOWED = /[A-Za-z0-9._-]/;
const EMPTY_PLACEHOLDER = "_empty_";

export function sanitizeSegment(input: string): string {
  if (input.length === 0) {
    return EMPTY_PLACEHOLDER;
  }
  let out = "";
  for (const ch of input) {
    if (ALLOWED.test(ch)) {
      out += ch;
      continue;
    }
    for (const byte of Buffer.from(ch, "utf8")) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

export function normalizeSeparators(input: string): string {
  return input.replace(/\\/g, "/");
}
