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
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { nextDelay } from "../../platform/backoff.ts";
import { projectStateDir } from "../../platform/paths.ts";
import type { LockBody } from "./gate.types.ts";

export const GATE_LOCK_WAIT_MS = 120_000;
export const GATE_LOCK_STALE_MS = 30 * 60 * 1000;

// hazard: tryAcquire creates the file before writing the body, so a legitimate lock is briefly unreadable.
// The grace window has to outlast that gap by orders of magnitude without approaching the stale threshold —
// a lock nobody can read has no owner to wait for and no pid to release it.
export const GATE_LOCK_UNREADABLE_GRACE_MS = 5_000;

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

// why: a body that parses but does not carry a holder is as useless as one that does not parse — there is
// still no provider to name and no pid to release by. Both are "unreadable" for the purpose of reclaiming.
export function isUsableLockBody(value: unknown): value is LockBody {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const body = value as Partial<LockBody>;
  return (
    typeof body.provider === "string" && typeof body.session === "string" && typeof body.pid === "number"
  );
}

export function isLockUnreadable(path: string, args: { now: number; graceMs: number }): boolean {
  const age = lockAgeMs(path, args.now);
  if (age === null || age < args.graceMs) {
    return false;
  }
  return !isUsableLockBody(readLockBody(path));
}

/**
 * Whether the recorded process is provably gone.
 *
 * hazard: a pid means nothing on another machine, so this answers `false` unless the lock names this host.
 * Without that check a shared checkout would let one machine reclaim a lock whose owner is alive on another,
 * and two gates would run at once — the thing the lock exists to prevent.
 *
 * why: `process.kill(pid, 0)` sends no signal, it only asks whether the process exists. `EPERM` means it
 * exists and belongs to another user, which is alive for our purposes. Anything unexpected is treated as
 * alive, because the age rule is the safe fallback and reclaiming a live holder is the expensive mistake.
 */
export function isLockOwnerGone(body: unknown, thisHost: string = hostname()): boolean {
  if (!isUsableLockBody(body)) {
    return false;
  }
  const { host, pid } = body;
  if (typeof host !== "string" || host !== thisHost) {
    return false;
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

export function isLockReclaimable(
  path: string,
  args: { now: number; staleMs: number; graceMs: number },
): boolean {
  return (
    isLockStale(path, { now: args.now, staleMs: args.staleMs }) ||
    isLockUnreadable(path, { now: args.now, graceMs: args.graceMs }) ||
    // why: an owner that no longer exists has nothing to wait for. Without this the gate honoured a dead
    // session's lock for the full stale window — measured at 30 minutes, blocking on a pid `ps` reported gone.
    isLockOwnerGone(readLockBody(path))
  );
}

export type DescribeHolderOptions = {
  now?: number;
  staleMs?: number;
};

// hazard: an abandoned lock must not read as held. Callers short-circuit on this answer before
// withGateLock can reach stealIfStale, so reporting a stale holder blocks the grind for as long as the
// file survives — not until the threshold, which is what the threshold exists to bound.
export function describeHolder(root: string, options: DescribeHolderOptions = {}): string | null {
  const path = gateLockPath(root);
  const now = options.now ?? Date.now();
  const staleMs = options.staleMs ?? GATE_LOCK_STALE_MS;
  if (isLockStale(path, { now, staleMs })) {
    return null;
  }
  const body = readLockBody(path);
  if (!isUsableLockBody(body)) {
    return null;
  }
  // hazard: the comment above predicted this exact failure and the code did not implement it. A lock whose
  // owner is dead but whose file is younger than the threshold was reported as held, and the caller
  // short-circuited before withGateLock could reclaim it — measured blocking a gate on a pid `ps` said was
  // gone. Reclaimability and holder reporting have to agree, or the reclaim path is unreachable.
  if (isLockOwnerGone(body)) {
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

function stealIfReclaimable(
  path: string,
  args: { staleMs: number; graceMs: number; now: number },
  body: LockBody,
): { stolen: boolean; previousHolder: LockBody | null } {
  if (!isLockReclaimable(path, args)) {
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
  unreadableGraceMs?: number;
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
  const graceMs = options.unreadableGraceMs ?? GATE_LOCK_UNREADABLE_GRACE_MS;
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
    const body: LockBody = {
      provider,
      session,
      pid,
      acquired_at: new Date(now).toISOString(),
      host: hostname(),
    };

    if (tryAcquire(path, body)) {
      return runUnderLock(path, pid, fn);
    }

    const steal = stealIfReclaimable(path, { staleMs, graceMs, now }, body);
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
