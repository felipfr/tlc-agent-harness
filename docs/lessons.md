---
type: Concept
title: "Lessons"
description: "Durable, ranked lessons that keep the agent from repeating gate failures across sessions — lifecycle, config, ranking, and the per-provider rendered view."
tags: [concept, lessons, intelligence]
timestamp: "2026-07-29"
---

# Lessons

Durable, compact lessons that keep the agent from repeating **gate failures**. Ranked inject under a char
budget — not conversational memory.

## Lifecycle

```text
gate stagnation (fingerprint ≥ 2)
  → upsert candidate lesson (project store)
garden (sessionEnd / tlc harness lessons garden)
  → promote candidates (hitCount ≥ promoteHitCount)
  → decay / quarantine / prune
inject
  → sessionStart: active only, top N / maxChars
  → stop retry: active + matching candidates, gate-scoped
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
| `promoteHitCount` | 2 | Candidate → active |
| `decayLambda` | 0.02 | Exponential decay per hour since last access |
| `projectBoost` | 1.5 | Score multiplier for project-scoped lessons |
| `syncRulesFile` | false | Write the provider-native durable view |
| `gardenOnSessionEnd` | true | Garden on sessionEnd |

## Ranking

`score = relevance(gate, tokens) × confidence × exp(-λ · hours) × projectBoost?`

Pack **whole lesson blocks** under the char budget. Never mid-string `slice` a lesson. When the budget is
full, omit lower-ranked lessons entirely and append `_(N more active lessons omitted under char budget)_`.

Session inject stops at the first lesson that does not fit (no filler with lower-ranked leftovers).
Quarantine never injects.

## Provider views

`.tlc/harness/lessons.md` is the source of truth. When `syncRulesFile` is on, each provider renders its own
durable, provider-native view of it (see [/decisions/ad-011.md](/decisions/ad-011.md) item 4):

| Provider | Rendered view |
| --- | --- |
| Cursor | `.cursor/rules/harness-lessons.mdc` (`alwaysApply: true`) — hooks alone can drop `additional_context`, so a Cursor-durable rules file survives that race |
| Claude Code | a single `@.tlc/harness/lessons.md` import line appended to `CLAUDE.md` |

## Design notes

| Insight | Applied here |
|---------|--------------|
| Lessons are atoms | Whole-block pack in `packLessonsUnderBudget` / the provider-view renderers |
| Rank before cut | Inject by `rankScore`; sync by priority → hitCount → confidence |
| Promote on repeat | `hitCount ≥ promoteHitCount` |
| Grounded only | Gate stagnation / failures — not chat memory |
| Noise control | Cap N + maxChars; omit note instead of half-sentences; garden decay/quarantine |
| Playbook vs inject | Store keeps all; inject/sync are curated views |

## Store

- Core lessons: shipped in runtime (lint/test/comments/ship/empty-diff/stagnation)
- Project lessons: `.tlc/harness/state/lessons.json` (gitignored)

## CLI

```bash
tlc harness lessons list [--all]
tlc harness lessons show <id>
tlc harness lessons garden
tlc harness lessons sync-rules
tlc harness lessons path
```

## Trade-offs

| Benefit | Cost |
|---------|------|
| Stops repeating the same gate mistake across sessions | Uses context tokens |
| Gate-scoped + decay stays relevant | Needs enable + occasional garden |
| Provider-view sync survives hook races | Can dirty the provider's own rules/memory file if enabled |
