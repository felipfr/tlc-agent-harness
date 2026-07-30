---
type: Runbook
title: "Diagnose"
description: "Checklist for hooks not firing, Node vs Bun runtime confusion, stale runtime, subagent denials, cost showing null, and double hooks — for both Cursor and Claude Code."
tags: [runbook, diagnose, troubleshooting]
timestamp: "2026-07-29"
---

# Diagnose

Run `tlc harness doctor` first. Then walk this checklist.

## Hooks not firing

**Cursor**

1. Confirm the Cursor config directory's `hooks.json` invokes `node …/tlc-exec.mjs <handler>` (installers
   write this). `tlc harness doctor` prints the resolved path; `CURSOR_CONFIG_DIR` overrides the default.
2. `dist/*.mjs` must exist (`tlc harness build`).
3. Reload Cursor after editing hooks.
4. Open **View → Output → Hooks** for exit errors.
5. Project shim should call `tlc-exec shim <handler>`; with the global `sessionStart` hook set,
   `TLC_ACTIVE=1` makes the shim no-op (expected).

**Claude Code**

1. Confirm the Claude config directory's `settings.json` (resolved, `CLAUDE_CONFIG_DIR` overrides the
   default) has a `hooks` block with entries whose `command` is `node` and whose
   `args` start with the launcher path (see [/providers/claude-code.md](/providers/claude-code.md)).
2. `dist/*.mjs` must exist (`tlc harness build`).
3. Restart the Claude Code session after editing `settings.json`.
4. Project shim should call `tlc-exec shim <handler>`.

On Windows, Cursor hooks use `cmd /c node "…\tlc-exec.mjs" …`; Claude Code hooks stay exec-form
(`node …`) on every platform.

## Node vs Bun

- Preferred: **Bun** on PATH — every hook runs the TypeScript source directly, ~1 ms per invocation.
- Guaranteed fallback: **Node 24+** + `tlc harness build` (`dist/*.mjs`), ~27 ms per invocation.
- `tlc harness doctor` reports the resolved runtime as `OK` (Bun found) or `WARN` (Node fallback, with the
  measured cost of the gap and the one-line fix). See [/decisions/ad-012.md](/decisions/ad-012.md).
- Missing dist with Node present: run `tlc harness build` (needs Bun or esbuild once to compile).

## Stale runtime / need latest main

```bash
tlc harness update
```

Then reload/restart the provider session.

After update, `tlc harness doctor` reports non-blocking `WARN:` lines for off/missing opt-ins (and for
default-on features you explicitly set to `false`). They do not fail doctor by themselves. A missing
`.tlc/harness/config.json` still fails the project-policy check until you init.

## `tlc: command not found`

Re-run the platform installer, or ensure the CLI shim is on PATH:

- Unix: `~/.local/bin/tlc` → `~/.tlc/harness/bin/tlc`
- Windows: `%USERPROFILE%\.local\bin\tlc.cmd`

## Obs empty / no signal

1. `observability.enabled` must not be `false` in config.
2. Happy-path tool/shell events are **debug** — enable `debugEnabled` or look for signal kinds only.
3. Confirm `.tlc/harness/state/` is writable in the project.
4. `tlc harness obs live` after a prompt submit / stop / denial.

## Grind not looping

1. `tlc harness status` — grind must be ON.
2. Gates must not be PAUSED.
3. Project `.tlc/harness/config.json` needs `grind.lintCommand` / `grind.testCommand` if you expect those
   gates.
4. On failure, inspect `.tlc/harness/state/last-gate.json` (`findings`, `exitCode`, `outputTail`) before
   trusting chat follow-up text.
5. Concurrent agents: wait for `.tlc/harness/state/grind.lock` or stop the other grind.
6. Stop status must be `completed` (aborted/error skips).

## Subagent model denied

Allowlist + blocked `*-fast`-shaped patterns (provider-specific — see
[/providers/index.md](/providers/index.md)). Check `subagents.allowedModels` in user config and project
`.tlc/harness/config.json`. Dual gate: `subagentStart` + `preToolUse` on a spawn tool. Optional
`subagents.blockParentFast` denies spawns while sticky parent state is Fast
(`.tlc/harness/state/parent-model.json`, see [/decisions/ad-001.md](/decisions/ad-001.md)).

## Cost always null

1. `tlc harness help prices`.
2. `tlc harness prices refresh` (or `refresh cursor` if you only need the primary catalog).
3. `tlc harness prices lookup <model> [provider]` — if null, the id is missing from that provider's
   catalog + LiteLLM.
4. Add an alias in `~/.tlc/harness/model-aliases.json` if the provider's model slug ≠ catalog key.
5. Optional override in `model-prices.json` (local).
6. Events need input/output token counts; duration-only events yield null USD even when the catalog has the
   model.

## Double hooks / slow turns

If both user and project hooks run the same heavy logic without shim no-op, fix shim / `TLC_ACTIVE`. Global
observability hooks should stay in the user-level hook file only (the resolved provider config
directory's `hooks.json` or `settings.json`), not duplicated into the project shim.
