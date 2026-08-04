---
type: Concept
title: "Lessons"
description: "Durable, ranked lessons that keep the agent from repeating gate failures — three tiers, staleness against a named reference, a validity window, effectiveness measured after injection, lifecycle, config, ranking, and the per-provider rendered view."
tags: [concept, lessons, intelligence]
timestamp: "2026-08-04"
---

# Lessons

Durable, compact lessons that keep the agent from repeating **gate failures**. Ranked inject under a char
budget — not conversational memory.

Four things decide whether a lesson reaches a turn: which **tier** it lives in, whether it is still **true**
(its refs resolve, its window is open), how it **ranks**, and whether the budget has room.

## The three tiers

| Tier | Where | Who reads it | Written by |
|------|-------|--------------|------------|
| `core` | inside the runtime | every install, identically | shipped — immutable |
| `global` | `<runtime home>/state/lessons.json` | every product on this machine | `lessons add --global`, `lessons promote` |
| `project` | `<repo>/.tlc/harness/state/lessons.json` | this repository only | gate stagnation, `lessons add` |

`<runtime home>` is `$TLC_HOME`, or `~/.tlc/harness` when it is unset.

**Choosing a tier.** Ask whether the lesson would still be true in a different product:

- "this repository's CI sets `TLC_HOME`" → **project**
- "run the gate itself, never an approximation of its steps" → **global**

Ranking reads all three; `projectBoost` keeps the project tier above the global tier, so local knowledge
outranks knowledge carried in. On a duplicate id the nearer tier wins, so a project that took a global lesson
and rewrote it reads its own version.

**Nothing crosses between products by itself.** There is no automatic promotion, by design: a lesson mined from
a gate failure in one product names that product's test runner and file layout, and no threshold can tell
whether it applies elsewhere. Only the operator can ([/decisions/ad-040.md](/decisions/ad-040.md)).

An injected lesson renders as `[gate/status/tier]`, so a turn reading `[test/active/global]` can tell the advice
was written about a different repository.

`source` is a different fact from `tier`: it records *how* the lesson was learned — `core`, `project` (mined
from a gate failure) or `manual` (authored) — not where it lives.

## Staleness — a lesson names what makes it true

A lesson may carry **refs**, each a repository-relative `path` or `path:symbol`. When a ref stops resolving the
lesson is withheld: a lesson naming a renamed file is worse than absent, because it sends the next turn looking
for something that no longer exists, with the authority of a lesson.

| Status | Meaning | Stale? |
|--------|---------|--------|
| `present` | the path exists, and the symbol appears in it | no |
| `path-missing` | the path is gone, or was absolute | **yes** |
| `symbol-missing` | the file survived, the name did not | **yes** |
| `unreadable` | the file could not be read | no — deferred |

`unreadable` is deliberately not stale. A file this process cannot open is not evidence the lesson stopped being
true. A lesson with **no refs is never stale** — most lessons are about conduct.

Refs are repository-relative; an absolute path never resolves, or a global lesson would report `present` in every
product on the machine that happens to contain the file.

`garden` sets and clears staleness for **project** lessons. A **global** lesson is judged per repository at
selection time instead — its refs may legitimately be missing here and present in the product it came from, so
one stored flag cannot be right for all of them ([/decisions/ad-036.md](/decisions/ad-036.md)).

## Validity window

`validFrom` / `validTo` (ISO) express knowledge with a known end — "pin the formatter until the toolchain moves".
Active when `(validFrom absent or ≤ now) and (validTo absent or > now)`.

An **unparseable bound withholds the lesson**. `--until "next tuesday"` is a typo, and treating a broken
declaration as no declaration would inject exactly what the author meant to limit. `garden` prunes an expired
lesson, because unlike a broken ref the end was declared by the author
([/decisions/ad-037.md](/decisions/ad-037.md)).

## Effectiveness — did the lesson help?

Ranking is built from proxies for usefulness. This is the measurement.

When lessons are injected on a retry for gate G, their ids and G go on the handoff. The **next run of gate G**
grades them: passed → `helped`, failed → `neutral`. The gate name is compared, so lessons injected for `lint` are
not graded by `test`.

| Reading | Meaning |
|---------|---------|
| `helped n/m` | present when that gate recovered, at least once |
| `neutral 0/m` | present at m failures and no recoveries |
| `unproven` | injected and never graded — **no evidence**, not "fine" |

`unproven` is its own state and `doctor` reports it as a warning. The rate is `null` over zero graded
injections, never `0` — zero would read as "measured and it never helped", which is a claim the harness has not
earned.

**This is not causal.** A gate passing after a lesson was injected does not prove the lesson caused it, and
`neutral` does not mean the lesson was wrong. A causal answer needs the same task run twice, and real work does
not repeat. The counters do not feed ranking, because boosting on a non-causal signal would make the ranking
self-confirming ([/decisions/ad-039.md](/decisions/ad-039.md)).

## Lifecycle

```text
gate stagnation (fingerprint ≥ 2)
  → upsert candidate lesson (project store), recording the session key
garden (sessionEnd / tlc harness lessons garden) — both writable tiers
  → promote candidates (distinct sessions ≥ promoteHitCount)
  → mark / clear staleness (project tier)
  → prune expired
  → decay / quarantine / prune
inject
  → sessionStart: active only, top N / maxChars
  → stop retry: active + matching candidates, gate-scoped; records a pending credit
grade
  → next run of the same gate: helped / neutral
optional
  → sync provider-native durable view (see Provider views below)
```

## Config (`intelligence.lessons`)

| Key | Default | Meaning |
|-----|---------|---------|
| `enabled` | false | Master switch |
| `maxInjectSession` | 5 | Cap at sessionStart |
| `maxInjectRetry` | 8 | Cap on stop follow-up |
| `maxCharsSession` | 900 | Char budget session |
| `maxCharsRetry` | 1400 | Char budget retry |
| `promoteHitCount` | 2 | Candidate → active, counted in **distinct sessions** |
| `decayLambda` | 0.02 | Exponential decay per hour since the failure last **recurred** (`lastSeenAt`) |
| `projectBoost` | 1.5 | Score multiplier for the **project** tier |
| `syncRulesFile` | false | Write the provider-native durable view |
| `gardenOnSessionEnd` | true | Garden on sessionEnd |

## Ranking

`score = relevance(gate, tokens) × confidence × exp(-λ · hours since lastSeenAt) × projectBoost?`

**Hours are counted from recurrence, never from exposure.** `lastSeenAt` moves only when the failure
signature happens again; `lastAccessedAt` moves when a lesson is *shown* and is telemetry only. Decay and
pruning both read `lastSeenAt` — reading the exposure field made relevance self-fulfilling, so a lesson that
merely matched a gate name kept resetting its own clock and never faded
([/decisions/ad-023.md](/decisions/ad-023.md)).

**Promotion counts distinct sessions, not `hitCount`.** `hitCount` counts recurrences of the same gate
fingerprint, and one stuck session produces those by definition — the stagnation rail exists because sessions
repeat themselves. A record written before session keys existed falls back to `hitCount` so it can still promote
([/decisions/ad-038.md](/decisions/ad-038.md)).

A lesson also retires when its cause is gone: the garden prunes a `verification` lesson whose stored signal is
an unresolved gate command, because AD-021 made that class classify as `config` and it can no longer recur.

Pack **whole lesson blocks** under the char budget. Never mid-string `slice` a lesson. When the budget is
full, omit lower-ranked lessons entirely and append `_(N more active lessons omitted under char budget)_`.

Session inject stops at the first lesson that does not fit (no filler with lower-ranked leftovers).
Quarantine never injects. Stale and out-of-window lessons are excluded **before** ranking, not scored low.

## Provider views

`.tlc/harness/lessons.md` is the source of truth. When `syncRulesFile` is on, each provider renders its own
durable, provider-native view of it (see [/decisions/ad-011.md](/decisions/ad-011.md) item 4):

| Provider | Rendered view |
| --- | --- |
| Cursor | `.cursor/rules/harness-lessons.mdc` (`alwaysApply: true`) — hooks alone can drop `additional_context`, so a Cursor-durable rules file survives that race |
| Claude Code | a single `@.tlc/harness/lessons.md` import line appended to `CLAUDE.md` |

The synced file carries only what would actually be injected, so a withheld lesson never appears there.

## Design notes

| Insight | Applied here |
|---------|--------------|
| Lessons are atoms | Whole-block pack in `packLessonsUnderBudget` / the provider-view renderers |
| Rank before cut | Inject by `rankScore`; sync by priority → hitCount → confidence |
| Promote on repeat across sessions | distinct `sessionKeys` ≥ `promoteHitCount` |
| A claim outlives its subject | Refs + staleness, withheld not deleted |
| Some knowledge expires | Validity window, pruned on expiry |
| Usefulness is measured, not assumed | helped / neutral / unproven after the next gate run |
| Knowledge travels, context does not | Three tiers, operator-invoked promotion, tier in the rendered line |
| Grounded only | Gate stagnation / failures / an author — not chat memory |
| Noise control | Cap N + maxChars; omit note instead of half-sentences; garden decay/quarantine |

## CLI

```bash
tlc harness lessons add "<instruction>" [--gate <name>] [--avoid "..."] [--prefer "..."] \
                        [--tokens a,b] [--ref path[:symbol]] [--until <iso>] [--global]
tlc harness lessons promote <id>          # copy a project lesson into the global tier
tlc harness lessons list [--all] [--json]
tlc harness lessons show <id>
tlc harness lessons garden
tlc harness lessons sync-rules
tlc harness lessons path
```

`--ref` may repeat. `list` marks a withheld lesson `WITHHELD` and reports `effect=`, `validity=`, `stale=` and
`refs=` per lesson, with tier totals and both store paths at the end.

`doctor` reports stale, out-of-window and unproven lessons as separate warnings, and stays silent when the
capability is off or the writable tiers are empty.

## Trade-offs

| Benefit | Cost |
|---------|------|
| Stops repeating the same gate mistake across sessions | Uses context tokens |
| Gate-scoped + decay stays relevant | Needs enable + occasional garden |
| A lesson retires when its subject is renamed | Refs are author-supplied; substring matching accepts a false `present` |
| Knowledge follows the operator across products | A global lesson can be irrelevant in some product; refs and the boost bound it |
| The store can be defended with numbers | The grading is correlational, not causal |
| Provider-view sync survives hook races | Can dirty the provider's own rules/memory file if enabled |
