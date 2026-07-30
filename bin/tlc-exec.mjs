#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MIN_NODE_MAJOR = 24;

export function conventionalHarnessHome(home = homedir()) {
  return join(home, ".tlc", "harness");
}

function samePath(left, right, resolve) {
  try {
    return resolve(left) === resolve(right);
  } catch {
    return false;
  }
}

// hazard: ESM resolves import.meta.url to the realpath, and the bash wrappers walk readlink before
// invoking, so both binDir and argv[1] can name the checkout rather than the install path. Anything derived
// from this value is written into hook files and compared by doctor, so the checkout leaking in here made
// generated shims point at a directory that only exists on the machine that ran init.
// invariant: the conventional path wins only when it resolves to the same runtime — verified, never assumed,
// so a deliberately relocated install is left alone.
export function resolveHarnessHome(
  binDir,
  env = process.env,
  invoked = process.argv[1],
  deps = { realpath: realpathSync, home: homedir },
) {
  const fromEnv = env.TLC_HOME?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const candidate = invoked?.endsWith("tlc-exec.mjs") ? join(dirname(invoked), "..") : join(binDir, "..");
  const conventional = conventionalHarnessHome(deps.home());
  if (conventional !== candidate && samePath(conventional, candidate, deps.realpath)) {
    return conventional;
  }
  return candidate;
}

export function bunExecutableName(platform = process.platform) {
  return platform === "win32" ? "bun.exe" : "bun";
}

export function findBunOnPath(env = process.env, platform = process.platform) {
  const pathValue = env.PATH ?? "";
  const bunName = bunExecutableName(platform);
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = join(dir, bunName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function runtimeCachePath(harnessHome) {
  return join(harnessHome, "state", "runtime-cache.json");
}

export function readRuntimeCache(harnessHome) {
  const cachePath = runtimeCachePath(harnessHome);
  if (!existsSync(cachePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8"));
    if (parsed && typeof parsed === "object" && "bunPath" in parsed) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeRuntimeCache(harnessHome, bunPath) {
  const cachePath = runtimeCachePath(harnessHome);
  mkdirSync(dirname(cachePath), { recursive: true });
  const record = { bunPath, checkedAt: new Date().toISOString() };
  writeFileSync(cachePath, `${JSON.stringify(record)}\n`);
  return record;
}

export function resolveBunPath(harnessHome, env = process.env, platform = process.platform) {
  const cached = readRuntimeCache(harnessHome);
  if (cached) {
    return cached.bunPath;
  }
  const found = findBunOnPath(env, platform);
  writeRuntimeCache(harnessHome, found);
  return found;
}

export function entrySourceCandidates(harnessHome, entry) {
  return [
    entry === "tlc-cli" ? join(harnessHome, "bin", "tlc-cli.ts") : null,
    join(harnessHome, "src", "entrypoints", `${entry}.ts`),
    join(harnessHome, "src", `${entry}.ts`),
    join(harnessHome, "tools", `${entry}.ts`),
  ].filter((candidate) => candidate !== null);
}

export function resolveEntrySource(harnessHome, entry) {
  for (const candidate of entrySourceCandidates(harnessHome, entry)) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function decideRuntime({ harnessHome, entry, bunPath, nodeMajor, distExists, srcPath }) {
  const distPath = join(harnessHome, "dist", `${entry}.mjs`);
  if (bunPath && srcPath && distExists) {
    return { kind: "run", command: bunPath, args: ["run", srcPath] };
  }
  if (nodeMajor >= MIN_NODE_MAJOR && distExists) {
    return { kind: "run", command: process.execPath, args: [distPath] };
  }
  if (bunPath && srcPath) {
    return { kind: "run", command: bunPath, args: ["run", srcPath] };
  }
  if (nodeMajor >= MIN_NODE_MAJOR) {
    return {
      kind: "error",
      status: 1,
      message: [
        `tlc: Node ${process.version} found, but dist/${entry}.mjs is missing.`,
        `  Run: ${join(harnessHome, "bin", "tlc-build")}`,
      ].join("\n"),
    };
  }
  if (nodeMajor > 0 && nodeMajor < MIN_NODE_MAJOR) {
    return {
      kind: "error",
      status: 1,
      message: [
        `tlc: no supported hook runtime (Node ${process.version}, Bun not found).`,
        "  Either install Bun:  curl -fsSL https://bun.sh/install | bash",
        `  or Node >= ${MIN_NODE_MAJOR}:     https://nodejs.org/`,
        "  Then reload the editor session. Until then this hook does nothing.",
      ].join("\n"),
    };
  }
  return {
    kind: "error",
    status: 127,
    message: [
      `tlc: need Node.js ${MIN_NODE_MAJOR}+ with dist/, or Bun as optional fallback.`,
      "  Install: https://nodejs.org/ (prefer 24 LTS or 26 Current)",
    ].join("\n"),
  };
}

function run(harnessHome, command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    env: { ...process.env, TLC_HOME: harnessHome },
    shell: false,
  });
  if (result.error) {
    console.error(`tlc: failed to start ${command}: ${result.error.message}`);
    process.exit(127);
  }
  process.exit(result.status ?? 1);
}

export function main(argv = process.argv) {
  const binDir = dirname(fileURLToPath(import.meta.url));
  const harnessHome = resolveHarnessHome(binDir);

  const entry = argv[2];
  if (!entry) {
    console.error("usage: tlc-exec <entry> [args...]");
    console.error("  entry: session-start | tool-before | stop | doctor | ...");
    process.exit(2);
  }
  const args = argv.slice(3);

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  const distExists = existsSync(join(harnessHome, "dist", `${entry}.mjs`));
  const srcPath = resolveEntrySource(harnessHome, entry);
  const bunPath = resolveBunPath(harnessHome);

  const decision = decideRuntime({ harnessHome, entry, bunPath, nodeMajor, distExists, srcPath });
  if (decision.kind === "error") {
    console.error(decision.message);
    process.exit(decision.status);
  }
  run(harnessHome, decision.command, [...decision.args, ...args]);
}

if (import.meta.main) {
  main();
}
