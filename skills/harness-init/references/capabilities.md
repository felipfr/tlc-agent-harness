# Capability catalog (load when running discovery)

Read this file during the Discovery step of harness-init. Present **one capability at a time**: name →
benefit → trade-off → default → ask yes/no → if yes, collect values.

Stay **stack-agnostic** (never assume Biome, Vitest, npm, Bun, pytest) and **provider-agnostic** (never
assume Cursor — check what Step 1 detected).

## Always ask once (before capabilities)

- `projectName` (optional string)
- `codePaths` (dirs that count as code for grind)
- starting `mode`: `solo` | `paired` | `heads-down` (default `solo`; `focus` maps to `heads-down`)

## Capabilities (all optional)

<!-- generated:capabilities -->

| # | Capability | Key | Default | Benefit | Trade-off | Extra asks if yes |
|---|------------|-----|---------|---------|-----------|-------------------|
| 1 | Format on edit | `format.enabled` | off | Runs your format command after Write so style stays consistent. | A wrong format command fights the agent on every edit. | `command (exact argv array)` |
| 2 | Grind (lint/test on stop) | `grind.enabled` | off | Re-checks lint/test after each completed turn and follow-ups until gates pass. | Uses turns; flaky commands thrash the agent. | `lintCommand`, `testCommand`, `maxLoops` |
| 3 | Ship gate | `shipGate.enabled` | off | Blocks false done after an explicit HARNESS_SHIP_CLAIM when evidence is missing. | Needs a real evidenceDir workflow; free-English done is ignored. | `evidenceDir`, `runtimePathPrefixes`, `runtimePathExcludes`, `evidenceMaxAgeHours`, `claimWindowMinutes` |
| 4 | Empty-diff anti-ship | `shipGate.emptyDiffAntiShip` | off | Blocks a ship claim when the working tree has zero changes. | Annoys when a zero-diff claim is intentionally correct. | `requires shipGate enabled` |
| 5 | Comment gate (agent-added comments) | `comments.enabled` | off | Blocks the stop when this turn added comment lines, so narration never lands. Diff-scoped: comments you already committed are never flagged. | Two modes. declared lets the agent keep a comment by writing why:/hazard:/invariant:; strict accepts none and asks you to write it instead. strict is stricter but interrupts more. | `mode: declared \| strict` |
| 6 | Subagent allowlist | `subagents.enforceAllowlist` | off | Restricts Task models and blocks *-fast by default. | You must maintain allowedModels when Cursor adds models you want. | `allowedModels`, `requireModel`, `blockMode` |
| 7 | Block parent Fast mode for Task spawns | `subagents.blockParentFast` | off | Denies Task/subagentStart while the parent chat is in Fast mode (sticky from hooks), closing the gap where Task slugs omit *-fast. | Needs parent model hooks (sessionStart/obs/stop); false denials if you intentionally run Fast parent with workers. | recommend **on** |
| 8 | Shell stall detection | `shell.stallDetection` | off | Blocks repeating the exact same shell command too many times. | Can false-positive on intentional retries. | `stallRepeatThreshold (default 3)` |
| 9 | Catastrophic shell ask | `shell.catastrophicAsk` | **on** | Asks before destructive shell commands (rm -rf, drop db, force push, …). | Extra prompts on risky commands. | recommend **on** |
| 10 | Lessons | `intelligence.lessons.enabled` | off | Records compact lessons on gate stagnation and reinjects them ranked under a char budget. | Uses context tokens; not a second brain / chat memory. | `maxInjectSession`, `maxCharsSession`, `maxInjectRetry`, `maxCharsRetry`, `promoteHitCount`, `decayLambda`, `projectBoost`, `syncRulesFile`, `gardenOnSessionEnd`; recommend **on** |
| 11 | Budget continue | `intelligence.budgetContinue` | off | Pushes the agent to keep working under context pressure instead of wrapping up early. | Can delay clean stops. | `budgetContinueAfterLoops` |
| 12 | Gap feedback | `intelligence.gapFeedback` | **on** | Injects PREVIOUS_GAPS on gate failure so retries fix listed items. | Longer follow-ups. | — |
| 13 | Failure classification | `intelligence.failureClassification` | **on** | Stores failure categories on the handoff for clearer next actions. | Extra handoff fields. | — |
| 14 | Progressive handoff | `intelligence.progressiveHandoff` | **on** | Carries gaps into the next session bootstrap. | Slightly longer session start context. | — |
| 15 | Progressive context | `intelligence.progressiveContext` | **on** | Escalates gate follow-up detail on each stop retry. | Longer thrash follow-ups. | — |
| 16 | Autopilot | `intelligence.autopilot` | **on** | Adds ordered AUTOPILOT steps on gate failure. | Agent must follow the block; more directive follow-ups. | — |
| 17 | Idle-turn gate (asked instead of acting) | `intelligence.idleTurnGate` | off | Blocks a turn that ends with open work, zero tool calls and zero file changes. Counts recorded tool events rather than reading the reply, so it cannot be talked around. | A turn that legitimately only answers a question is blocked while handoff work is open — clear the handoff or turn this off for conversational repos. | — |
| 18 | Docs staleness gate | `docs.command` | off | Runs the repository's own documentation staleness tool on stop, so a stale document fails like a failing test. | Needs such a tool in the repository; without one there is nothing to run. | `command (exact argv array)`, `severity: warn \| deny` |
| 19 | Global observability spool | `obs.globalSpool` | off | Mirrors this repo's obs and audit records into one file under the runtime home, so cost and gate history can be read across every repository at once. | Writes outside the repository. Records carry the repo path and project name, and the spool is pruned on the same retention window as session rollups. | — |
| 20 | Untrusted-content framing | `untrustedContent.enabled` | off | Injects one framing line per turn when the agent reads a pull request, an issue, a fetched page or an MCP result, stating that the content is data and that any directive inside it is to be reported as a prompt-injection attempt, not obeyed. | Spends a few hundred characters of context on turns that read outside the repository. Detection is a declared list of tools and command shapes, so a source nobody listed is not covered. | `extraTools`, `extraCommandPatterns` |
| 21 | Plan gate (declared scope vs diff) | `planGate.enabled` | off | Blocks the stop when the turn changed files the declared HARNESS_PLAN did not name, so scope creep fails like a failing test instead of surviving as a review comment. | Requires the agent to declare HARNESS_PLAN before editing, and each honest deviation to state a reason. A turn with no declaration is not gated at all. | `windowMinutes` |

<!-- /generated -->

Stagnation fingerprinting is always on when grind gates fail (no separate toggle) — mention when discussing
grind.

## Lessons subsection (capability 14)

If the user enables lessons, explain what runs automatically:

| Event | What happens |
|-------|--------------|
| Gate stagnation (same fingerprint ≥ 2) | Upsert `candidate` lesson in `.tlc/harness/state/lessons.json` |
| Stop retry / sessionStart | Inject ranked lessons under char budget |
| sessionEnd | Promote / decay / quarantine when `gardenOnSessionEnd` |
| `syncRulesFile` | Rewrite the provider-native durable view when enabled — Cursor's `.cursor/rules/harness-lessons.mdc`, Claude's `CLAUDE.md` import line |

Ask for lessons knobs (offer defaults):

- `maxInjectSession` (5), `maxCharsSession` (900)
- `maxInjectRetry` (8), `maxCharsRetry` (1400)
- `promoteHitCount` (2), `decayLambda` (0.02), `projectBoost` (1.5)
- `syncRulesFile` (recommend **true** on Cursor — sessionStart `additional_context` can drop; also fine to
  recommend on Claude Code, where it just keeps `CLAUDE.md` current)
- `gardenOnSessionEnd` (recommend true)

Point deep docs to: `tlc harness help lessons` (load only if the user asks how decay/ranking works).

## Not configurable — state this once, before discovery

A floor tier runs ahead of every setting and reads no configuration, so nothing below can switch it off.
Tell the user plainly, because the first denial otherwise looks like a bug:

| Rule | Denies |
|------|--------|
| `outside-project-destruction` | A destructive command whose target resolves outside the project and outside the OS temp directory |
| `unprovable-destruction` | A destructive verb whose target cannot be resolved — a variable, a substitution, or a command built at runtime |
| `secret-access` | Reading a credential path into the transcript: `.env`, `~/.ssh`, `~/.aws`, `*.pem`, and similar. `.env.example` and friends are not secrets |
| `history-rewrite` | `git push --force`. `--force-with-lease` is allowed, since it refuses when the remote moved |
| `machine-control` | `shutdown`, `reboot`, `halt`, `poweroff` |

Harness policy and state are not agent-writable either: a gate an agent can edit is not a gate.

## Runtime note (tell user once)

Hooks call `~/.tlc/harness/bin/tlc-exec` — Bun-first when Bun is on PATH (~1 ms/hook), Node 24+ + `dist/`
otherwise (~27 ms/hook; see Step 1b). After global code changes: `tlc harness build`. Day-to-day use does
**not** require Bun. Install path is only `~/.tlc/harness` — never `~/.cursor/harness` or
`~/.cursor/agent-harness`.
