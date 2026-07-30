import { heartbeat, register } from "../../presence.service.ts";

const [, , root, provider, session, file] = process.argv;
if (!root || !provider || !session || !file) {
  console.error("usage: register-presence-once.ts <root> <provider> <session> <file>");
  process.exit(1);
}

register(root, { provider, session, pid: process.pid, branch: "main" });
heartbeat(root, { provider, session, file });
