import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export function appendRecord(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`);
}

export function readTail<T>(path: string, n: number): T[] {
  if (!existsSync(path)) {
    return [];
  }
  const records: T[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      records.push(JSON.parse(trimmed) as T);
    } catch {}
  }
  return records.slice(-n);
}
