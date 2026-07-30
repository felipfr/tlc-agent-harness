import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Decision, HarnessEvent } from "../contracts/index.ts";
import { coreFacade, type LastGateArtifact, type Policy } from "../core/index.ts";
import { filterCodeTargets, filterTestTargets, listChangedRepoFiles, runCommand } from "../platform/git.ts";
import { flagsDir } from "../platform/paths.ts";
import type { Handler, HandlerContext } from "./run.ts";
import { main } from "./run.ts";
import { formatLessonsBlock, OBS_CONFIG, sessionIdFromKey } from "./support.ts";

const STAGNATION_FOLLOWUP = [
  "BLOCKED: identical validation fingerprint repeated — no progress between attempts.",
  "TRIED: same gate failure signature as the previous stop loop.",
  "NEED: change approach. Do not repeat the same fix. Inspect root cause, try a different path, or escalate with BLOCKED/TRIED/NEED.",
].join("\n");

async function runLockedGate(args: {
  root: string;
  provider: string;
  session: string;
  gate: "lint" | "test" | "docs";
  command: string[];
  argvFiles: string[];
  recordFiles: string[];
}): Promise<LastGateArtifact> {
  return coreFacade.gate.withGateLock(args.root, args.provider, args.session, async () => {
    const result = await runCommand(args.root, args.command, args.argvFiles);
    return coreFacade.gate.writeLastGate({
      root: args.root,
      gate: args.gate,
      exitCode: result.exitCode,
      command: [...args.command, ...args.argvFiles],
      files: args.recordFiles,
      durationMs: result.durationMs,
      output: result.output,
    });
  });
}

async function failGate(args: {
  root: string;
  provider: string;
  sessionKey: string;
  gate: string;
  artifact: LastGateArtifact;
  loopCount: number;
  maxLoops: number;
  policy: Policy;
}): Promise<Decision> {
  const { policy } = args;
  const intel = policy.intelligence;
  const fingerprint = coreFacade.stagnation.computeFingerprint({
    files: args.artifact.files,
    gate: args.gate,
    exitCode: args.artifact.exitCode,
    output: args.artifact.outputTail,
  });
  const hits = coreFacade.stagnation.trackFingerprint(args.root, args.sessionKey, fingerprint);
  const category = coreFacade.gate.isCommandResolutionFailure({
    exitCode: args.artifact.exitCode,
    output: args.artifact.outputTail,
  })
    ? "config"
    : coreFacade.turn.classifyGateFailure(args.gate);
  const freshGaps = coreFacade.gate.gapsFromArtifact({ artifact: args.artifact, category });
  const handoff = coreFacade.handoff.readHandoff(args.root, args.provider);
  const gaps = intel.progressiveContext
    ? coreFacade.turn.mergeGaps(handoff.previous_gaps, freshGaps)
    : freshGaps;
  const suggestion = coreFacade.turn.suggestionFor(category, args.gate);
  const effectiveCategory = hits >= 2 ? "stagnation" : category;
  const plan = intel.autopilot
    ? coreFacade.turn.resolveAutopilot({
        category: effectiveCategory,
        gate: hits >= 2 ? "stagnation" : args.gate,
        mode: policy.mode,
        loopCount: args.loopCount,
        maxLoops: args.maxLoops,
        files: args.artifact.files,
      })
    : null;

  await coreFacade.handoff.patchHandoff(args.root, args.provider, {
    slice: {
      last_gate_result: "fail",
      last_fingerprint: fingerprint,
      fingerprint_hits: hits,
      last_failure_category: intel.failureClassification ? effectiveCategory : undefined,
      previous_gaps: intel.gapFeedback ? gaps : undefined,
      blockers: `${args.gate} gate failed (${effectiveCategory}).`,
      next_action: plan?.next_action ?? suggestion,
    },
  });

  if (hits >= 2 && intel.lessons.enabled) {
    await coreFacade.lesson.recordLessonFromFailure({
      projectDir: args.root,
      gate: args.gate,
      category,
      fingerprint,
      output: args.artifact.outputTail,
      suggestion,
    });
  }

  const lessonsBlock = intel.lessons.enabled
    ? formatLessonsBlock(
        (
          await coreFacade.lesson.selectLessons({
            projectDir: args.root,
            config: intel.lessons,
            mode: "retry",
            gate: args.gate,
            text: hits >= 2 ? `stagnation ${args.artifact.outputTail}` : args.artifact.outputTail,
          })
        ).lessons,
        "Lessons for this gate (ranked — apply before inventing a new plan):",
      )
    : "";

  if (hits >= 2) {
    const stagnationGaps = intel.gapFeedback
      ? [
          ...gaps,
          {
            id: "stagnation-0",
            gate: "stagnation",
            category: "stagnation" as const,
            summary: STAGNATION_FOLLOWUP,
          },
        ]
      : [];
    const body = [STAGNATION_FOLLOWUP];
    if (intel.gapFeedback) {
      body.push(
        "",
        coreFacade.turn.formatGapFeedback(
          stagnationGaps,
          coreFacade.turn.suggestionFor("stagnation", "stagnation"),
        ),
      );
    }
    if (lessonsBlock) {
      body.push("", lessonsBlock);
    }
    if (plan) {
      body.push("", coreFacade.turn.formatAutopilotBlock(plan));
    }
    return { kind: "continue", text: body.join("\n") };
  }

  const parts = [
    `BLOCKED: ${args.gate} failed (loop ${args.loopCount}/${args.maxLoops}).`,
    `TRIED: ${args.gate} on changed files.`,
    `NEED: ${plan?.next_action ?? suggestion}`,
  ];
  if (intel.progressiveContext) {
    parts.push(
      "",
      coreFacade.turn.formatProgressiveContext({
        loopCount: args.loopCount,
        maxLoops: args.maxLoops,
        gate: args.gate,
        category,
        gaps,
        gateOutput: args.artifact.outputTail,
        suggestion: plan?.next_action ?? suggestion,
      }),
    );
  } else {
    parts.push("", args.artifact.outputTail);
    if (intel.gapFeedback && gaps.length > 0) {
      parts.push("", coreFacade.turn.formatGapFeedback(gaps, suggestion));
    }
  }
  if (lessonsBlock) {
    parts.push("", lessonsBlock);
  }
  if (plan) {
    parts.push("", coreFacade.turn.formatAutopilotBlock(plan));
  }
  return { kind: "continue", text: parts.join("\n") };
}

export const stopHandler: Handler = async (event: HarnessEvent, ctx: HandlerContext): Promise<Decision> => {
  const { policy, capabilities } = ctx;
  const root = event.projectDir;
  const provider = event.provider;
  const sessionKey = event.sessionKey;
  const session = sessionIdFromKey(event);
  const status = event.status ?? "completed";
  const maxLoops = policy.grind.maxLoops;
  const loopCount = capabilities.nativeLoopCounter
    ? (event.loopCount ?? 0)
    : coreFacade.turn.nextLoop(root, sessionKey);

  const changedFiles = await listChangedRepoFiles(root);
  const codeTargets = filterCodeTargets(changedFiles, policy.codePaths);
  const testTargets = filterTestTargets(changedFiles);
  const handoff = coreFacade.handoff.readHandoff(root, provider);

  await coreFacade.handoff.patchHandoff(root, provider, {
    slice: { last_stop_status: status, last_changed_files: changedFiles, last_gate_result: "skipped" },
  });

  const skipVerify = existsSync(join(flagsDir(root), "skip-verify"));
  const cap = coreFacade.turn.checkLoopCap(loopCount, maxLoops);

  if (skipVerify || status !== "completed" || cap.capReached) {
    if (cap.capReached) {
      await coreFacade.handoff.patchHandoff(root, provider, {
        slice: {
          blockers: `Grind cap hit (${maxLoops} stop loops). Fix manually or pause gates.`,
          next_action: "Inspect failures, fix root cause, then continue.",
          last_failure_category: "budget",
        },
      });
    }
    return { kind: "abstain" };
  }

  const intel = policy.intelligence;
  const unfinishedWork =
    Boolean(handoff.blockers) ||
    Boolean(handoff.previous_gaps?.length) ||
    Boolean(handoff.pending?.length) ||
    Boolean(handoff.in_progress?.length);
  if (
    intel.idleTurnGate &&
    coreFacade.turn.endedWithoutActing({
      activity: coreFacade.turn.readTurnActivity(root, event.sessionKey),
      changedFiles: changedFiles.length,
      hasOpenWork: unfinishedWork,
    })
  ) {
    await coreFacade.handoff.patchHandoff(root, provider, {
      slice: {
        last_failure_category: "agent-quality",
        blockers: "Turn ended with open work and nothing attempted.",
        next_action: "Attempt the work, or proceed under a stated assumption.",
      },
    });
    return { kind: "continue", text: coreFacade.turn.idleTurnMessage() };
  }

  const budgetPressure =
    loopCount >= intel.budgetContinueAfterLoops ||
    (typeof event.contextUsagePercent === "number" && event.contextUsagePercent >= 85);

  if (intel.budgetContinue && unfinishedWork && budgetPressure) {
    await coreFacade.handoff.patchHandoff(root, provider, {
      slice: {
        last_failure_category: "budget",
        next_action: coreFacade.turn.suggestionFor("budget", "budget"),
        blockers: handoff.blockers ?? "Budget/continue signal: do not end early.",
      },
    });
    return {
      kind: "continue",
      text: [
        "BLOCKED: continue working — do not summarize or end this turn early.",
        `TRIED: stop loop ${loopCount}.`,
        `NEED: ${coreFacade.turn.suggestionFor("budget", "budget")}`,
      ].join("\n"),
    };
  }

  if (policy.grind.enabled && (codeTargets.length > 0 || testTargets.length > 0)) {
    const holder = coreFacade.gate.describeHolder(root);
    if (holder) {
      return {
        kind: "continue",
        text: `BLOCKED: the grind lock is held by ${holder}. Wait for it to release or coordinate, then continue.`,
      };
    }
  }

  if (policy.grind.enabled && policy.grind.lintCommand && codeTargets.length > 0) {
    const artifact = await runLockedGate({
      root,
      provider,
      session,
      gate: "lint",
      command: policy.grind.lintCommand,
      argvFiles: coreFacade.gate.shouldAppendFiles(policy.grind.lintCommand, policy.grind.appendFiles)
        ? codeTargets
        : [],
      recordFiles: codeTargets,
    });
    if (!artifact.passed) {
      return failGate({ root, provider, sessionKey, gate: "lint", artifact, loopCount, maxLoops, policy });
    }
  }

  if (policy.grind.enabled && policy.grind.testCommand) {
    const shouldRunTests = testTargets.length > 0 || (policy.mode === "heads-down" && codeTargets.length > 0);
    if (shouldRunTests) {
      const recordFiles = testTargets.length > 0 ? testTargets : codeTargets;
      const artifact = await runLockedGate({
        root,
        provider,
        session,
        gate: "test",
        command: policy.grind.testCommand,
        argvFiles: coreFacade.gate.shouldAppendFiles(policy.grind.testCommand, policy.grind.appendFiles)
          ? testTargets
          : [],
        recordFiles,
      });
      if (!artifact.passed) {
        return failGate({ root, provider, sessionKey, gate: "test", artifact, loopCount, maxLoops, policy });
      }
    }
  }

  if (policy.comments.enabled && policy.comments.onViolation === "followup" && codeTargets.length > 0) {
    const hits = await coreFacade.commentPolicy.scanAddedComments(root, codeTargets, policy.comments.mode);
    if (hits.length > 0) {
      await coreFacade.handoff.patchHandoff(root, provider, {
        slice: {
          last_gate_result: "fail",
          blockers: `This turn added ${hits.length} undeclared comment line(s).`,
          next_action: coreFacade.turn.suggestionFor("verification", "comments"),
        },
      });
      return {
        kind: "continue",
        text: coreFacade.commentPolicy.commentViolationMessage(hits, policy.comments.mode),
      };
    }
  }

  // invariant: this is the grind pattern. The project brings the structural tool — drift, oasdiff, ast-grep
  // — and the harness runs it through the same lock, artifact writer and failure path as lint and test.
  // Inferring staleness from directory mapping was measured at 82-100% false reports and removed.
  if (policy.docs.command && policy.docs.command.length > 0) {
    const artifact = await runLockedGate({
      root,
      provider,
      session,
      gate: "docs",
      command: policy.docs.command,
      argvFiles: [],
      recordFiles: changedFiles,
    });
    if (!artifact.passed) {
      if (policy.docs.severity === "deny") {
        return failGate({ root, provider, sessionKey, gate: "docs", artifact, loopCount, maxLoops, policy });
      }
      return {
        kind: "context",
        text: [
          "ADVISORY: the documentation gate reported.",
          `TRIED: ${policy.docs.command.join(" ")}`,
          "NEED: update what it names, or accept it knowingly — this does not block the stop.",
          "",
          artifact.outputTail,
        ].join("\n"),
      };
    }
  }

  // invariant: the plan gate runs before the ship gate. A turn that changed files nobody planned has an
  // invalid scope, which makes any evidence it produced evidence for the wrong change.
  const planDecision = coreFacade.plan.evaluatePlanGate({
    enabled: policy.planGate.enabled,
    declaredAt: handoff.plan_at,
    windowMinutes: policy.planGate.windowMinutes,
    planned: handoff.plan_paths ?? [],
    deviations: handoff.plan_deviations ?? [],
    changedFiles,
  });
  if (planDecision.kind !== "abstain") {
    await coreFacade.handoff.patchHandoff(root, provider, {
      slice: {
        last_gate_result: "fail",
        last_failure_category: "policy",
        blockers: "Changed files fall outside the declared HARNESS_PLAN.",
        next_action: "Revert what the plan did not call for, or justify each path with a stated reason.",
      },
    });
    return planDecision;
  }

  const recentShipClaim =
    handoff.last_ship_claim_kind === "structured" &&
    coreFacade.ship.recentShipClaimActive(handoff.last_ship_claim_at, policy.shipGate.claimWindowMinutes);

  const emptyDiffDecision = coreFacade.ship.evaluateEmptyDiffAntiShip({
    enabled: policy.shipGate.enabled && policy.shipGate.emptyDiffAntiShip,
    recentShipClaim,
    changedFilesCount: changedFiles.length,
  });
  if (emptyDiffDecision.kind !== "abstain") {
    await coreFacade.handoff.patchHandoff(root, provider, {
      slice: {
        last_gate_result: "fail",
        blockers: "Structured ship claim with empty diff.",
        next_action: coreFacade.turn.suggestionFor("ship-evidence", "empty-diff"),
      },
    });
    coreFacade.ship.appendShipLedger(root, {
      provider,
      event: "challenge",
      claimKind: "structured",
      gate: "empty-diff",
      detail: handoff.last_ship_claim_snippet,
    });
    return emptyDiffDecision;
  }

  const shipEvidenceDecision = coreFacade.ship.evaluateShipEvidenceGate({
    enabled: policy.shipGate.enabled,
    recentShipClaim,
    changedFiles,
    runtimePathPrefixes: policy.shipGate.runtimePathPrefixes,
    runtimePathExcludes: policy.shipGate.runtimePathExcludes,
    evidenceDir: policy.shipGate.evidenceDir,
    evidenceMaxAgeHours: policy.shipGate.evidenceMaxAgeHours,
  });
  if (shipEvidenceDecision.kind !== "abstain") {
    await coreFacade.handoff.patchHandoff(root, provider, {
      slice: {
        last_gate_result: "fail",
        blockers: "HARNESS_SHIP_CLAIM without recent production evidence on runtime changes.",
        next_action: coreFacade.turn.suggestionFor("ship-evidence", "ship"),
      },
    });
    coreFacade.ship.appendShipLedger(root, {
      provider,
      event: "challenge",
      claimKind: "structured",
      gate: "ship",
      files: changedFiles.slice(0, 12),
      evidenceDir: policy.shipGate.evidenceDir,
      detail: handoff.last_ship_claim_snippet,
    });
    return shipEvidenceDecision;
  }

  if (
    policy.shipGate.enabled &&
    recentShipClaim &&
    policy.shipGate.evidenceDir &&
    coreFacade.ship.hasRecentEvidence(policy.shipGate.evidenceDir, policy.shipGate.evidenceMaxAgeHours)
  ) {
    coreFacade.ship.appendShipLedger(root, {
      provider,
      event: "pass",
      claimKind: "structured",
      gate: "ship",
      evidenceDir: policy.shipGate.evidenceDir,
      detail: handoff.last_ship_claim_snippet,
    });
  }

  coreFacade.stagnation.clearFingerprint(root, sessionKey);
  coreFacade.shellPolicy.clearShellStall(root, sessionKey);
  coreFacade.turn.resetLoop(root, sessionKey);
  await coreFacade.handoff.patchHandoff(root, provider, {
    slice: {
      last_gate_result: "pass",
      blockers: undefined,
      previous_gaps: undefined,
      last_failure_category: undefined,
      next_action: changedFiles.length > 0 ? "Continue or commit when ready." : undefined,
      fingerprint_hits: 0,
    },
  });
  return { kind: "abstain" };
};

if (import.meta.main) {
  await main(stopHandler);
}
