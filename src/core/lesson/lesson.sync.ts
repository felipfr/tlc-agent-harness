/**
 * How the durable provider view is decided. `auto` asks the host: a provider that does not deliver context from
 * its session-start hook has no other route, so the view is written there and not where the hook works
 * ([/decisions/ad-050.md](/decisions/ad-050.md)).
 */
export type LessonsSyncMode = "auto" | "always" | "never";

export type SyncModeResolution = {
  mode: LessonsSyncMode;
  /** The boolean this mode was read from, when a config predating the mode is still in place. */
  coercedFrom?: boolean;
};

/**
 * hazard: `.tlc/harness/config.json` is merged structurally and never validated, so the field arrives as whatever
 * the operator wrote. A config carrying the old boolean would have compared unequal to every mode and silently
 * read as `auto`, turning an explicit `false` into a file the operator had switched off.
 */
export function resolveSyncMode(raw: unknown): SyncModeResolution {
  if (raw === true) {
    return { mode: "always", coercedFrom: true };
  }
  if (raw === false) {
    return { mode: "never", coercedFrom: false };
  }
  if (raw === "always" || raw === "never" || raw === "auto") {
    return { mode: raw };
  }
  return { mode: "auto" };
}

export function lessonsSyncMode(raw: unknown): LessonsSyncMode {
  return resolveSyncMode(raw).mode;
}

export type DurableViewVerdict = {
  writes: boolean;
  /** Why, in the operator's terms. `lessons status` prints this, so a view that is not written says so. */
  reason: string;
};

/**
 * why: the verdict carries a reason, following `appendFilesVerdict`. A capability that silently does nothing is the
 * defect this project keeps finding; one that says why is a configuration choice.
 */
export function durableViewVerdict(mode: LessonsSyncMode, hookContextReliable: boolean): DurableViewVerdict {
  if (mode === "never") {
    return { writes: false, reason: "syncRulesFile is set to never" };
  }
  if (mode === "always") {
    return { writes: true, reason: "syncRulesFile is set to always" };
  }
  if (hookContextReliable) {
    return {
      writes: false,
      reason:
        "this provider delivers context from its session-start hook, so lessons arrive without a rules file",
    };
  }
  return {
    writes: true,
    reason:
      "this provider does not deliver context from its session-start hook, so the durable view is the route",
  };
}
