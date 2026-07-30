import { spawn } from "node:child_process";

const TIMEOUT_EXIT_CODE = 124;

export async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function runProcess(args: {
  command: string[];
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const [file, ...argv] = args.command;
  if (file === undefined) {
    return { exitCode: 0, stdout: "", stderr: "" };
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(file, argv, {
      cwd: args.cwd,
      stdio: ["pipe", "pipe", "pipe"] as const,
      env: args.env ?? process.env,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer =
      args.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, args.timeoutMs);

    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        resolve({ exitCode: TIMEOUT_EXIT_CODE, stdout, stderr: `${stderr}\n(process timed out)` });
        return;
      }
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    if (args.input !== undefined) {
      child.stdin.write(args.input);
    }
    child.stdin.end();
  });
}
