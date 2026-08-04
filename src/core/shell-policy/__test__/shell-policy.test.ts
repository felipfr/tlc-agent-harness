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

// invariant: `write` means the command can remove or overwrite a path that already exists. `cp` and `mv` are in
// because the destination may exist and the harness cannot know whether it does.
test("classifyShell marks a command that can lose existing content as write", () => {
  for (const command of [
    "cp a b",
    "mv a b",
    "rm f",
    "rmdir d",
    "tee f",
    "tee -a f",
    "truncate -s 0 f",
    "sed -i s/a/b/ f",
    "echo x > f",
  ]) {
    assert.equal(classifyShell(command), "write", command);
  }
});

// why: metadata and appends change a path without losing a byte of it. Asking about these is what turns an
// approval into a keystroke, and a habituated reviewer is how the consequential one gets waved through.
test("classifyShell marks metadata changes and appends as write-preserving", () => {
  for (const command of ["chmod +x script.sh", "chmod 755 x", "chown user f", "echo x >> f"]) {
    assert.equal(classifyShell(command), "write-preserving", command);
  }
});

// hazard: `>` and `>>` used to collapse into one branch, so an append was indistinguishable from an overwrite —
// which is precisely the line the new class draws.
test("an overwrite redirect and an append redirect are not the same class", () => {
  assert.notEqual(classifyShell("echo x > f"), classifyShell("echo x >> f"));
});

test("write-preserving ranks between read and write, so a mixed command resolves upward", () => {
  assert.equal(classifyShell("chmod +x f && rm g"), "write");
  assert.equal(classifyShell("ls && chmod +x f"), "write-preserving");
});

test("classifyShell leaves a command that creates without overwriting as read", () => {
  for (const command of ["mkdir -p build", "touch f", "ln -s a b"]) {
    assert.equal(classifyShell(command), "read", command);
  }
});

test("classifyShell marks mutating commands as write", () => {
  assert.equal(classifyShell("rm -f script.sh"), "write");
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
  { command: "echo x > f", effect: "write" },
] as const;

// why: the routine ones. Each changes a path and none can lose a byte of it, so each is a prompt the operator
// would learn to clear without reading — and that habit is what a hidden consequential action rides in on.
const NOT_WORTH_ASKING = ["chmod 755 x", "chown user f", "echo x >> f", "mkdir -p build", "cat package.json"];

test("paired asks before a shell move that can lose something", () => {
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

// invariant: the reason names what is at stake, because a prompt that does not is one the operator cannot weigh.
test("the ask says what is at stake, and the two tiers say different things", () => {
  const network = evaluateShellCommand(baseArgs({ command: "git push origin main", mode: "paired" }));
  const write = evaluateShellCommand(baseArgs({ command: "rm -rf node_modules", mode: "paired" }));
  assert.match(network.kind === "ask" ? network.reason : "", /leaves this machine/);
  assert.match(write.kind === "ask" ? write.reason : "", /overwrite or remove/);
});

test("paired leaves the routine commands alone", () => {
  for (const command of NOT_WORTH_ASKING) {
    assert.equal(evaluateShellCommand(baseArgs({ command, mode: "paired" })).kind, "allow", command);
  }
});

// why: an operator reading "seven asks this session" needs to know which switch to reach for. Without the rule on
// the decision, the only way to attribute one was to parse its English.
test("each shell decision names the rule that produced it", () => {
  const catastrophic = evaluateShellCommand(baseArgs({ command: "rm -rf /", mode: "solo" }));
  const posture = evaluateShellCommand(baseArgs({ command: "git push origin main", mode: "paired" }));
  assert.equal(catastrophic.kind === "ask" ? catastrophic.rule : null, "shell-catastrophic");
  assert.equal(posture.kind === "ask" ? posture.rule : null, "shell-posture-paired");
});

// hazard: at `paired` a destructive command matches both rules. The catastrophic switch decides it first, so
// attributing that ask to the posture would send an operator to the wrong switch — and would read as evidence
// that the posture is noisy when it never fired.
test("a destructive command at paired is attributed to the catastrophic rule, not the posture", () => {
  const decision = evaluateShellCommand(baseArgs({ command: "rm -rf /", mode: "paired" }));
  assert.equal(decision.kind === "ask" ? decision.rule : null, "shell-catastrophic");
});

test("a stall denial names the stall rule", () => {
  const root = mkdtempSync(join(tmpdir(), "tlc-shell-rule-"));
  try {
    const args = { command: "ls", projectDir: root, stallDetection: true, stallRepeatThreshold: 2 };
    evaluateShellCommand(baseArgs(args));
    const decision = evaluateShellCommand(baseArgs(args));
    assert.equal(decision.kind, "deny");
    assert.equal(decision.kind === "deny" ? decision.rule : null, "shell-stall");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("solo and focus do not ask on account of posture", () => {
  for (const mode of ["solo", "focus"] as const) {
    for (const { command } of [...MATRIX, ...NOT_WORTH_ASKING.map((command) => ({ command }))]) {
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
