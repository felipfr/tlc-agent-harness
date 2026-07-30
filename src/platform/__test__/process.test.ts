import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runProcess } from "../process.ts";

describe("runProcess", () => {
  test("resolves with exit code 0 and captures stdout for a successful command", async () => {
    const result = await runProcess({ command: ["node", "-e", "console.log('hello')"] });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), "hello");
  });

  test("captures stderr output", async () => {
    const result = await runProcess({ command: ["node", "-e", "console.error('boom')"] });
    assert.equal(result.stderr.trim(), "boom");
  });

  test("returns exit code 0 immediately for an empty command array", async () => {
    const result = await runProcess({ command: [] });
    assert.deepEqual(result, { exitCode: 0, stdout: "", stderr: "" });
  });

  test("does not time out when the command finishes before timeoutMs elapses", async () => {
    const result = await runProcess({
      command: ["node", "-e", "console.log('fast')"],
      timeoutMs: 5000,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), "fast");
  });

  test("enforces timeoutMs and resolves with a non-zero exit code instead of hanging", async () => {
    const result = await runProcess({
      command: ["node", "-e", "setTimeout(() => {}, 5000)"],
      timeoutMs: 150,
    });
    assert.notEqual(result.exitCode, 0);
  });

  test("behaves identically to before when timeoutMs is omitted (no enforcement)", async () => {
    const result = await runProcess({
      command: ["node", "-e", "setTimeout(() => { console.log('done'); }, 200)"],
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), "done");
  });
});
