import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, test } from "node:test";
import type { ProviderWiring } from "../../src/contracts/index.ts";
import { coreFacade } from "../../src/core/index.ts";
import { projectConfigPath } from "../../src/platform/paths.ts";
import { mergeClaudeSettings } from "../../src/providers/claude/claude.wiring.ts";
import { cursorWiring, formatWiringProblems } from "../../src/providers/cursor/cursor.wiring.ts";
import type { ProviderPort } from "../../src/providers/provider.port.ts";
import {
  type Check,
  checkHookRuntime,
  checkId,
  checkNodeVersion,
  checkProjectPolicy,
  checkProviders,
  exitCodeFor,
  formatReport,
  providerWiringStatus,
  runChecks,
  toReport,
  wiringProblems,
} from "../doctor.ts";

function fixtureRoot(): string {
  return mkdtempSync(join(tmpdir(), "doctor-"));
}

const cleanupRoots: string[] = [];

function newRoot(): string {
  const root = fixtureRoot();
  cleanupRoots.push(root);
  return root;
}

afterEach(() => {
  while (cleanupRoots.length > 0) {
    const root = cleanupRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("checkNodeVersion", () => {
  test("ok for a supported major", () => {
    const checks = checkNodeVersion("v24.4.0");
    assert.equal(checks[0]?.level, "ok");
  });

  test("fail for a Node major below the floor", () => {
    const checks = checkNodeVersion("v18.19.0");
    assert.equal(checks[0]?.level, "fail");
  });

  test("adds a warn for the EOL Node 25 line without failing", () => {
    const checks = checkNodeVersion("v25.0.0");
    assert.equal(checks[0]?.level, "ok");
    assert.ok(checks.some((c) => c.level === "warn" && c.name === "Node.js line"));
  });
});

describe("checkHookRuntime", () => {
  test("ok when Bun is resolved", () => {
    const check = checkHookRuntime("/opt/tlc-home", "/usr/bin/bun");
    assert.equal(check.level, "ok");
  });

  test("warn, never fail, naming the measured cost when Bun is absent", () => {
    const check = checkHookRuntime("/opt/tlc-home", null);
    assert.equal(check.level, "warn");
    assert.match(check.detail, /1 ms/);
    assert.match(check.detail, /27 ms/);
  });
});

describe("providerWiringStatus", () => {
  test("not-installed when the provider home dir is absent", () => {
    const root = newRoot();
    const wiring: ProviderWiring = {
      target: join(root, "no-such-home", "hooks.json"),
      strategy: "replace",
      entries: [],
    };
    assert.equal(providerWiringStatus(wiring), "not-installed");
  });

  test("detected-but-unwired for a replace-strategy target with no harness file yet", () => {
    const root = newRoot();
    const home = join(root, "cursor-home");
    mkdirSync(home, { recursive: true });
    const wiring: ProviderWiring = { target: join(home, "hooks.json"), strategy: "replace", entries: [] };
    assert.equal(providerWiringStatus(wiring), "detected-but-unwired");
  });

  // hazard: this test used to assert that a file carrying the marker is wired, with one entry out of nineteen. That
  // was the weak rule — a colleague's session was blocked by a file that passed it. The marker still answers "is
  // this file ours"; whether the hooks work is a separate question ([/decisions/ad-032.md](/decisions/ad-032.md)).
  test("a marker with one entry out of many is detected but not wired", () => {
    const root = newRoot();
    const home = join(root, "cursor-home");
    mkdirSync(home, { recursive: true });
    const target = join(home, "hooks.json");
    writeFileSync(target, JSON.stringify({ hooks: { stop: [{ command: "node tlc-exec.mjs shim stop" }] } }));
    const wiring: ProviderWiring = { target, strategy: "replace", entries: [] };
    assert.equal(providerWiringStatus(wiring), "detected-but-unwired");
  });

  test("detected-but-unwired for a merge-strategy target missing the desired entries", () => {
    const root = newRoot();
    const home = join(root, "claude-home");
    mkdirSync(home, { recursive: true });
    const wiring: ProviderWiring = {
      target: join(home, "settings.json"),
      strategy: "merge",
      entries: [
        { hookEvent: "Stop", handler: "stop", command: "node", args: ["/x", "stop"], timeoutSeconds: 5 },
      ],
    };
    assert.equal(providerWiringStatus(wiring), "detected-but-unwired");
  });

  test("wired for a merge-strategy target already containing every desired entry", () => {
    const root = newRoot();
    const home = join(root, "claude-home");
    mkdirSync(home, { recursive: true });
    const launcher = "/x/bin/tlc-exec.mjs";
    const entries = [
      { hookEvent: "Stop", handler: "stop", command: "node", args: [launcher, "stop"], timeoutSeconds: 5 },
    ];
    const target = join(home, "settings.json");
    writeFileSync(
      target,
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "node", args: [launcher, "stop"] }] }] },
      }),
    );
    assert.equal(providerWiringStatus({ target, strategy: "merge", entries }), "wired");
  });

  test("a stale harness entry from an older launcher path is replaced, not duplicated", () => {
    const root = newRoot();
    const home = join(root, "claude-home");
    mkdirSync(home, { recursive: true });
    const entries = [
      {
        hookEvent: "Stop",
        handler: "stop",
        command: "node",
        args: ["/new/bin/tlc-exec.mjs", "stop"],
        timeoutSeconds: 5,
      },
    ];
    const target = join(home, "settings.json");
    writeFileSync(
      target,
      JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "node", args: ["/old/bin/tlc-exec.mjs", "stop"] }] },
            { hooks: [{ type: "command", command: "other-tool" }] },
          ],
        },
      }),
    );
    assert.equal(providerWiringStatus({ target, strategy: "merge", entries }), "detected-but-unwired");
    const merged = mergeClaudeSettings(readFileSync(target, "utf8"), entries);
    assert.ok(merged.ok);
    if (merged.ok) {
      const text = merged.settingsText;
      assert.equal(text.includes("/old/bin/tlc-exec.mjs"), false, "the stale entry must be gone");
      assert.ok(text.includes("/new/bin/tlc-exec.mjs"));
      assert.ok(text.includes("other-tool"), "a foreign hook must survive");
    }
  });
});

describe("checkProviders", () => {
  test("reports one check per registered provider", () => {
    const root = newRoot();
    const home = join(root, "runtime-home");
    mkdirSync(home, { recursive: true });
    const fixtureProvider = {
      name: "fixture",
      wiring: () => ({
        target: join(root, "absent-home", "x.json"),
        strategy: "replace" as const,
        entries: [],
      }),
    } as unknown as ProviderPort;
    const checks = checkProviders([fixtureProvider], home);
    assert.equal(checks.length, 1);
    assert.equal(checks[0]?.name, "fixture wiring");
    assert.equal(checks[0]?.level, "ok");
    assert.match(checks[0]?.detail ?? "", /not installed/);
  });
});

describe("checkProjectPolicy", () => {
  function writeConfig(root: string, patch: Record<string, unknown>): void {
    const path = projectConfigPath(root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(patch), "utf8");
  }

  test("reports the project config path whether or not it exists", () => {
    const root = newRoot();
    const checks = checkProjectPolicy(root);
    assert.equal(checks.length, 3);
    assert.ok(checks.every((c) => c.level === "ok"));
  });

  test("a valid posture is an ok row naming the posture and where it came from", () => {
    const root = newRoot();
    writeConfig(root, { version: 1, mode: "focus" });
    const row = checkProjectPolicy(root).find((c) => c.name === "operator posture");
    assert.equal(row?.level, "ok");
    assert.match(row?.detail ?? "", /focus/);
    assert.match(row?.detail ?? "", /from config/);
  });

  // hazard: a `mode` the loader cannot honour is replaced by the default with no message anywhere. The warn has
  // to quote the refused word — "invalid posture" alone leaves the operator hunting for which word it was.
  test("a value that is not a posture warns, quoting it and the accepted words", () => {
    const root = newRoot();
    writeConfig(root, { version: 1, mode: "heads-down" });
    const row = checkProjectPolicy(root).find((c) => c.name === "operator posture");
    assert.equal(row?.level, "warn");
    assert.match(row?.detail ?? "", /heads-down/);
    assert.match(row?.detail ?? "", /paired \| solo \| focus/);
    assert.match(row?.detail ?? "", /solo/);
  });

  // hazard: the remediation used to end `tlc harness mode solo` — the posture the fallback landed on, which is
  // the one value the operator demonstrably did not ask for. Read as advice it makes the substitution permanent.
  test("the remediation offers the choice instead of suggesting the fallback", () => {
    const root = newRoot();
    writeConfig(root, { version: 1, mode: "heads-down" });
    const detail = checkProjectPolicy(root).find((c) => c.name === "operator posture")?.detail ?? "";
    assert.match(detail, /tlc harness mode <paired\|solo\|focus>/);
    assert.doesNotMatch(detail, /tlc harness mode solo\b/);
  });

  // why: warn keeps doctor's exit code at 0. A bad posture is a config fault to fix, not a broken install, and
  // failing here would block the very command an operator runs to find out what is wrong.
  test("the posture warn does not fail the doctor run", () => {
    const root = newRoot();
    writeConfig(root, { version: 1, mode: "heads-down" });
    assert.equal(exitCodeFor(checkProjectPolicy(root)), 0);
  });
});

describe("exitCodeFor / formatReport", () => {
  test("exits 0 when only warn/ok checks are present", () => {
    assert.equal(
      exitCodeFor([
        { level: "ok", name: "a", detail: "" },
        { level: "warn", name: "b", detail: "" },
      ]),
      0,
    );
  });

  test("exits non-zero when any check fails", () => {
    assert.equal(
      exitCodeFor([
        { level: "ok", name: "a", detail: "" },
        { level: "fail", name: "b", detail: "" },
      ]),
      1,
    );
  });

  test("formatReport marks each level distinctly and summarizes failures", () => {
    const report = formatReport([
      { level: "ok", name: "a", detail: "fine" },
      { level: "warn", name: "b", detail: "meh" },
      { level: "fail", name: "c", detail: "broken" },
    ]);
    assert.match(report, /OK {2}.*a — fine/);
    assert.match(report, /WARN.*b — meh/);
    assert.match(report, /FAIL.*c — broken/);
    assert.match(report, /1 issue\(s\)/);
  });
});

describe("toReport", () => {
  const sample: Check[] = [
    { level: "ok", name: "Node.js runtime", detail: "v24.4.0 (>= 24)" },
    { level: "warn", name: "hook runtime", detail: "Node + dist/" },
    { level: "fail", name: "dist bundles", detail: "missing — run: tlc harness build" },
  ];

  test("carries an id, a status and a detail per check", () => {
    const report = toReport(sample);
    assert.deepEqual(report.checks, [
      { id: "node-js-runtime", name: "Node.js runtime", status: "OK", detail: "v24.4.0 (>= 24)" },
      { id: "hook-runtime", name: "hook runtime", status: "WARN", detail: "Node + dist/" },
      {
        id: "dist-bundles",
        name: "dist bundles",
        status: "FAIL",
        detail: "missing — run: tlc harness build",
      },
    ]);
  });

  test("ok is false when any check fails, and the counts agree with the levels", () => {
    const report = toReport(sample);
    assert.equal(report.ok, false);
    assert.equal(report.failed, 1);
    assert.equal(report.warned, 1);
  });

  test("a warning alone leaves ok true, matching the exit code", () => {
    const warnOnly: Check[] = [{ level: "warn", name: "hook runtime", detail: "Node + dist/" }];
    const report = toReport(warnOnly);
    assert.equal(report.ok, true);
    assert.equal(report.ok, exitCodeFor(warnOnly) === 0);
  });

  test("the report survives a JSON round trip, which is the whole point of the flag", () => {
    assert.deepEqual(JSON.parse(JSON.stringify(toReport(sample))), toReport(sample));
  });

  test("checkId slugs a name without leaving separators at either end", () => {
    assert.equal(checkId("CLI on PATH"), "cli-on-path");
    assert.equal(checkId("capability shipGate"), "capability-shipgate");
    assert.equal(checkId("Node.js runtime"), "node-js-runtime");
  });
});

describe("runChecks", () => {
  test("never mentions the legacy .cursor/harness install path", () => {
    const root = newRoot();
    const home = join(root, "home");
    mkdirSync(home, { recursive: true });
    const checks = runChecks({
      root,
      home,
      runtimeHome: join(root, "runtime-home"),
      platform: "linux",
      nodeVersion: "v24.4.0",
      bunPath: null,
      registry: [],
    });
    const text = formatReport(checks);
    assert.equal(text.includes(".cursor/harness"), false);
  });
});

describe("checkObservedRails", () => {
  function writeConfig(root: string, patch: Record<string, unknown>): void {
    const path = projectConfigPath(root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(patch), "utf8");
  }

  test("observation off adds no row at all", () => {
    const root = newRoot();
    writeConfig(root, { version: 1 });
    assert.equal(
      checkProjectPolicy(root).some((c) => c.name === "observed rails"),
      false,
    );
  });

  test("a rail with a checker is an ok row naming it", () => {
    const root = newRoot();
    writeConfig(root, { version: 1, observe: { enabled: true, rails: ["comments"] } });
    const row = checkProjectPolicy(root).find((c) => c.name === "observed rails");
    assert.equal(row?.level, "ok");
    assert.match(row?.detail ?? "", /comments/);
  });

  // hazard: a name with no checker used to do nothing and report nothing. An operator reading that silence would
  // conclude the property always holds, which is the worst possible misreading of a measurement rail.
  test("a rail with no checker warns, quoting it and naming what is observable", () => {
    const root = newRoot();
    writeConfig(root, { version: 1, observe: { enabled: true, rails: ["plan-gate"] } });
    const row = checkProjectPolicy(root).find((c) => c.name === "observed rails");
    assert.equal(row?.level, "warn");
    assert.match(row?.detail ?? "", /plan-gate/);
    assert.match(row?.detail ?? "", /Observable today: comments/);
  });

  // why: observation on with an empty list is the shape `tlc harness init` produces if the operator says yes and
  // names nothing. Silence there is the same misreading.
  test("observation on with no rails listed warns that nothing is measured", () => {
    const root = newRoot();
    writeConfig(root, { version: 1, observe: { enabled: true, rails: [] } });
    const row = checkProjectPolicy(root).find((c) => c.name === "observed rails");
    assert.equal(row?.level, "warn");
    assert.match(row?.detail ?? "", /nothing is measured/);
  });

  test("neither warn fails the doctor run", () => {
    const root = newRoot();
    writeConfig(root, { version: 1, observe: { enabled: true, rails: ["nope"] } });
    assert.equal(exitCodeFor(checkProjectPolicy(root)), 0);
  });
});

describe("checkPolicyDivergence", () => {
  // hazard: a divergence blocks every acting tool call, and doctor — the one command an operator runs to find out
  // what is wrong — said nothing about it. A colleague's agent was fully blocked, ran `status`, learned nothing.
  test("a diverged source is reported, naming the path and the command", () => {
    const root = newRoot();
    const path = projectConfigPath(root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 1 }), "utf8");
    coreFacade.policy.recordPolicyBaseline(root, "s1");
    writeFileSync(path, JSON.stringify({ version: 2 }), "utf8");

    const row = checkProjectPolicy(root).find((c) => c.name === "policy baseline");
    assert.equal(row?.level, "warn");
    assert.match(row?.detail ?? "", /changed out of band/);
    assert.match(row?.detail ?? "", /tlc harness policy accept/);
  });

  // why: silent when healthy. A reassurance on every clean run is one more line to skim past.
  test("a matching baseline adds no row at all", () => {
    const root = newRoot();
    const path = projectConfigPath(root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 1 }), "utf8");
    coreFacade.policy.recordPolicyBaseline(root, "s1");
    assert.equal(
      checkProjectPolicy(root).some((c) => c.name === "policy baseline"),
      false,
    );
  });

  test("the warn does not fail the doctor run", () => {
    const root = newRoot();
    const path = projectConfigPath(root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 1 }), "utf8");
    coreFacade.policy.recordPolicyBaseline(root, "s1");
    writeFileSync(path, JSON.stringify({ version: 2 }), "utf8");
    assert.equal(exitCodeFor(checkProjectPolicy(root)), 0);
  });
});

describe("wiring health", () => {
  /** why: a realistic document — every declared event wired — so a single broken entry is what the test isolates. */
  function cursorLike(root: string, breakEvent?: string): ProviderWiring {
    const launcher = join(root, "bin", "tlc-exec.mjs");
    mkdirSync(dirname(launcher), { recursive: true });
    writeFileSync(launcher, "// launcher\n");
    const wiring = cursorWiring({ launcherPath: launcher });
    const hooks: Record<string, { command: string }[]> = {};
    for (const entry of wiring.entries) {
      const full = [entry.command, ...entry.args].join(" ");
      hooks[entry.hookEvent] = [
        { command: entry.hookEvent === breakEvent ? `${entry.command} ${launcher}` : full },
      ];
    }
    const home = join(root, "cursor-home");
    mkdirSync(home, { recursive: true });
    const target = join(home, "hooks.json");
    writeFileSync(target, JSON.stringify({ version: 1, hooks }));
    return { ...wiring, target };
  }

  // hazard: marker presence decided health, so a file carrying the marker in one entry and a broken command in
  // another reported `wired`. A colleague's session was blocked by exactly that shape.
  test("a file with the marker but one broken command is not wired", () => {
    const root = newRoot();
    const wiring = cursorLike(root, "preToolUse");
    assert.equal(providerWiringStatus(wiring), "detected-but-unwired");
    assert.match(formatWiringProblems(wiringProblems(wiring)), /preToolUse/);
  });

  test("a fully healthy file is still wired", () => {
    const root = newRoot();
    const wiring = cursorLike(root);
    assert.deepEqual(wiringProblems(wiring), []);
    assert.equal(providerWiringStatus(wiring), "wired");
  });

  // why: "detected but not wired" told an operator that something was wrong and nothing else.
  test("the doctor detail names the failing event and the reason", () => {
    const root = newRoot();
    const wiring = cursorLike(root, "preToolUse");
    const provider = { name: "cursor", wiring: () => wiring } as unknown as ProviderPort;
    const check = checkProviders([provider], join(root, "home"))[0];
    assert.equal(check?.level, "warn");
    assert.match(check?.detail ?? "", /preToolUse/);
    assert.match(check?.detail ?? "", /no handler after the script/);
    assert.match(check?.detail ?? "", /tlc harness update/);
  });
});
