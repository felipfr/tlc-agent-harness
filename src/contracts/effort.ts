// why: never an enum — erasableSyntaxOnly forbids it.
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export function effortOrdinal(level: EffortLevel): number {
  return EFFORT_LEVELS.indexOf(level);
}

export function compareEffort(a: EffortLevel, b: EffortLevel): number {
  return effortOrdinal(a) - effortOrdinal(b);
}

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value);
}
