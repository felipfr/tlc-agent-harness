import { register } from "../../presence.service.ts";

const [, , root, provider, session, branch] = process.argv;
if (!root || !provider || !session || !branch) {
  console.error("usage: register-presence-branch.ts <root> <provider> <session> <branch>");
  process.exit(1);
}

register(root, { provider, session, pid: process.pid, branch });
