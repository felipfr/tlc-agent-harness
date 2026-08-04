import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { guardPolicySurface, isPolicySurface } from "../policy.guard.ts";

const ROOT = "/repo";

test("the project policy file is a protected surface", () => {
  assert.equal(isPolicySurface(ROOT, join(ROOT, ".tlc/harness/config.json")), true);
});

test("flags and state are protected surfaces", () => {
  assert.equal(isPolicySurface(ROOT, join(ROOT, ".tlc/harness/state/flags/grind-on")), true);
  assert.equal(isPolicySurface(ROOT, join(ROOT, ".tlc/harness/state/handoff.json")), true);
});

test("ordinary source is not protected", () => {
  assert.equal(isPolicySurface(ROOT, join(ROOT, "src/app.ts")), false);
  assert.equal(isPolicySurface(ROOT, join(ROOT, ".tlc/harness/lessons.md")), false);
});

test("a write to the policy file is denied for every write tool", () => {
  for (const toolName of ["Edit", "Write", "Delete", "MultiEdit", "NotebookEdit"]) {
    const decision = guardPolicySurface({
      projectDir: ROOT,
      toolName,
      filePath: join(ROOT, ".tlc/harness/config.json"),
    });
    assert.equal(decision.kind, "deny", toolName);
    if (decision.kind === "deny") {
      assert.match(decision.reason, /not agent-writable/);
      assert.match(decision.reason, /tell the operator/i);
    }
  }
});

// hazard: the refusal used to answer "change policy through the CLI instead", naming the subcommands the floor
// refuses from inside a session. Measured while dogfooding: the agent read it as a route, ran `tlc harness mode`,
// and was denied by the floor — a suggestion that costs a turn and leaves the reader no wiser.
test("the refusal does not offer the agent a route the floor also refuses", () => {
  const decision = guardPolicySurface({
    projectDir: ROOT,
    toolName: "Edit",
    filePath: join(ROOT, ".tlc/harness/config.json"),
  });
  assert.equal(decision.kind, "deny");
  if (decision.kind === "deny") {
    assert.doesNotMatch(decision.reason, /through the CLI instead/);
    // why: it may still name the CLI — it has to say why that door is closed too — but not as this reader's move.
    assert.match(decision.reason, /refuses the mutating subcommands from inside a session/);
  }
});

test("reading the policy file is allowed — only writes are blocked", () => {
  const decision = guardPolicySurface({
    projectDir: ROOT,
    toolName: "Read",
    filePath: join(ROOT, ".tlc/harness/config.json"),
  });
  assert.equal(decision.kind, "allow");
});

test("a write elsewhere is allowed", () => {
  const decision = guardPolicySurface({
    projectDir: ROOT,
    toolName: "Write",
    filePath: join(ROOT, "src/app.ts"),
  });
  assert.equal(decision.kind, "allow");
});

test("a missing tool name or path never denies", () => {
  assert.equal(guardPolicySurface({ projectDir: ROOT, toolName: undefined, filePath: "x" }).kind, "allow");
  assert.equal(
    guardPolicySurface({ projectDir: ROOT, toolName: "Write", filePath: undefined }).kind,
    "allow",
  );
});
