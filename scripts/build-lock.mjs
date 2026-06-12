import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export function defaultBuildLockPath(cwd = process.cwd(), env = process.env) {
  if (env.RUBICON_BUILD_LOCK_PATH) {
    return path.resolve(env.RUBICON_BUILD_LOCK_PATH);
  }
  if (env.AI_STUFF_ROOT) {
    return path.join(path.resolve(env.AI_STUFF_ROOT), ".rubicon-build.lock.json");
  }
  const resolved = path.resolve(cwd);
  const parent = path.dirname(resolved);
  const sharedRoot = path.basename(parent).toLowerCase() === "rubicon-worktrees" ? path.dirname(parent) : parent;
  return path.join(sharedRoot, ".rubicon-build.lock.json");
}

export function npmCommandForPlatform(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function createBuildLockPayload({ command, args = [], cwd = process.cwd(), pid = process.pid, startedAt = new Date().toISOString() }) {
  return {
    pid,
    cwd: path.resolve(cwd),
    command,
    args,
    startedAt,
  };
}

async function readLock(lockPath) {
  try {
    return JSON.parse(await fs.readFile(lockPath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function acquireBuildLock({
  lockPath = defaultBuildLockPath(),
  command,
  args = [],
  cwd = process.cwd(),
  pid = process.pid,
  pidIsAlive = isPidAlive,
  startedAt = new Date().toISOString(),
} = {}) {
  const existing = await readLock(lockPath);
  if (existing?.pid && pidIsAlive(Number(existing.pid))) {
    return {
      acquired: false,
      reason: `Rubicon build already running in ${existing.cwd ?? "unknown cwd"} (pid ${existing.pid}, started ${existing.startedAt ?? "unknown"}).`,
      lock: existing,
    };
  }
  if (existing) {
    await fs.rm(lockPath, { force: true });
  }
  const payload = createBuildLockPayload({ command, args, cwd, pid, startedAt });
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  try {
    await fs.writeFile(lockPath, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
    return { acquired: true, lock: payload };
  } catch (error) {
    if (error && error.code === "EEXIST") {
      const current = await readLock(lockPath);
      return {
        acquired: false,
        reason: `Rubicon build lock was taken by ${current?.cwd ?? "another process"} (pid ${current?.pid ?? "unknown"}).`,
        lock: current,
      };
    }
    throw error;
  }
}

export async function releaseBuildLock(lockPath = defaultBuildLockPath(), pid = process.pid) {
  const existing = await readLock(lockPath);
  if (!existing || Number(existing.pid) !== pid) {
    return false;
  }
  await fs.rm(lockPath, { force: true });
  return true;
}

export function runCommand(command, args, { cwd = process.cwd(), env = process.env, stdio = "inherit" } = {}) {
  const actualCommand = command === "npm" ? npmCommandForPlatform() : command;
  return new Promise((resolve, reject) => {
    const child = spawn(actualCommand, args, {
      cwd,
      env,
      shell: false,
      stdio,
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${[command, ...args].join(" ")} exited with ${code ?? signal}`));
    });
  });
}

export async function runWithBuildLock(commandArgs, { cwd = process.cwd(), env = process.env, lockPath = defaultBuildLockPath(cwd, env) } = {}) {
  const [command = "npm", ...args] = commandArgs.length ? commandArgs : ["npm", "run", "build:raw"];
  const lock = await acquireBuildLock({ lockPath, command, args, cwd });
  if (!lock.acquired) {
    throw new Error(lock.reason);
  }
  try {
    await runCommand(command, args, { cwd, env });
  } finally {
    await releaseBuildLock(lockPath);
  }
}
