import type { Decision, HarnessEvent } from "../contracts/index.ts";
import { coreFacade } from "../core/index.ts";
import { projectStateDir } from "../platform/paths.ts";
import type { Handler, HandlerContext } from "./run.ts";
import { main } from "./run.ts";
import { currentGitBranch, currentGitSha, renderLessonLine, sessionIdFromKey } from "./support.ts";

export const sessionStartHandler: Handler = async (
  event: HarnessEvent,
  ctx: HandlerContext,
): Promise<Decision> => {
  const { policy } = ctx;
  const session = sessionIdFromKey(event);
  const root = event.projectDir;

  // why: recorded before the already-booted return so a resumed session has a baseline too. The check
  // records lazily when one is missing, so this is robustness rather than correctness.
  coreFacade.policy.recordPolicyBaseline(root, event.sessionKey);

  const boot = coreFacade.turn.markBooted(root, event.sessionKey);
  if (boot.alreadyBooted) {
    return { kind: "context", text: "", env: { HARNESS_ACTIVE: "1" } };
  }

  const branch = await currentGitBranch(root);
  const sha = await currentGitSha(root);

  coreFacade.presence.sweepStale(root);
  coreFacade.presence.register(root, {
    provider: event.provider,
    session,
    pid: process.pid,
    branch: branch ?? "unknown",
  });

  await coreFacade.handoff.patchHandoff(root, event.provider, {
    shared: {
      mode: policy.mode,
      project_name: policy.projectName,
      git_branch: branch ?? undefined,
      git_sha: sha ?? undefined,
    },
    slice: {
      session_key: event.sessionKey,
      next_action: "Read .tlc/harness/state/handoff.json if resuming; otherwise start from the user request.",
    },
  });

  const handoff = coreFacade.handoff.readHandoff(root, event.provider);
  const foreign = coreFacade.handoff.readForeignSlices(root, event.provider);

  const lines = [
    ...coreFacade.policy.operatorBootstrapLines(policy, projectStateDir(root)),
    "",
    `Project root: ${root}`,
  ];
  if (policy.projectName) {
    lines.push(`Project: ${policy.projectName}`);
  }
  if (branch) {
    lines.push(`Git branch: ${branch}`);
  }
  if (sha) {
    lines.push(`Git HEAD: ${sha}`);
  }
  if (handoff.blockers) {
    lines.push(`Handoff blocker: ${handoff.blockers}`);
  }
  if (handoff.next_action) {
    lines.push(`Handoff next: ${handoff.next_action}`);
  }
  for (const slice of foreign) {
    lines.push("", `Foreign slice (${slice.provider}):`);
    if (slice.next_action) {
      lines.push(`  next_action: ${slice.next_action}`);
    }
    if (slice.blockers) {
      lines.push(`  blockers: ${slice.blockers}`);
    }
  }

  if (policy.intelligence.lessons.enabled) {
    const selected = await coreFacade.lesson.selectLessons({
      projectDir: root,
      config: policy.intelligence.lessons,
      mode: "session",
      text: [handoff.blockers, handoff.next_action].filter(Boolean).join(" "),
    });
    if (selected.lessons.length > 0) {
      lines.push("", "Lessons (ranked; follow these — do not repeat known failures):");
      for (const lesson of selected.lessons) {
        lines.push(renderLessonLine(lesson));
      }
    }
  }

  lines.push(
    policy.grind.enabled
      ? "Grind ON: stop hook runs configured lint/test gates and auto-continues on failure."
      : "Grind OFF (default).",
  );

  return { kind: "context", text: lines.join("\n"), env: { HARNESS_ACTIVE: "1" } };
};

if (import.meta.main) {
  await main(sessionStartHandler);
}
