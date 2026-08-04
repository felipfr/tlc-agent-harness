import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { classifyShell, evaluateShellCommand, isCatastrophic } from "../shell-policy.service.ts";
import { clearShellStall, shellStallHits, trackShellCommand } from "../shell-policy.stall.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-shell-policy-"));
}

function baseArgs(overrides: Partial<Parameters<typeof evaluateShellCommand>[0]> = {}) {
  return {
    mode: "solo" as const,
    command: "",
    sessionKey: "session-a",
    projectDir: "",
    catastrophicAsk: true,
    stallDetection: false,
    stallRepeatThreshold: 3,
    ...overrides,
  };
}

test("classifyShell marks rm -rf / as destructive", () => {
  assert.equal(classifyShell("rm -rf /"), "destructive");
});

test("classifyShell marks mkfs as destructive", () => {
  assert.equal(classifyShell("mkfs.ext4 /dev/sda1"), "destructive");
});

test("classifyShell marks dd to a raw device as destructive", () => {
  assert.equal(classifyShell("dd if=/dev/zero of=/dev/sda"), "destructive");
});

test("classifyShell marks shutdown/reboot/halt as destructive", () => {
  assert.equal(classifyShell("sudo reboot"), "destructive");
});

test("classifyShell marks network commands as network", () => {
  assert.equal(classifyShell("curl https://example.com"), "network");
  assert.equal(classifyShell("git push origin main"), "network");
});

test("classifyShell marks mutating commands as write", () => {
  assert.equal(classifyShell("chmod +x script.sh"), "write");
});

test("classifyShell marks everything else as read", () => {
  assert.equal(classifyShell("ls -la"), "read");
});

test("isCatastrophic mirrors classifyShell === destructive", () => {
  assert.equal(isCatastrophic("rm -rf /"), true);
  assert.equal(isCatastrophic("ls -la"), false);
});

test("evaluateShellCommand allows an empty command without touching stall state", () => {
  const decision = evaluateShellCommand(baseArgs({ command: "" }));
  assert.deepEqual(decision, { kind: "allow" });
});

test("evaluateShellCommand asks on a catastrophic command, never rendering vendor JSON", () => {
  const decision = evaluateShellCommand(baseArgs({ command: "rm -rf /", catastrophicAsk: true }));
  assert.equal(decision.kind, "ask");
  if (decision.kind === "ask") {
    assert.match(decision.reason, /catastrophic/i);
    assert.match(decision.userNote ?? "", /destroy data/i);
  }
});

test("evaluateShellCommand skips the catastrophic ask when catastrophicAsk is disabled", () => {
  const root = tempRoot();
  try {
    const decision = evaluateShellCommand(
      baseArgs({ command: "rm -rf /", catastrophicAsk: false, projectDir: root }),
    );
    assert.equal(decision.kind, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("evaluateShellCommand allows a repeated command below the stall threshold", () => {
  const root = tempRoot();
  try {
    const decision = evaluateShellCommand(
      baseArgs({
        command: "npm test",
        catastrophicAsk: false,
        stallDetection: true,
        stallRepeatThreshold: 3,
        projectDir: root,
      }),
    );
    assert.equal(decision.kind, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("evaluateShellCommand denies once the stall threshold is reached, naming the repeat count in the reason", () => {
  const root = tempRoot();
  try {
    const args = baseArgs({
      command: "npm test",
      catastrophicAsk: false,
      stallDetection: true,
      stallRepeatThreshold: 3,
      projectDir: root,
    });
    evaluateShellCommand(args);
    evaluateShellCommand(args);
    const decision = evaluateShellCommand(args);
    assert.equal(decision.kind, "deny");
    if (decision.kind === "deny") {
      assert.match(decision.reason, /attempted 3 times/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stall state is keyed by sessionKey — a different session starts fresh", () => {
  const root = tempRoot();
  try {
    trackShellCommand(root, "session-a", "npm test");
    trackShellCommand(root, "session-a", "npm test");
    assert.equal(shellStallHits(root, "session-b"), 0);
    assert.equal(shellStallHits(root, "session-a"), 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("trackShellCommand normalizes whitespace so equivalent commands count as repeats", () => {
  const root = tempRoot();
  try {
    trackShellCommand(root, "session-a", "npm   test");
    const hits = trackShellCommand(root, "session-a", "npm test");
    assert.equal(hits, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clearShellStall clears only the given session", () => {
  const root = tempRoot();
  try {
    trackShellCommand(root, "session-a", "npm test");
    trackShellCommand(root, "session-b", "npm test");
    clearShellStall(root, "session-a");
    assert.equal(shellStallHits(root, "session-a"), 0);
    assert.equal(shellStallHits(root, "session-b"), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("text that merely mentions a dangerous command is not classified as running it", () => {
  assert.equal(classifyShell("git commit -m 'rm -rf / now denies instead of escalating'"), "read");
  assert.equal(classifyShell("cat > notes.md <<'EOF'\nrm -rf /\nEOF"), "write");
  assert.equal(classifyShell('grep -r "shutdown" .'), "read");
  assert.equal(isCatastrophic("echo 'do not run rm -rf /'"), false);
});

test("the worst class across a command list wins", () => {
  assert.equal(classifyShell("ls -la && curl https://example.com"), "network");
  assert.equal(classifyShell("npm test; sudo reboot"), "destructive");
});

// why: `paired` promised a check-in before a sizable non-destructive move and delivered text only. The matrix
// below is the promise made testable: what asks, at which posture, and what is left alone.
const MATRIX = [
  { command: "git push origin main", effect: "network" },
  { command: "curl https://example.com", effect: "network" },
  { command: "cp a b", effect: "write" },
  { command: "rm -rf node_modules", effect: "write" },
  { command: "chmod 755 x", effect: "write" },
] as const;

test("paired asks before a shell move that changes something", () => {
  for (const { command } of MATRIX) {
    const decision = evaluateShellCommand(baseArgs({ command, mode: "paired" }));
    assert.equal(decision.kind, "ask", command);
    if (decision.kind === "ask") {
      assert.match(decision.reason, /paired/, command);
      // why: an ask that does not say how to stop being asked is a nag.
      assert.match(decision.reason, /tlc harness mode solo/, command);
    }
  }
});

test("solo and focus do not ask on account of posture", () => {
  for (const mode of ["solo", "focus"] as const) {
    for (const { command } of MATRIX) {
      assert.equal(evaluateShellCommand(baseArgs({ command, mode })).kind, "allow", `${mode}: ${command}`);
    }
  }
});

test("a read is untouched at every posture", () => {
  for (const mode of ["paired", "solo", "focus"] as const) {
    assert.equal(evaluateShellCommand(baseArgs({ command: "cat package.json", mode })).kind, "allow", mode);
  }
});

// invariant: the posture rule and catastrophicAsk are independent. A posture that switched a capability off
// would be the defect this feature exists to remove, and a capability switched off must not disable a posture.
test("catastrophicAsk decides destructive at every posture, unchanged", () => {
  for (const mode of ["paired", "solo", "focus"] as const) {
    assert.equal(
      evaluateShellCommand(baseArgs({ command: "rm -rf /", mode, catastrophicAsk: true })).kind,
      "ask",
      mode,
    );
  }
});

test("catastrophicAsk off does not disable the paired pre-check", () => {
  const decision = evaluateShellCommand(
    baseArgs({ command: "git push origin main", mode: "paired", catastrophicAsk: false }),
  );
  assert.equal(decision.kind, "ask");
  assert.match(decision.kind === "ask" ? decision.reason : "", /paired/);
});

test("the paired pre-check does not consume the stall counter", () => {
  // why: an ask is not an attempt. Counting it would make a watched operator look like a stalling agent.
  const root = mkdtempSync(join(tmpdir(), "tlc-shell-paired-"));
  try {
    const args = { command: "cp a b", mode: "paired" as const, projectDir: root, stallDetection: true };
    for (let i = 0; i < 5; i += 1) {
      assert.equal(evaluateShellCommand(baseArgs(args)).kind, "ask", `attempt ${i + 1}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
