import type { UntrustedDetectInput, UntrustedHit } from "./untrusted.types.ts";

function matchesTool(toolName: string | undefined, tools: readonly string[]): string | null {
  if (!toolName) {
    return null;
  }
  const needle = toolName.toLowerCase();
  return tools.some((tool) => tool.toLowerCase() === needle) ? toolName : null;
}

function matchesCommand(command: string | undefined, patterns: readonly string[]): string | null {
  if (!command) {
    return null;
  }
  const haystack = command.toLowerCase();
  const hit = patterns.find((pattern) => haystack.includes(pattern.toLowerCase()));
  return hit ?? null;
}

export function detectUntrustedRead(input: UntrustedDetectInput): UntrustedHit | null {
  // why: every MCP result crosses a trust boundary by definition — the server is not this repository.
  if (input.event === "mcp.after") {
    return { source: "mcp", detail: input.toolName ?? "mcp" };
  }

  if (input.event === "tool.after") {
    const tool = matchesTool(input.toolName, input.tools);
    return tool ? { source: "web", detail: tool } : null;
  }

  if (input.event === "shell.after") {
    const pattern = matchesCommand(input.command, input.commandPatterns);
    return pattern ? { source: "shell", detail: pattern.trim() } : null;
  }

  return null;
}
