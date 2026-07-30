---
type: Runbook
title: "Measure"
description: "How to read harness observability: status, live signal, raw signal, session reports, audit trail, price catalogs, and the on-disk project state files, all provider-tagged."
tags: [runbook, measure, observability, pricing]
timestamp: "2026-07-29"
---

# Measure

Run from the project root, or set `TLC_PROJECT_DIR`.

## Status

```bash
tlc harness status
```

Shows mode, grind on/off, and whether stop gates are paused.

## Live signal

```bash
tlc harness obs live
```

Allowlisted tail of signal events (session, prompt, fails, denials, gates, compact, subagents, cost alerts).

## Raw signal

```bash
tlc harness obs events [n]
```

Last N JSON lines from `obs.jsonl`.

## Session report

```bash
tlc harness obs report [conversation_id]
```

Markdown rollup: tokens, estimated USD, tools, subagents, gates. Writes under
`.tlc/harness/state/reports/`.

```bash
tlc harness obs rollup <conversation_id>
tlc harness obs prune
```

`rollup` prints the raw JSON rollup for one session; `prune` deletes rollups older than
`retentionDays` (default 14).

## Observability planes

Every record carries a `provider` field (`"cursor" | "claude"`) so signal, debug, and audit records from a
multi-provider project stay attributable per-event, not just per-project (see
[/decisions/ad-011.md](/decisions/ad-011.md)).

| Plane | File | Default | Contents |
|-------|------|---------|----------|
| Signal | `.tlc/harness/state/obs.jsonl` | ON | lifecycle, fails, denials, gates, cost alerts, ship claims |
| Debug | `.tlc/harness/state/debug.jsonl` | OFF | happy-path tool/shell/mcp noise |
| Audit | `.tlc/harness/state/audit.jsonl` | ON | one record per hook invocation (`{ ts, event, payload }`), restored per [/decisions/ad-016.md](/decisions/ad-016.md) item 7 so a denied/asked shell command is never silently unaudited |

Set `"observability": { "debugEnabled": true }` in user or project config to also capture debug-level
events. `shell.end` is promoted from debug to signal automatically whenever the permission was not a plain
allow — an audited denial should never require opting into debug mode to see.

18 `HarnessEventKind` values map onto a smaller set of `ObsKind` values (`session.start`, `tool.start`,
`shell.end`, `gate.outcome`, `cost.turn`, …) — see `src/core/observability/observability.types.ts` for the
full mapping table.

## Prices

Cost estimates use on-disk catalogs under `~/.tlc/harness/`, resolved provider-first:

```bash
tlc harness prices refresh
tlc harness prices refresh all
tlc harness prices refresh cursor
tlc harness prices refresh litellm
tlc harness prices lookup <model-id> [provider]
```

| Command | Effect |
|---------|--------|
| `refresh` / `refresh all` | Update the Cursor catalog and the LiteLLM fallback |
| `refresh cursor` | Write `model-prices.cursor.json` (commit when rates change) |
| `refresh litellm` | Write `model-prices.litellm.json` (gitignored; regenerate locally) |
| `lookup <model-id> [provider]` | Resolve catalog key, pool, and USD for 1M input + 1M output |

### Catalogs

| File | Role | In git |
|------|------|--------|
| `model-prices.<provider>.json` (e.g. `model-prices.cursor.json`) | Primary, per provider | Yes |
| `model-prices.litellm.json` | Fallback (LiteLLM public JSON) | No |
| `model-prices.json` | Local overrides | Empty `{}` template only |
| `model-aliases.json` | Model id → catalog key | Yes |

### Resolution order

1. `model-prices.json` (local overrides)
2. `model-prices.<provider>.json` (this provider's own catalog)
3. `model-prices.litellm.json`
4. otherwise `cost_usd: null`

Pools (neutral names in observability records; see [/decisions/ad-011.md](/decisions/ad-011.md) item 2):
`provider_native` | `other` | `auto` | `unknown`. The on-disk catalog files still use vendor-named pool
keys internally (`cursor_models`, `anthropic_models`, …) since pricing must name real vendors — those are
mapped to the neutral names before they reach `core/`.

### When to refresh

| Situation | Command |
|-----------|---------|
| A provider published new rates or models | `tlc harness prices refresh cursor` (then commit) |
| Missing LiteLLM file or obscure model | `tlc harness prices refresh litellm` |
| Update both catalogs | `tlc harness prices refresh` |
| Inspect one model | `tlc harness prices lookup <model-id> [provider]` |

`tlc harness doctor` requires at least one provider catalog to be present. LiteLLM is optional until needed
as fallback.

## Project state files

| Path | Contents |
|------|----------|
| `.tlc/harness/state/obs.jsonl` | Signal |
| `.tlc/harness/state/debug.jsonl` | Debug (if enabled) |
| `.tlc/harness/state/audit.jsonl` | Verbose per-hook audit trail |
| `.tlc/harness/state/sessions/*.json` | Per-conversation rollups |
| `.tlc/harness/state/handoff.json` | Cross-turn handoff |
| `.tlc/harness/state/ship-ledger.jsonl` | Ship claim / challenge / pass rows |
| `.tlc/harness/state/lessons.json` | Project lessons store |
| `.tlc/harness/state/parent-model.json` | Sticky parent-model snapshot (see [/decisions/ad-001.md](/decisions/ad-001.md)) |
