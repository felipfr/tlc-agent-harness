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
/**
 * hazard: `observe.rails` accepted any string, and a name with no checker behind it did nothing and said nothing —
 * the exact defect this project keeps removing, a config value nothing reads. Forward-compatible inertness is fine;
 * silent inertness is not. This list is the one source of what can actually be observed, read by the classifier,
 * by `doctor`, and by the capability catalog's own prompt ([/decisions/ad-029.md](/decisions/ad-029.md)).
 *
 * invariant: a name enters this list in the same change that adds its `shouldObserve` call site. A name here with
 * no call site would advertise an observation that never happens, which is the same lie pointed the other way.
 */
export const OBSERVABLE_RAILS: readonly string[] = ["comments"];

export function isObservableRail(rail: string): boolean {
  return OBSERVABLE_RAILS.includes(rail);
}

/** why: names the rails that were asked for and cannot be delivered, so a surface can report them by name. */
export function unobservableRails(rails: readonly string[]): string[] {
  return rails.filter((rail) => !isObservableRail(rail));
}

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
  // hazard: this answered yes for a rail with no checker behind it. Nothing called it for such a rail, so nothing
  // broke — but the function's contract said "observe this" about something unobservable, which is exactly the gap
  // a future call site would fall into.
  return config.enabled && !enforcing && isObservableRail(rail) && config.rails.includes(rail);
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
