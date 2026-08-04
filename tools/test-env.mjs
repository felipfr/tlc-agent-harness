/**
 * Loaded with `node --import` before every test file, so the suite answers from its own fixtures instead of
 * from the shell that happened to start it.
 *
 * hazard: `projectDirFor` prefers `CLAUDE_PROJECT_DIR` over the payload's `cwd`, which is correct in
 * production — the env var is the project root and `cwd` can be a subdirectory. Inside a Claude Code hook that
 * variable is always set, so 22 tests that build a fixture in a temp directory silently read policy and state
 * from the real repository instead. The suite passed from a shell and failed from inside a hook.
 */
import { PROJECT_SCOPED_ENV } from "./test-env.names.mjs";

for (const name of PROJECT_SCOPED_ENV) {
  delete process.env[name];
}
