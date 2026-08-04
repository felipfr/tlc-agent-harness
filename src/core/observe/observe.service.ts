import type { ObserveConfig } from "../policy/policy.types.ts";

/**
 * Observation mode answers the one question a firing rate cannot: **was the rule ever needed?**
 *
 * A rail that never fires while its prose is injected is either working or unnecessary, and the count alone cannot
 * separate those. Running the checker with the prose *absent* separates them: if the property holds anyway, the
 * model was already doing it and the rule is paying for injected context and delivering nothing.
 *
 * why: this is possible here and nowhere else, because in this harness the checker and the instruction are
 * different things. In a prose-based system the rule *is* the mechanism, so there is nothing to hold apart. The
 * alternative — running a task N times with and without the rule — needs task repetition, and real work does not
 * repeat ([/decisions/ad-027.md](/decisions/ad-027.md)).
 *
 * invariant: observation never returns a Decision and never reaches the turn. A measurement that can change what
 * it measures is not a measurement.
 */
export type ObserveVerdict = {
  rail: string;
  /** How many times the checker found the property violated. Zero is the interesting case. */
  violations: number;
  /**
   * Whether the rail's prose was in the injected context for this turn. This is the field that makes a record
   * interpretable: the same zero means "the rule worked" when true and "the rule was unnecessary" when false.
   */
  proseInjected: boolean;
};

/**
 * invariant: enforcement wins. When a rail is enforcing, its own path already records the outcome, and observing
 * it as well would double-count — the operator would read twice the interruptions they lived through.
 */
export function shouldObserve(config: ObserveConfig, rail: string, enforcing: boolean): boolean {
  return config.enabled && !enforcing && config.rails.includes(rail);
}

export function observeAttrs(verdict: ObserveVerdict): Record<string, unknown> {
  return {
    rail: verdict.rail,
    violations: verdict.violations,
    prose_injected: verdict.proseInjected,
    // why: the reading, stated rather than left to be inferred from two fields. An operator scanning a log should
    // not have to reconstruct the logic that makes the number mean something.
    reading:
      verdict.violations === 0
        ? verdict.proseInjected
          ? "held-with-prose"
          : "held-without-prose"
        : verdict.proseInjected
          ? "violated-with-prose"
          : "violated-without-prose",
  };
}
