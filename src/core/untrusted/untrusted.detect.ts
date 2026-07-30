import type { UntrustedDetectInput, UntrustedHit } from "./untrusted.types.ts";

function matchesTool(toolName: string | undefined, tools: readonly string[]): string | null {
  if (!toolName) {
    return null;
  }
  const needle = toolName.toLowerCase();
  return tools.some((tool) => tool.toLowerCase() === needle) ? toolName : null;
}

// hazard: a substring match reads the pattern out of a heredoc, a quoted string or a grep argument and
// reports content the command never fetched. This repository documents the patterns themselves, so
// `python3 <<EOF ... "gh pr view" ... EOF` fired the rail on its own documentation. A pattern only counts
// when a command segment starts with it, which is the only position where it is the thing being run.
export function commandSegments(command: string): string[] {
  return command
    .split(/\|\||&&|[|;\n]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function matchesCommand(command: string | undefined, patterns: readonly string[]): string | null {
  if (!command) {
    return null;
  }
  const segments = commandSegments(command.toLowerCase());
  for (const pattern of patterns) {
    const needle = pattern.toLowerCase().trim();
    if (segments.some((segment) => segment === needle || segment.startsWith(`${needle} `))) {
      return pattern;
    }
  }
  return null;
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
