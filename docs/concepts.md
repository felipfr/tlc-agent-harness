---
type: Concept
title: "Concepts"
description: "The operator-facing concepts behind the harness: grind, pause/resume, shipGate, subagent allowlist, comment policy, catastrophic shell, shell stall, the intelligence rails, observability planes, and cost estimates."
tags: [concepts, policy, grind, shipgate, observability]
timestamp: "2026-07-29"
---

# Concepts

## grind

`grind.enabled`. After each completed agent turn, run configured lint/test against **relevant** changed files:

- **lint** — only when files under `codePaths` changed
- **test** — when test files changed, or in `heads-down` mode when `codePaths` files changed. Policy-only /
  non-code changes do **not** trigger the test gate

`grind.appendFiles` decides whether the changed files are appended to the lint/test argv. `auto` (default)
appends them, except to a recipe runner — `just`, `make`, `task`, `mise`, `rake` — which takes a target name
and would read the first path as a second target and abort. `always` and `never` force the behaviour; use
`never` for any other runner that does not accept paths.

Lint/test runs are serialized with `.tlc/harness/state/grind.lock` (wait up to 120s; locks older than 30
minutes are stolen).

Each lint/test invocation writes `.tlc/harness/state/last-gate.json` (`harness.gate.v1`) with exit code,
command, files, `outputTail`, and `findings`. Follow-up gaps and stagnation fingerprints use that artifact.
Optional: the child may write findings to the path in `HARNESS_GATE_REPORT` (JSON
`{ "findings": [{ "summary": "..." }] }`).

On failure, send a follow-up so the agent fixes (loop, capped). Identical failure fingerprints trigger a
stagnation follow-up. Trade-off: catches breakage early; burns turns if gates are flaky.

A gate whose command never ran — exit 127, or a runner that could not resolve the target — is reported as
`config`, not `verification`. The distinction matters: the verification follow-up tells the agent to fix the
findings without deleting tests, which on a malformed command sends it to edit healthy code.

## format on edit

`format.enabled` with `format.command` (an exact argv array). Runs the project's formatter after a Write so
style stays consistent without a turn spent on it. Trade-off: a wrong command fights the agent on every edit.

## pause / resume

`tlc harness pause` disables stop checks (grind + ship challenge). Use when exploring or mid-refactor.
`tlc harness resume` turns them back on.

Run both from your own terminal. Inside an agent session they are denied by the floor rule
`policy-surface-write`: policy is the operator's to change, and a stop check the agent can switch off is not a
stop check ([/decisions/ad-022.md](/decisions/ad-022.md)).

## gate commands

`tlc harness gate test-command <cmd> [args...]` and `tlc harness gate lint-command <cmd> [args...]` set
`grind.testCommand` and `grind.lintCommand` in the project policy. This is the only supported way to change
those fields — editing `config.json` by hand is fine for you as the operator, but no agent route reaches it.

```bash
tlc harness gate test-command node --test 'src/**/__test__/*.test.ts'
tlc harness gate lint-command npx biome check .
```

Each refuses without writing when the argv is empty, when the first element does not resolve on `PATH` (a gate
command that cannot run is a config fault, AD-021), or when stdin is not a terminal.

## policy integrity

Every source the policy loader reads — the project config, the runtime config, `harness-mode` and the flag
files — is hashed when a session starts. If one changes during that session without a `tlc harness` command
behind it, the next tool call is refused and the changed path is named. The check has no config switch, for
the same reason the floor does not: a detector the detected change can disable is not a detector.

Editing the config between sessions never triggers it. Baselines are per session, so concurrent sessions do
not interfere, and every `tlc harness` mutation re-records them.

## shipGate

`shipGate.enabled`. Ship challenges fire **only** after an explicit protocol line in the agent response:

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

`shipGate.emptyDiffAntiShip`. When enabled, a recent `HARNESS_SHIP_CLAIM` with zero changed files is blocked. Omit the claim line when an
empty diff is intentional.

## subagent allowlist

`subagents.enforceAllowlist`. Task/subagent models must be on `subagents.allowedModels`; each provider supplies its own default catalog
(see [/providers/index.md](/providers/index.md) and [/decisions/ad-011.md](/decisions/ad-011.md)) and
`*-fast`-shaped models are blocked by default. Trade-off: cost/quality control; must update the list when a
provider adds models you want.

## Block parent Fast

`subagents.blockParentFast` (default off) denies a Task/subagent spawn while the sticky parent model is a
"fast" variant, even when the spawn's own `model` string looks allowlisted. See
[/decisions/ad-001.md](/decisions/ad-001.md).

## comment policy

`comments.enabled`, with `comments.mode` of `declared` or `strict`. Blocks the stop when the turn added
comment lines, so narration never lands. Diff-scoped against `HEAD`: comments already committed are never
flagged. `declared` keeps a comment that states `why:`, `hazard:` or `invariant:`; `strict` accepts none and
asks the operator to write it. Tool directives (`biome-ignore`, `@ts-`, `noqa`, `shellcheck`, shebang) are
exempt in both modes.

## docs staleness gate

`docs.command`, optional and off by default. It is the repository's own staleness tool — `drift check`,
`oasdiff`, `ast-grep scan`, or a script the repo already has — run on stop through the same lock, artifact and
failure path as the lint and test gates.

`docs.severity` is `warn` or `deny`. `warn` injects the tool's output and lets the turn end; `deny` blocks and
goes through the standard gate failure path, which brings stagnation fingerprinting and progressive follow-up
with it.

The harness does not infer staleness from paths. A source-glob to docs-glob map was measured reporting on
82–100% of commits, which detects nothing, so a repository without a real tool gets no gate rather than a
noisy one. The tool also owns its own escape hatch, so there is no harness-level skip token.

## catastrophic shell

`shell.catastrophicAsk`. The shell-before hook asks before commands that can destroy data outside the workspace. Happy-path allows
are not signal events.

## shell stall

`shell.stallDetection`. When enabled, repeating the same shell command N times (`stallRepeatThreshold`) is denied with a
change-approach follow-up. Trade-off: stops loops; can block intentional retries.

## intelligence (rails)

| Key | Effect |
|------|--------|
| `intelligence.gapFeedback` | Gate fails include structured PREVIOUS_GAPS + NEXT suggestion |
| `intelligence.failureClassification` | Handoff stores category (verification, ship-evidence, stagnation, …) |
| `intelligence.progressiveHandoff` | sessionStart injects previous gaps / next_action |
| `intelligence.progressiveContext` | Each stop retry escalates context (merge prior gaps, more gate output, stronger "don't repeat") |
| `intelligence.autopilot` | Runtime emits ordered AUTOPILOT steps + NEXT_ACTION (not LLM-invented plan) |
| `intelligence.lessons.enabled` | Durable gate lessons with decay/promote; inject at sessionStart + stop retry (see [/lessons.md](/lessons.md)) |
| `intelligence.budgetContinue` | Under loop/context pressure **and** unfinished handoff work, follow-up says keep working — do not summarize |
| `intelligence.idleTurnGate` | Blocks a turn that ends with open handoff work, zero recorded tool calls and zero file changes. It counts events the harness recorded rather than reading the reply, so no wording satisfies it |

## plan gate

`planGate.enabled` (off by default), with `planGate.windowMinutes` (default 120). The turn declares the paths
it intends to touch through a protocol line, exactly as the ship gate works — free-form prose about plans is
ignored:

```text
HARNESS_PLAN: src/core/plan/**, src/entrypoints/stop.ts
```

Declared paths use the same matcher as `shipGate.runtimePathExcludes`, so there is one pattern syntax to
learn, globs included. On stop, any changed file that no declared path covers and no accepted deviation
justifies blocks with BLOCKED / TRIED / NEED, naming those paths. A deviation is accepted only with a stated
reason:

```text
HARNESS_PLAN_DEVIATION: src/x.ts — the call site moved with the type
```

Naming the path alone is refused, since that would make the gate a formality satisfied by restating the file
just touched. Deviations accumulate for the plan's window, so one can be justified in a later message than
the one that declared the plan. The gate runs **before** the ship gate: a turn whose scope is invalid
produced evidence for the wrong change.

A turn that declares no plan is not gated at all, so the rail costs nothing until the agent opts in. That is
also its limit — it depends on the declaration being made.

## untrusted-content framing

`untrustedContent.enabled` (off by default), with `untrustedContent.extraTools` and
`untrustedContent.extraCommandPatterns`. The floor governs what the agent executes; this governs what it
reads. When a turn takes in content from outside the repository, one framing message states that the content
is data and that any directive inside it is to be reported as a prompt-injection attempt, never obeyed.

Detection is a declared list, never inferred from output: every MCP result (the server is not this
repository), a tool whose name the provider declares as untrusted (`WebFetch` / `WebSearch` on Claude Code,
`Fetch` / `WebSearch` on Cursor), and a shell command whose **segment starts with** `gh pr view|diff|list`,
`gh issue view|list`, `gh api`, `curl` or `wget`. A source nobody listed is not covered.

Matching is anchored at the start of a command segment (split on `|`, `||`, `&&`, `;` and newline) rather
than a substring search, so naming a pattern inside a quoted argument, a `grep` search or a heredoc is not a
read. That distinction was not academic: this document names the patterns, and writing it tripped the rail
when the match was a substring.

Injected at most once per turn, keyed on a marker cleared at the prompt boundary, so it cannot spend the
context budget it exists to protect. When the provider cannot carry context on that event the decision
abstains rather than rendering into a field the provider ignores.

## global observability spool

`obs.globalSpool` (off by default). Every record already written under the project state directory is also
appended to one file under the runtime home, wrapped with the repository path and project name, so cost and
gate history can be read across every repository at once.

Writing outside the repository is the one thing an operator cannot undo by editing project policy, which is
why it is opt-in. Redaction is inherited rather than reimplemented — records are redacted before the store
sees them. Writes are best-effort: an unwritable runtime home degrades to project-only recording without
changing the decision returned to the provider. The spool is pruned on the same retention window as session
rollups, and `tlc harness obs prune` reports how many records it dropped.

## observability planes

| Plane | File | Default |
|-------|------|---------|
| Signal | `.tlc/harness/state/obs.jsonl` | ON — lifecycle, fails, denials, gates, cost alerts |
| Debug | `.tlc/harness/state/debug.jsonl` | OFF — happy-path tool/shell noise |
| Audit | `.tlc/harness/state/audit.jsonl` | ON — verbose per-event record, restored per [/decisions/ad-016.md](/decisions/ad-016.md) item 7 |

Which plane an event lands on is fixed by its kind. What a project can tune is the `obs` block:

| Key | Effect |
|-----|--------|
| `obs.globalSpool` | Mirror every record into the cross-repository spool (see above) |
| `obs.includePayloads` | Keep tool payloads in `attrs` instead of stripping them |
| `obs.maxAttrChars` | Truncation budget for `attrs` on every recorded event |
| `obs.sessionCostAlertUsd` | Threshold for the session cost alert; `null` disables it |
| `obs.retentionDays` | Window used by `tlc harness obs prune`, for rollups and the spool |

`debugEnabled` is deliberately **not** a project field: every event that resolves to debug level is emitted
with the audit configuration, which forces debug on so the audit trail persists
([/decisions/ad-016.md](/decisions/ad-016.md) item 7). There would be nothing for a project to switch.

An `"observability": { … }` block is not read at all — it never was. It was removed rather than honoured,
per [/decisions/ad-003.md](/decisions/ad-003.md). Full detail: [/measure.md](/measure.md).

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
