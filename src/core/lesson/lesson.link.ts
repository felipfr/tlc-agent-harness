import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { HarnessLesson, LessonLink, LessonLinkStatus } from "./lesson.types.ts";

const LINK_SEPARATOR = ":";

export function parseLessonLink(raw: string): LessonLink | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const at = trimmed.lastIndexOf(LINK_SEPARATOR);
  if (at <= 0 || at === trimmed.length - 1) {
    return { path: trimmed };
  }
  const path = trimmed.slice(0, at).trim();
  const symbol = trimmed.slice(at + 1).trim();
  if (!path) {
    return null;
  }
  return symbol ? { path, symbol } : { path };
}

export function formatLessonLink(link: LessonLink): string {
  return link.symbol ? `${link.path}${LINK_SEPARATOR}${link.symbol}` : link.path;
}

// hazard: an absolute path resolves against a machine, not a repository, so a global lesson would report
// `present` in every product on the machine that happens to contain that file.
function resolveLinkPath(root: string, link: LessonLink): string | null {
  return isAbsolute(link.path) ? null : resolve(root, link.path);
}

export function checkLessonLink(root: string, link: LessonLink): LessonLinkStatus {
  const absolute = resolveLinkPath(root, link);
  if (absolute === null || !existsSync(absolute)) {
    return "path-missing";
  }
  if (!link.symbol) {
    return "present";
  }
  try {
    // why: substring, not parsing — a symbol table needs a language per extension and a parse per check, and a
    // false `present` only costs keeping a lesson a rename would have retired.
    return readFileSync(absolute, "utf8").includes(link.symbol) ? "present" : "symbol-missing";
  } catch {
    // invariant: unreadable is deferred, never stale. A file this process cannot open is not evidence the
    // lesson stopped being true.
    return "unreadable";
  }
}

const STATUS_SEVERITY: Record<LessonLinkStatus, number> = {
  present: 0,
  unreadable: 1,
  "symbol-missing": 2,
  "path-missing": 3,
};

export function worstLinkStatus(statuses: readonly LessonLinkStatus[]): LessonLinkStatus {
  let worst: LessonLinkStatus = "present";
  for (const status of statuses) {
    if (STATUS_SEVERITY[status] > STATUS_SEVERITY[worst]) {
      worst = status;
    }
  }
  return worst;
}

export type LessonLinkVerdict = {
  status: LessonLinkStatus;
  stale: boolean;
  brokenRefs: string[];
};

export function lessonLinkVerdict(root: string, refs: readonly LessonLink[]): LessonLinkVerdict {
  if (refs.length === 0) {
    return { status: "present", stale: false, brokenRefs: [] };
  }
  const statuses = refs.map((ref) => checkLessonLink(root, ref));
  const brokenRefs = refs
    .filter((_, index) => statuses[index] === "path-missing" || statuses[index] === "symbol-missing")
    .map(formatLessonLink);
  return { status: worstLinkStatus(statuses), stale: brokenRefs.length > 0, brokenRefs };
}

export function lessonRefs(lesson: HarnessLesson): LessonLink[] {
  return Array.isArray(lesson.refs) ? lesson.refs : [];
}

export function isStaleLesson(lesson: HarnessLesson): boolean {
  return typeof lesson.staleReason === "string" && lesson.staleReason.length > 0;
}
