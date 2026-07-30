import assert from "node:assert/strict";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { evaluateFloor, type FloorRule } from "../floor.service.ts";
import { tokenizeShell } from "../floor.tokenize.ts";

const PROJECT = "/home/dev/project";

function shell(command: string) {
  return evaluateFloor({ projectDir: PROJECT, command });
}

function ruleOf(decision: { kind: string; reason?: string }): string | null {
  if (decision.kind !== "deny" || !decision.reason) {
    return null;
  }
  return /rule=([a-z-]+)/.exec(decision.reason)?.[1] ?? null;
}

function assertDenied(command: string, rule: FloorRule): void {
  const decision = shell(command);
  assert.equal(decision.kind, "deny", `expected deny for: ${command}`);
  assert.equal(ruleOf(decision), rule, `wrong rule for: ${command}`);
}

function assertAllowed(command: string): void {
  assert.equal(shell(command).kind, "allow", `expected allow for: ${command}`);
}

test("destruction outside the project is denied", () => {
  assertDenied("rm -rf /", "outside-project-destruction");
  assertDenied("rm -rf ~/Documents", "outside-project-destruction");
  assertDenied("rm -rf ../../other", "outside-project-destruction");
  assertDenied(`rm -rf ${join(homedir(), "notes")}`, "outside-project-destruction");
  assertDenied("shred -u /etc/passwd", "outside-project-destruction");
});

test("destruction inside the project or scratch space is allowed", () => {
  assertAllowed("rm -rf node_modules");
  assertAllowed("rm -rf ./dist");
  assertAllowed("rm -f src/*.log");
  assertAllowed(`rm -rf ${join(PROJECT, "build")}`);
  assertAllowed(`rm -rf ${join(tmpdir(), "scratch")}`);
});

test("a destructive verb whose target cannot be resolved is denied, not guessed", () => {
  assertDenied("rm -rf $TARGET", "unprovable-destruction");
  assertDenied("rm -rf $(cat list.txt)", "unprovable-destruction");
  assertDenied("rm -rf `pwd`/x", "unprovable-destruction");
  assertDenied("rm -rf", "unprovable-destruction");
  assertDenied('eval "rm -rf /tmp/x"', "unprovable-destruction");
});

test("a heredoc body is data, so a destructive line inside it is not a command", () => {
  assertAllowed("cat > run.sh <<'EOF'\nrm -rf /\nEOF");
  assertAllowed('cat > cfg.json <<EOF\n{ "a": "rm -rf ~/" }\nEOF');
  assertAllowed("cat <<-EOF\nshutdown now\nEOF\nnpm test");
});

// why: heredocs plus an inline quoted script make the tokenizer report unbalanced, and a destructive
// verb quoted as data must not be read as a command.
test("a multi-line script whose quoting defeats splitting is not blocked for mentioning rm", () => {
  assertAllowed(
    [
      "cd /tmp/probe || exit 1",
      "cat > cfg.json <<'EOF'",
      '{ "shell": { "catastrophicAsk": false } }',
      "EOF",
      "mk(){ python3 -c \"print('rm -rf /')\"; }",
      "echo done",
    ].join("\n"),
  );
});

test("a shell invoked with an inline command cannot smuggle the verb past the gate", () => {
  assertDenied('bash -c "rm -rf /"', "unprovable-destruction");
  assertDenied("sh -c 'rm -rf ~/'", "unprovable-destruction");
  assertAllowed("bash scripts/build.sh");
});

test("a destructive verb quoted as data is not a command", () => {
  assertAllowed('grep -r "rm -rf" .');
  assertAllowed('echo "do not run rm -rf /"');
  assertAllowed("git commit -m 'stop calling rm -rf'");
});

test("unresolved arguments to a harmless verb are still allowed", () => {
  assertAllowed("git checkout $(git rev-parse HEAD)");
  assertAllowed("echo $HOME");
  assertAllowed("npm run build");
});

test("wrappers do not hide the verb", () => {
  assertDenied("sudo rm -rf /", "outside-project-destruction");
  assertDenied("sudo -n rm -rf /etc", "outside-project-destruction");
  assertDenied("env FOO=bar rm -rf /var", "outside-project-destruction");
  assertDenied("/bin/rm -rf /", "outside-project-destruction");
});

test("a destructive verb later in the command list is still caught", () => {
  assertDenied("npm run build && rm -rf /", "outside-project-destruction");
  assertDenied("echo hi; rm -rf ~/", "outside-project-destruction");
  assertDenied("cat x | rm -rf /etc", "outside-project-destruction");
});

test("machine control is denied", () => {
  assertDenied("shutdown -h now", "machine-control");
  assertDenied("sudo reboot", "machine-control");
});

test("force push is denied and the lease alternative is named", () => {
  assertDenied("git push --force origin main", "history-rewrite");
  assertDenied("git push -f", "history-rewrite");
  const decision = shell("git push --force");
  assert.match(decision.kind === "deny" ? decision.reason : "", /--force-with-lease/);
});

test("ordinary and lease-guarded pushes are allowed", () => {
  assertAllowed("git push origin main");
  assertAllowed("git push --force-with-lease origin main");
});

test("reading credentials into the transcript is denied", () => {
  assertDenied("cat .env", "secret-access");
  assertDenied("cat .env.production", "secret-access");
  assertDenied(`cat ${join(homedir(), ".ssh", "id_rsa")}`, "secret-access");
  assertDenied(`base64 ${join(homedir(), ".aws", "credentials")}`, "secret-access");
  assertDenied("cat deploy.pem", "secret-access");
});

test("env templates are not secrets", () => {
  assertAllowed("cat .env.example");
  assertAllowed("cat .env.sample");
  assertAllowed("cat .env.template");
  assertAllowed("cat README.md");
});

test("the read tools are gated on credential paths", () => {
  for (const toolName of ["Read", "Edit", "MultiEdit"]) {
    const decision = evaluateFloor({ projectDir: PROJECT, toolName, filePath: join(PROJECT, ".env") });
    assert.equal(decision.kind, "deny", toolName);
    assert.equal(ruleOf(decision), "secret-access");
  }
});

test("read.before is gated even when the tool name is unknown", () => {
  const decision = evaluateFloor({
    projectDir: PROJECT,
    filePath: join(homedir(), ".ssh", "id_ed25519"),
    isReadEvent: true,
  });
  assert.equal(ruleOf(decision), "secret-access");
});

test("writing a credential file is not a floor concern — only reading one is", () => {
  const decision = evaluateFloor({ projectDir: PROJECT, toolName: "Write", filePath: join(PROJECT, ".env") });
  assert.equal(decision.kind, "allow");
});

test("every denial names its rule and refuses the config escape", () => {
  const decision = shell("rm -rf /");
  assert.equal(decision.kind, "deny");
  const text = decision.kind === "deny" ? decision.reason : "";
  assert.match(text, /^FLOOR: /);
  assert.match(text, /no config switch/);
});

test("an empty or harmless command is allowed", () => {
  assert.equal(evaluateFloor({ projectDir: PROJECT }).kind, "allow");
  assertAllowed("");
  assertAllowed("ls -la");
});

test("separators inside a substitution do not split the command", () => {
  const segments = tokenizeShell("echo $(a; b) tail");
  assert.equal(segments.length, 1);
  assert.deepEqual(
    segments[0]?.words.map((word) => word.text),
    ["echo", "$(a; b)", "tail"],
  );
});

test("quoted separators are literal, not command boundaries", () => {
  const segments = tokenizeShell('echo "a; b" c');
  assert.equal(segments.length, 1);
  assert.deepEqual(
    segments[0]?.words.map((word) => word.text),
    ["echo", "a; b", "c"],
  );
});

test("an unbalanced quote marks every segment opaque rather than trusting the split", () => {
  const segments = tokenizeShell('rm -rf "x ; echo safe');
  assert.ok(segments.every((segment) => segment.opaque));
});

// invariant: a backslash escapes only what needs escaping. Consuming path separators would leave the
// secret rule unable to resolve any Windows path.
test("a Windows path keeps its separators through the tokenizer", () => {
  const words = tokenizeShell(String.raw`cat C:\Users\me\.ssh\id_rsa`)[0]?.words.map((w) => w.text);
  assert.deepEqual(words, ["cat", String.raw`C:\Users\me\.ssh\id_rsa`]);
});

test("a backslash still escapes what genuinely needs escaping", () => {
  assert.deepEqual(
    tokenizeShell(String.raw`rm my\ file.txt`)[0]?.words.map((w) => w.text),
    ["rm", "my file.txt"],
  );
  assert.deepEqual(
    tokenizeShell(String.raw`echo a\;b`)[0]?.words.map((w) => w.text),
    ["echo", "a;b"],
  );
});

// why: node:path treats C:\ as absolute only on Windows, so the denial is asserted by the CI Windows
// leg rather than here.
