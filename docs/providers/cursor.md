---
type: Provider
title: "Cursor provider"
description: "The Cursor adapter — capability descriptor, event mapping, and wiring target for Cursor's hooks.json."
tags: [provider, cursor]
timestamp: "2026-07-29"
---

# Cursor provider

Source: `src/providers/cursor/`.

## Detection

`cursor.detect.ts`: a raw hook payload is Cursor's when `hook_event_name` is camelCase (e.g.
`beforeShellExecution`) and `workspace_roots` is an array.

## Capability descriptor

`cursor.capabilities.ts`:

| Capability | Value |
| --- | --- |
| `enforcesHooks` | `true` |
| `askSupportedOn` | `["shell.before", "mcp.before"]` — **not** `tool.before` (see [/decisions/ad-009.md](/decisions/ad-009.md), note) |
| `sessionEnv` | `true` |
| `nativeLoopCounter` | `true` |
| `dedicatedShellEvent` | `true` |
| `toolInputRewrite` | `true` |
| `toolOutputRewrite` | `true` |
| `contextAtToolBefore` | `false` |
| `contextAtToolAfter` | `true` |
| `contextAtStop` | `false` — the `stop` output schema carries `followup_message` and nothing else |
| `sessionStartContextReliable` | `false` — Cursor accepts `additional_context` at `sessionStart`, logs it as merged, and drops it (see [Lessons view](#lessons-view)) |
| `usageInPayload` | `true` |
| `effortSignal` | `false` |
| `thoughtEvent` | `true` |

## Policy defaults

`cursor.policy-defaults.ts` supplies the model allowlist (`composer-2.5`, `cursor-grok-4.5-high`,
`glm-5.2-high`, `kimi-k2.7-code`, `gpt-5.3-codex-high`) and the blocked-pattern list
(`-fast(?:$|[^a-z0-9])`, `/fast(?:$|[^a-z0-9])`, `composer-2\.5-fast`) — see
[/decisions/ad-011.md](/decisions/ad-011.md).

## Event mapping

`cursor.inbound.ts` maps Cursor's own camelCase hook names to the shared `HarnessEventKind`:

| Cursor hook | `HarnessEventKind` |
| --- | --- |
| `sessionStart` | `session.start` |
| `sessionEnd` | `session.end` |
| `beforeSubmitPrompt` | `prompt.submit` |
| `preToolUse` | `tool.before` |
| `postToolUse` | `tool.after` |
| `postToolUseFailure` | `tool.failure` |
| `beforeShellExecution` | `shell.before` |
| `afterShellExecution` | `shell.after` |
| `beforeMCPExecution` | `mcp.before` |
| `afterMCPExecution` | `mcp.after` |
| `beforeReadFile` | `read.before` |
| `afterFileEdit` | `edit.after` |
| `subagentStart` | `subagent.start` |
| `subagentStop` | `subagent.stop` |
| `stop` | `stop` |
| `preCompact` | `compact.before` |
| `afterAgentResponse` | `response.after` |
| `afterAgentThought` | `thought.after` |

Cursor has a dedicated event per tool class (`beforeShellExecution`, `beforeMCPExecution`,
`beforeReadFile`), unlike Claude's single `PreToolUse`/`PostToolUse` fan-out.

## Wiring target

`cursor.wiring.ts` writes (`strategy: "replace"`) the user-level `~/.cursor/hooks.json`, one entry per
`(hookEvent, handler)` pair, dispatching through the launcher: `node <launcherPath> <handler>` on
Unix/macOS, `cmd /c node <launcherPath> <handler>` on Windows. Handler names are the
`src/entrypoints/<name>.ts` filenames (see [/decisions/ad-015.md](/decisions/ad-015.md)):
`session-bootstrap`, `persist-handoff`, `obs-session-end`, `obs-passive`, `guard-subagent`,
`pre-tool-use`, `guard-shell`, `audit-event`, `guard-mcp`, `guard-read`, `format`, `verify-gates`,
`obs-stop`, `track-response`.

## Lessons view

`cursor.lessons-view.ts` renders `.tlc/harness/lessons.md` into `.cursor/rules/harness-lessons.mdc`
(`alwaysApply: true`) when `intelligence.lessons.syncRulesFile` is enabled — hooks alone can drop
`additional_context`, so a Cursor-durable rules file survives that race (see
[/decisions/ad-011.md](/decisions/ad-011.md) item 4).

## Doctor / status

`tlc harness doctor` reports Cursor wiring as `wired`, `detected-but-unwired`, or `not-installed` by
diffing the live `~/.cursor/hooks.json` against the entries this adapter would write.

## See also

- [/providers/index.md](/providers/index.md)
- [/providers/claude-code.md](/providers/claude-code.md)
