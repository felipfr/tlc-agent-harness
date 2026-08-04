/**
 * Loaded with `node --import` before every test file, so the suite answers from its own fixtures instead of
 * from the shell that happened to start it.
 *
 * hazard: `projectDirFor` prefers `CLAUDE_PROJECT_DIR` over the payload's `cwd`, which is correct in
 * production — the env var is the project root and `cwd` can be a subdirectory. Inside a Claude Code hook that
 * variable is always set, so 22 tests that build a fixture in a temp directory silently read policy and state
 * from the real repository instead. The suite passed from a shell and failed from inside a hook.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROJECT_SCOPED_ENV } from "./test-env.names.mjs";

for (const name of PROJECT_SCOPED_ENV) {
  delete process.env[name];
}

/**
 * hazard: `TLC_HOME` was left alone on the reasoning that it names which runtime and CI sets it deliberately. That
 * held only while nothing machine-wide lived under it. The global lesson tier does, so a test calling `allLessons`
 * without pinning the home read whichever lessons the developer happened to have promoted — green on a fresh
 * machine, green in CI, red on mine the moment I promoted five ([/decisions/ad-042.md](/decisions/ad-042.md)).
 *
 * invariant: hermetic by default, opt in by assignment. A test that wants a runtime home sets one; a test that
 * forgets gets an empty directory rather than a person's machine.
 */
process.env.TLC_HOME = mkdtempSync(join(tmpdir(), "tlc-test-home-"));
