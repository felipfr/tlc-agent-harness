import { existsSync } from "node:fs";
import { join } from "node:path";
import type { EffortLevel, HarnessEvent } from "../contracts/index.ts";
import { coreFacade, type HarnessLesson, type ObservabilityConfig, type Policy } from "../core/index.ts";
import { runProcess } from "../platform/process.ts";
import type { ProviderPort } from "../providers/index.ts";

// invariant: one definition, taken from core rather than restated.
export const OBS_CONFIG = coreFacade.observability.DEFAULT_OBS;

// why: tool.end, shell.end, mcp.end and file.edit are debug-level kinds, so the passive audit trail only
// persists when debug writing is on. The difference from OBS_CONFIG is stated here once instead of being
// re-declared per entrypoint.
export const OBS_CONFIG_AUDIT = { ...OBS_CONFIG, debugEnabled: true };

// why: the base configs are module constants, so the one operator-controlled field has to be layered on
// per call rather than baked in at import time.
export function obsConfigFor(
  policy: { obs: Policy["obs"] },
  base: ObservabilityConfig = OBS_CONFIG,
): ObservabilityConfig {
  return {
    ...base,
    globalSpool: policy.obs.globalSpool,
    // why: debugEnabled is deliberately absent from Policy.obs. The only events that resolve to debug level
    // are emitted with OBS_CONFIG_AUDIT, which forces it on for the audit trail (AD-016 item 7), so there is
    // nothing a project could switch. Exposing it would repeat the dead-section mistake this replaces.
    includePayloads: policy.obs.includePayloads,
    maxAttrChars: policy.obs.maxAttrChars,
    sessionCostAlertUsd: policy.obs.sessionCostAlertUsd,
    retentionDays: policy.obs.retentionDays,
  };
}

export function sessionIdFromKey(event: HarnessEvent): string {
  const prefix = `${event.provider}-`;
  return event.sessionKey.startsWith(prefix) ? event.sessionKey.slice(prefix.length) : event.sessionKey;
}

export async function currentGitBranch(root: string): Promise<string | null> {
  if (!existsSync(join(root, ".git"))) {
    return null;
  }
  const result = await runProcess({ command: ["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd: root });
  if (result.exitCode !== 0) {
    return null;
  }
  const branch = result.stdout.trim();
  return branch.length > 0 ? branch : null;
}

export async function currentGitSha(root: string): Promise<string | null> {
  if (!existsSync(join(root, ".git"))) {
    return null;
  }
  const result = await runProcess({ command: ["git", "rev-parse", "--short", "HEAD"], cwd: root });
  if (result.exitCode !== 0) {
    return null;
  }
  const sha = result.stdout.trim();
  return sha.length > 0 ? sha : null;
}

export function effectiveAllowedModels(
  configured: string[] | Record<string, string[]> | undefined,
  provider: ProviderPort,
): string[] {
  const fromConfig = coreFacade.policy.forProvider(configured, provider.name);
  if (fromConfig && fromConfig.length > 0) {
    return fromConfig;
  }
  return provider.policyDefaults().allowedModels;
}

export function effectiveBlockedPatterns(
  configured: string[] | Record<string, string[]> | undefined,
  provider: ProviderPort,
): string[] {
  const fromConfig = coreFacade.policy.forProvider(configured, provider.name) ?? [];
  return [...fromConfig, ...provider.policyDefaults().blockedPatterns];
}

export function effectiveMinEffort(
  configured: EffortLevel | null,
  provider: ProviderPort,
): EffortLevel | null {
  return configured ?? provider.policyDefaults().minEffort;
}

export function readModelFromToolInput(toolInput: Record<string, unknown> | undefined): string {
  if (!toolInput) {
    return "";
  }
  const model = toolInput.model ?? toolInput.Model;
  return typeof model === "string" ? model : "";
}

/**
 * hazard: this used to be a copy of the core renderer, on the reasoning that presentation is not core's business.
 * The copy is what the model actually receives, so the tier added to the core block rendered in `lessons list` and
 * in nothing an agent ever saw. Two renderers for one string is the same defect as a consumer without a producer,
 * pointed sideways ([/decisions/ad-040.md](/decisions/ad-040.md)).
 */
export function renderLessonLine(lesson: HarnessLesson): string {
  return coreFacade.lesson.renderLessonBlock(lesson);
}

export function formatLessonsBlock(lessons: HarnessLesson[], title: string): string {
  if (lessons.length === 0) {
    return "";
  }
  return [title, ...lessons.map(renderLessonLine)].join("\n");
}
