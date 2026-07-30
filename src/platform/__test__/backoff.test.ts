import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { nextDelay, retry } from "../backoff.ts";

describe("nextDelay", () => {
  test("random: () => 0 yields delay 0 (full jitter, not equal jitter)", () => {
    const delay = nextDelay({ attempt: 3, baseMs: 100, capMs: 5000, random: () => 0 });
    assert.equal(delay, 0);
  });

  test("random: () => 1 below the cap yields base * 2^attempt", () => {
    const delay = nextDelay({ attempt: 2, baseMs: 100, capMs: 5000, random: () => 1 });
    assert.equal(delay, 400);
  });

  test("random: () => 1 at high attempts yields exactly the cap", () => {
    const delay = nextDelay({ attempt: 20, baseMs: 100, capMs: 5000, random: () => 1 });
    assert.equal(delay, 5000);
  });

  test("delay never exceeds the cap for any random value in [0, 1]", () => {
    for (const random of [0, 0.25, 0.5, 0.75, 1]) {
      const delay = nextDelay({ attempt: 20, baseMs: 100, capMs: 5000, random: () => random });
      assert.equal(delay <= 5000, true);
      assert.equal(delay >= 0, true);
    }
  });
});

describe("retry", () => {
  test("returns the value on first success without sleeping", async () => {
    let sleepCalls = 0;
    const result = await retry(() => "ok", {
      attempts: 3,
      sleep: async () => {
        sleepCalls += 1;
      },
    });
    assert.equal(result, "ok");
    assert.equal(sleepCalls, 0);
  });

  test("stops after N attempts and rethrows the last error", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        retry(
          () => {
            calls += 1;
            throw new Error(`fail-${calls}`);
          },
          { attempts: 3, sleep: async () => {}, random: () => 0 },
        ),
      /fail-3/,
    );
    assert.equal(calls, 3);
  });

  test("does not retry when shouldRetry returns false", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        retry(
          () => {
            calls += 1;
            throw new Error("non-retryable");
          },
          { attempts: 5, shouldRetry: () => false, sleep: async () => {} },
        ),
      /non-retryable/,
    );
    assert.equal(calls, 1);
  });

  test("sleeps between attempts using the backoff delay", async () => {
    const delays: number[] = [];
    let calls = 0;
    await assert.rejects(
      () =>
        retry(
          () => {
            calls += 1;
            throw new Error("boom");
          },
          {
            attempts: 3,
            random: () => 0,
            sleep: async (ms) => {
              delays.push(ms);
            },
          },
        ),
      /boom/,
    );
    assert.equal(delays.length, 2);
    assert.deepEqual(delays, [0, 0]);
    assert.equal(calls, 3);
  });

  test("succeeds if fn succeeds within the attempt budget", async () => {
    let calls = 0;
    const result = await retry(
      () => {
        calls += 1;
        if (calls < 2) {
          throw new Error("transient");
        }
        return "recovered";
      },
      { attempts: 3, sleep: async () => {}, random: () => 0 },
    );
    assert.equal(result, "recovered");
    assert.equal(calls, 2);
  });
});
