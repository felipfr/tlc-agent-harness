export type JsonFlagResult = { json: boolean; rest: string[] };

export const JSON_FLAG = "--json";

export function takeJsonFlag(args: readonly string[]): JsonFlagResult {
  const rest: string[] = [];
  let json = false;
  for (const arg of args) {
    if (arg === JSON_FLAG) {
      json = true;
      continue;
    }
    rest.push(arg);
  }
  return { json, rest };
}

// why: one line per invocation keeps the contract stream-parseable — a caller can read a single line and
// hand it to a JSON parser without buffering to EOF or stripping a trailing newline.
export function emitJson(value: unknown, write: (text: string) => void = writeStdout): void {
  write(`${JSON.stringify(value)}\n`);
}

function writeStdout(text: string): void {
  process.stdout.write(text);
}

export function unknownFlags(args: readonly string[]): string[] {
  return args.filter((arg) => arg.startsWith("--"));
}
