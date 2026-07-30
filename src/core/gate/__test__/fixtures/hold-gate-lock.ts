import { appendFileSync } from "node:fs";
import { withGateLock } from "../../gate.lock.ts";

const [, , root, provider, session, holdMs, logPath] = process.argv;
if (!root || !provider || !session || !holdMs || !logPath) {
  console.error("usage: hold-gate-lock.ts <root> <provider> <session> <holdMs> <logPath>");
  process.exit(1);
}

await withGateLock(
  root,
  provider,
  session,
  async () => {
    appendFileSync(logPath, `${provider} start ${Date.now()}\n`);
    await new Promise((resolve) => setTimeout(resolve, Number(holdMs)));
    appendFileSync(logPath, `${provider} end ${Date.now()}\n`);
  },
  { waitMs: 5000, staleMs: 60_000 },
);
