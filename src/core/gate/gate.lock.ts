import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { nextDelay } from "../../platform/backoff.ts";
import { projectStateDir } from "../../platform/paths.ts";
import type { LockBody } from "./gate.types.ts";

export const GATE_LOCK_WAIT_MS = 120_000;
export const GATE_LOCK_STALE_MS = 30 * 60 * 1000;

export class GateLockTimeoutError extends Error {
  constructor(message = "gate lock timeout") {
    super(message);
    this.name = "GateLockTimeoutError";
  }
}

export function gateLockPath(root: string): string {
  return join(projectStateDir(root), "grind.lock");
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function readLockBody(path: string): LockBody | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LockBody;
  } catch {
    return null;
  }
}

function lockAgeMs(path: string, now: number): number | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return now - statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

export function isLockStale(path: string, args: { now: number; staleMs: number }): boolean {
  const age = lockAgeMs(path, args.now);
  return age !== null && age >= args.staleMs;
}

export function describeHolder(root: string): string | null {
  const body = readLockBody(gateLockPath(root));
  if (!body) {
    return null;
  }
  return `${body.provider} session ${body.session} (pid ${body.pid})`;
}

function tryAcquire(path: string, body: LockBody): boolean {
  mkdirSync(dirname(path), { recursive: true });
  try {
    const fd = openSync(path, "wx");
    try {
      writeFileSync(fd, JSON.stringify(body));
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

function stealIfStale(
  path: string,
  staleMs: number,
  now: number,
  body: LockBody,
): { stolen: boolean; previousHolder: LockBody | null } {
  if (!isLockStale(path, { now, staleMs })) {
    return { stolen: false, previousHolder: null };
  }
  const previousHolder = readLockBody(path);
  try {
    unlinkSync(path);
  } catch {
    return { stolen: false, previousHolder: null };
  }
  return { stolen: tryAcquire(path, body), previousHolder };
}

export function releaseLock(path: string, pid: number): void {
  const body = readLockBody(path);
  if (body && body.pid === pid) {
    try {
      unlinkSync(path);
    } catch {}
  }
}

export type WithGateLockOptions = {
  waitMs?: number;
  staleMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  baseMs?: number;
  capMs?: number;
  onSteal?: (previousHolder: LockBody) => void;
};

export async function withGateLock<T>(
  root: string,
  provider: string,
  session: string,
  fn: () => Promise<T>,
  options: WithGateLockOptions = {},
): Promise<T> {
  const waitMs = options.waitMs ?? GATE_LOCK_WAIT_MS;
  const staleMs = options.staleMs ?? GATE_LOCK_STALE_MS;
  const nowFn = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const baseMs = options.baseMs ?? 20;
  const capMs = options.capMs ?? 500;
  const path = gateLockPath(root);
  const deadline = nowFn() + waitMs;
  const pid = process.pid;

  let attempt = 0;
  while (true) {
    const now = nowFn();
    const body: LockBody = { provider, session, pid, acquired_at: new Date(now).toISOString() };

    if (tryAcquire(path, body)) {
      return runUnderLock(path, pid, fn);
    }

    const steal = stealIfStale(path, staleMs, now, body);
    if (steal.stolen) {
      if (steal.previousHolder) {
        options.onSteal?.(steal.previousHolder);
      }
      return runUnderLock(path, pid, fn);
    }

    if (nowFn() >= deadline) {
      const holder = describeHolder(root);
      throw new GateLockTimeoutError(
        `gate lock busy at ${path} after ${waitMs}ms${holder ? ` — held by ${holder}` : ""}`,
      );
    }

    await sleep(nextDelay({ attempt, baseMs, capMs, random }));
    attempt += 1;
  }
}

async function runUnderLock<T>(path: string, pid: number, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    releaseLock(path, pid);
  }
}
