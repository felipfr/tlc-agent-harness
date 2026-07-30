import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import type { ProviderWiring } from "../../src/contracts/index.ts";
import { mergeClaudeSettings } from "../../src/providers/claude/claude.wiring.ts";
import type { ProviderPort } from "../../src/providers/provider.port.ts";
import {
  checkHookRuntime,
  checkNodeVersion,
  checkProjectPolicy,
  checkProviders,
  exitCodeFor,
  formatReport,
  providerWiringStatus,
  runChecks,
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

  test("wired for a replace-strategy target already carrying the harness marker", () => {
    const root = newRoot();
    const home = join(root, "cursor-home");
    mkdirSync(home, { recursive: true });
    const target = join(home, "hooks.json");
    writeFileSync(target, JSON.stringify({ hooks: { stop: [{ command: "node tlc-exec.mjs shim stop" }] } }));
    const wiring: ProviderWiring = { target, strategy: "replace", entries: [] };
    assert.equal(providerWiringStatus(wiring), "wired");
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
  test("reports the project config path whether or not it exists", () => {
    const root = newRoot();
    const checks = checkProjectPolicy(root);
    assert.equal(checks.length, 2);
    assert.ok(checks.every((c) => c.level === "ok"));
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
