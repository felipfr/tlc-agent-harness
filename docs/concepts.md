---
type: Concept
title: "Concepts"
description: "The operator-facing concepts behind the harness: grind, pause/resume, shipGate, subagent allowlist, comment policy, catastrophic shell, shell stall, the intelligence rails, observability planes, and cost estimates."
tags: [concepts, policy, grind, shipgate, observability]
timestamp: "2026-07-29"
---

# Concepts

## grind

After each completed agent turn, run configured lint/test against **relevant** changed files:

- **lint** — only when files under `codePaths` changed
- **test** — when test files changed (scoped args), or in `focus` mode when `codePaths` files changed (full
  `testCommand`). Policy-only / non-code changes do **not** trigger the test gate

Lint/test runs are serialized with `.tlc/harness/state/grind.lock` (wait up to 120s; locks older than 30
minutes are stolen).

Each lint/test invocation writes `.tlc/harness/state/last-gate.json` (`harness.gate.v1`) with exit code,
command, files, `outputTail`, and `findings`. Follow-up gaps and stagnation fingerprints use that artifact.
Optional: the child may write findings to the path in `HARNESS_GATE_REPORT` (JSON
`{ "findings": [{ "summary": "..." }] }`).

On failure, send a follow-up so the agent fixes (loop, capped). Identical failure fingerprints trigger a
stagnation follow-up. Trade-off: catches breakage early; burns turns if gates are flaky.

## pause / resume

`tlc harness pause` disables stop checks (grind + ship challenge). Use when exploring or mid-refactor.
`tlc harness resume` turns them back on.

## shipGate

Ship challenges fire **only** after an explicit protocol line in the agent response:

```text
HARNESS_SHIP_CLAIM: <one-line summary>
```

Prose without that marker does not count as a ship claim.

When a claim is recent (`claimWindowMinutes`, default 10), changed files touch `runtimePathPrefixes` after
`runtimePathExcludes`, and there is no recent PASS under `evidenceDir/*/90-verdict.txt`, stop follows up
with BLOCKED.

Outcomes append to `.tlc/harness/state/ship-ledger.jsonl` (`claim` / `challenge` / `pass`), each row tagged
with the resolved `provider`.

Default excludes: `.tlc/`, `.cursor/`, `.claude/`, `**/node_modules/`, `**/.git/`.

## emptyDiffAntiShip

When enabled, a recent `HARNESS_SHIP_CLAIM` with zero changed files is blocked. Omit the claim line when an
empty diff is intentional.

## subagent allowlist

Task/subagent models must be on `subagents.allowedModels`; each provider supplies its own default catalog
(see [/providers/index.md](/providers/index.md) and [/decisions/ad-011.md](/decisions/ad-011.md)) and
`*-fast`-shaped models are blocked by default. Trade-off: cost/quality control; must update the list when a
provider adds models you want.

## Block parent Fast

`subagents.blockParentFast` (default off) denies a Task/subagent spawn while the sticky parent model is a
"fast" variant, even when the spawn's own `model` string looks allowlisted. See
[/decisions/ad-001.md](/decisions/ad-001.md).

## comment policy

Heuristic junk-comment detector on stop (banners, narrating, TODO, commented-out). Trade-off: noisy on
legacy files until cleaned.

## docs staleness gate

Optional and off by default. `docs.command` is the repository's own staleness tool — `drift check`,
`oasdiff`, `ast-grep scan`, or a script the repo already has — run on stop through the same lock, artifact and
failure path as the lint and test gates.

`docs.severity` is `warn` or `deny`. `warn` injects the tool's output and lets the turn end; `deny` blocks and
goes through the standard gate failure path, which brings stagnation fingerprinting and progressive follow-up
with it.

The harness does not infer staleness from paths. A source-glob to docs-glob map was measured reporting on
82–100% of commits, which detects nothing, so a repository without a real tool gets no gate rather than a
noisy one. The tool also owns its own escape hatch, so there is no harness-level skip token.

## catastrophic shell

The shell-before hook asks before commands that can destroy data outside the workspace. Happy-path allows
are not signal events.

## shell stall

When enabled, repeating the same shell command N times (`stallRepeatThreshold`) is denied with a
change-approach follow-up. Trade-off: stops loops; can block intentional retries.

## intelligence (rails)

| Flag | Effect |
|------|--------|
| `gapFeedback` | Gate fails include structured PREVIOUS_GAPS + NEXT suggestion |
| `failureClassification` | Handoff stores category (verification, ship-evidence, stagnation, …) |
| `progressiveHandoff` | sessionStart injects previous gaps / next_action |
| `progressiveContext` | Each stop retry escalates context (merge prior gaps, more gate output, stronger "don't repeat") |
| `autopilot` | Runtime emits ordered AUTOPILOT steps + NEXT_ACTION (not LLM-invented plan) |
| `lessons` | Durable gate lessons with decay/promote; inject at sessionStart + stop retry (see [/lessons.md](/lessons.md)) |
| `budgetContinue` | Under loop/context pressure **and** unfinished handoff work, follow-up says keep working — do not summarize |

## observability planes

| Plane | File | Default |
|-------|------|---------|
| Signal | `.tlc/harness/state/obs.jsonl` | ON — lifecycle, fails, denials, gates, cost alerts |
| Debug | `.tlc/harness/state/debug.jsonl` | OFF — happy-path tool/shell noise |
| Audit | `.tlc/harness/state/audit.jsonl` | ON — verbose per-event record, restored per [/decisions/ad-016.md](/decisions/ad-016.md) item 7 |

Set `"observability": { "debugEnabled": true }` in user or project config to capture debug. Full detail:
[/measure.md](/measure.md).

## cost estimates

USD estimates use on-disk catalogs, resolved provider-first: local overrides → this provider's own catalog
→ LiteLLM → `null`.

```bash
tlc harness prices refresh
tlc harness prices refresh cursor
tlc harness prices refresh litellm
tlc harness prices lookup <model-id> [provider]
```

Details: `tlc harness help prices` (or [/measure.md](/measure.md)).

## capability catalog

Optional features are chosen during the harness-init wizard (see [/init.md](/init.md)) and stored per
project. `tlc harness doctor` WARNs without failing for off/default opt-ins. Enable via harness-init or by
editing `.tlc/harness/config.json` — never auto-enabled.
