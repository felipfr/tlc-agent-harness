import type { HarnessLesson } from "./lesson.types.ts";

type Boundary = "absent" | "invalid" | number;

function boundary(iso: string | undefined): Boundary {
  if (iso === undefined || iso.trim() === "") {
    return "absent";
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : "invalid";
}

// invariant: an unparseable bound fails the window. A lesson whose validity cannot be evaluated is withheld,
// never injected.
export function isWithinValidity(lesson: HarnessLesson, now: Date): boolean {
  const nowMs = now.getTime();
  const from = boundary(lesson.validFrom);
  if (from === "invalid" || (typeof from === "number" && from > nowMs)) {
    return false;
  }
  const to = boundary(lesson.validTo);
  if (to === "invalid" || (typeof to === "number" && to <= nowMs)) {
    return false;
  }
  return true;
}

export function validityReason(
  lesson: HarnessLesson,
  now: Date,
): "active" | "pending" | "expired" | "invalid" {
  const from = boundary(lesson.validFrom);
  const to = boundary(lesson.validTo);
  if (from === "invalid" || to === "invalid") {
    return "invalid";
  }
  if (typeof from === "number" && from > now.getTime()) {
    return "pending";
  }
  if (typeof to === "number" && to <= now.getTime()) {
    return "expired";
  }
  return "active";
}
