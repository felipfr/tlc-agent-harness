import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runtimeHome } from "../platform/paths.ts";

const handler = process.argv[2];
if (!handler) {
  console.error("usage: shim <handler-name>");
  process.exit(1);
}

// hazard: a project-level hook and a user-level hook both fire for the same event. The user-level
// session start sets TLC_ACTIVE, so the project shim stands down rather than double-firing.
if (process.env.TLC_ACTIVE === "1") {
  process.stdout.write("{}\n");
  process.exit(0);
}

const home = runtimeHome();
const execBin = join(home, "bin", "tlc-exec");
const distHandler = join(home, "dist", `${handler}.mjs`);
const srcHandler = join(home, "src", "entrypoints", `${handler}.ts`);

function run(command: string, args: string[]): void {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"], env: process.env });
  process.stdin.pipe(child.stdin);
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.on("close", (code) => {
    process.stdout.write(stdout);
    process.exit(code ?? 0);
  });
}

if (existsSync(execBin)) {
  run(execBin, [handler]);
} else if (existsSync(distHandler)) {
  run(process.execPath, [distHandler]);
} else if (existsSync(srcHandler)) {
  run(process.env.BUN_BIN || "bun", ["run", srcHandler]);
} else {
  console.error(`tlc shim: handler not found: ${handler}`);
  process.exit(127);
}
