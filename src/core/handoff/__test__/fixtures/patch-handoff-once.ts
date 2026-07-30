import { patchHandoff } from "../../handoff.store.ts";

const [, , root, provider, patchJson] = process.argv;
if (!root || !provider || !patchJson) {
  console.error("usage: patch-handoff-once.ts <root> <provider> <patchJson>");
  process.exit(1);
}

await patchHandoff(root, provider, JSON.parse(patchJson));
