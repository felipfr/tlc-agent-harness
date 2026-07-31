import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { checkPolicySurface } from "../floor.policy-surface.ts";
import { evaluateFloor } from "../floor.service.ts";
import { tokenizeShell } from "../floor.tokenize.ts";

const PROJECT = "/home/dev/project";
const CONFIG = ".tlc/harness/config.json";
const HANDOFF = ".tlc/harness/state/handoff.json";

function verdict(command: string) {
  return checkPolicySurface(PROJECT, command, tokenizeShell(command));
}

function assertDenied(command: string): void {
  assert.equal(verdict(command).kind, "deny", `expected deny for: ${command}`);
}

function assertAllowed(command: string): void {
  assert.equal(verdict(command).kind, "allow", `expected allow for: ${command}`);
}

test("an interpreter writing the policy file is denied", () => {
  // why: this is the command from the incident that motivated the rule — it passed the tool guard by
  // never touching a write tool.
  assertDenied(`python3 -c "import json; json.dump({}, open('${CONFIG}','w'))"`);
  assertDenied(`python3 - <<'PY'\nopen('${CONFIG}','w')\nPY`);
  assertDenied(`perl -pi -e s/a/b/ ${CONFIG}`);
  assertDenied(`node --eval "require('fs').writeFileSync('${CONFIG}','{}')" ${CONFIG}`);
  assertDenied(`ruby -e 'x' ${CONFIG}`);
});

test("known writers on the policy surface are denied", () => {
  assertDenied(`sed -i s/a/b/ ${CONFIG}`);
  assertDenied(`tee ${CONFIG}`);
  assertDenied(`cp /tmp/other ${CONFIG}`);
  assertDenied(`mv /tmp/other ${CONFIG}`);
  assertDenied(`truncate -s 0 ${CONFIG}`);
  assertDenied(`chmod 777 ${CONFIG}`);
});

test("redirects into the policy surface are denied in every spelling", () => {
  assertAllowed("cat /tmp/other > /tmp/copy");
  assertDenied(`cat /tmp/other > ${CONFIG}`);
  assertDenied(`cat /tmp/other >${CONFIG}`);
  assertDenied(`cat /tmp/other >>${CONFIG}`);
  assertDenied(`echo {}>${CONFIG}`);
  assertDenied(`printf '{}' > ${join(PROJECT, CONFIG)}`);
  assertDenied(`cat /tmp/x > ${HANDOFF}`);
});

test("proven readers on the policy surface are allowed", () => {
  // why: the bootstrap instructs the agent to read handoff.json, and inspecting the config is ordinary
  // investigation. A rule that broke these would be a misfire, not a gate.
  assertAllowed(`cat ${HANDOFF}`);
  assertAllowed(`head -20 ${CONFIG}`);
  assertAllowed(`grep testCommand ${CONFIG}`);
  assertAllowed(`jq .grind ${CONFIG}`);
  assertAllowed(`wc -l ${CONFIG}`);
  assertAllowed(`diff ${CONFIG} /tmp/other`);
  assertAllowed(`ls -la ${join(PROJECT, ".tlc/harness/state")}`);
  assertAllowed(`stat ${CONFIG}`);
});

test("git is a reader only for subcommands that cannot write", () => {
  assertAllowed(`git show HEAD:${CONFIG}`);
  assertAllowed(`git diff HEAD -- ${CONFIG}`);
  assertAllowed(`git log --oneline -- ${CONFIG}`);
  assertAllowed(`git ls-files ${CONFIG}`);
  assertDenied(`git checkout -- ${CONFIG}`);
  assertDenied(`git restore ${CONFIG}`);
  assertDenied(`git apply ${CONFIG}`);
  assertDenied(`git clean -fd ${CONFIG}`);
});

test("a target that cannot be established is denied", () => {
  assertDenied(`cp /tmp/x "$CFG/.tlc/harness/config.json"`);
  assertDenied(`echo x > .tlc/harness/$name`);
  assertDenied(`sh -c "echo x > ${CONFIG}`);
});

test("removing a directory that contains the surface is denied", () => {
  assertDenied(`rm -rf ${join(PROJECT, ".tlc/harness/state")}`);
  assertDenied("rm -rf .tlc/harness");
  assertDenied("rm -rf .tlc");
  assertDenied("rm -rf .tlc/harness/state/flags");
});

test("ordinary work near the project root is untouched", () => {
  // hazard: the project root also contains the policy surface. Counting it as a reference would deny the
  // most common commands there are, which is why the root is excluded by name.
  assertAllowed("find . -name '*.ts'");
  assertAllowed("grep -r testCommand .");
  assertAllowed("rm -rf node_modules");
  assertAllowed("rm -rf ./dist");
  assertAllowed("npx biome check .");
  assertAllowed("node --test src/**/__test__/*.test.ts");
  assertAllowed(`cat ${join(PROJECT, ".tlc/harness/lessons.md")}`);
  assertAllowed("python3 -c \"print('hello')\"");
});

test("a proven reader may read another project's policy file", () => {
  assertAllowed("cat /other/repo/.tlc/harness/config.json");
});

test("a non-reader naming any harness policy path is denied, even one outside this project", () => {
  // why: prove-safe. Once the verb is not a proven reader, the gate has no way to establish that the path
  // in the string belongs to another repository rather than this one, so it refuses instead of guessing.
  assertDenied("python3 -c x /other/repo/.tlc/harness/config.json");
});

test("the mutating harness CLI is denied from inside the session", () => {
  assertDenied("tlc harness pause");
  assertDenied("tlc harness resume");
  assertDenied("tlc harness grind off");
  assertDenied("tlc harness mode solo");
  assertDenied("tlc harness init --minimal");
  assertDenied("tlc harness gate test-command node --test");
  assertDenied("env tlc harness grind off");
  assertDenied("/usr/local/bin/tlc harness mode solo");
  assertDenied("tlc harness --json pause");
});

test("the read-only harness CLI is allowed", () => {
  assertAllowed("tlc harness status");
  assertAllowed("tlc harness");
  assertAllowed("tlc harness help concepts");
  assertAllowed("tlc harness obs live");
  assertAllowed("tlc harness prices lookup x");
  assertAllowed("tlc harness lessons list");
  assertAllowed("tlc harness test");
});

test("one denying segment denies the whole command", () => {
  assertDenied(`ls; sed -i s/a/b/ ${CONFIG}`);
  assertDenied(`cat ${CONFIG} | tee ${CONFIG}`);
  assertAllowed(`cat ${CONFIG}; git status`);
});

test("a heredoc fed to an interpreter is a program", () => {
  assertDenied(`python3 - <<'PY'\nopen('${CONFIG}','w')\nPY`);
  assertDenied(`bash <<'SH'\necho x > ${CONFIG}\nSH`);
  assertDenied(`perl <<'PL'\nopen(F,">${CONFIG}")\nPL`);
});

test("a heredoc fed to something that does not execute it is a document", () => {
  // hazard: the first version of this rule denied "anything not a proven reader", which blocked
  // `git commit -F -` for a message that merely named the path — writing about the rule tripped it. Every
  // commit in this feature would have had to route around the gate it was adding.
  assertAllowed(`git commit -F - <<'EOF'\nfix: stop writing ${CONFIG} by hand\nEOF`);
  assertAllowed(`cat <<'EOF'\nsee ${CONFIG} for the gate commands\nEOF`);
  assertAllowed(`gh pr create --body-file - <<'EOF'\ntouches ${CONFIG}\nEOF`);
});

test("a heredoc that writes the surface is still caught by the path rules", () => {
  // why: dropping the interpreter check for documents does not open the write route — the redirect and
  // path-argument rules see the target without ever reading the body.
  assertDenied(`cat > ${CONFIG} <<'EOF'\n{}\nEOF`);
  assertDenied(`tee ${CONFIG} <<'EOF'\n{}\nEOF`);
});

test("the floor denies through evaluateFloor with the rule named", () => {
  const decision = evaluateFloor({
    projectDir: PROJECT,
    command: `python3 -c "import json; json.dump({}, open('${CONFIG}','w'))"`,
  });
  assert.equal(decision.kind, "deny");
  if (decision.kind === "deny") {
    assert.match(decision.reason, /rule=policy-surface-write/);
    assert.match(decision.reason, /tlc harness gate test-command/);
    assert.match(decision.reason, /your own terminal/);
    // invariant: it carries the same shape as every other floor rule, including the line stating that no
    // config switch exists, and it never names a policy field the agent could be tempted to go set.
    assert.match(decision.reason, /it has no config switch/);
    assert.doesNotMatch(decision.reason, /grind\.|shipGate|policy\.json/);
  }
});

test("the floor still allows the reads the bootstrap asks for", () => {
  assert.equal(evaluateFloor({ projectDir: PROJECT, command: `cat ${HANDOFF}` }).kind, "allow");
  assert.equal(evaluateFloor({ projectDir: PROJECT, command: `grep -n mode ${CONFIG}` }).kind, "allow");
});
