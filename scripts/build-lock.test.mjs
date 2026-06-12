import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acquireBuildLock, defaultBuildLockPath, releaseBuildLock, spawnSpecForCommand } from "./build-lock.mjs";

describe("Rubicon build lock", () => {
  it("uses a shared AI STUFF lock for the live checkout and sibling worktrees", () => {
    const aiStuff = path.join("C:", "Users", "charl", "Desktop", "AI STUFF");
    expect(defaultBuildLockPath(path.join(aiStuff, "spx-spread-replay-tracker"), {})).toBe(path.join(aiStuff, ".rubicon-build.lock.json"));
    expect(defaultBuildLockPath(path.join(aiStuff, "rubicon-worktrees", "agent-A196"), {})).toBe(path.join(aiStuff, ".rubicon-build.lock.json"));
  });

  it("blocks a second active build", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "rubicon-build-lock-"));
    const lockPath = path.join(dir, "lock.json");
    await writeFile(lockPath, JSON.stringify({ pid: 123, cwd: "first", startedAt: "2026-06-12T12:00:00.000Z" }), "utf8");

    const result = await acquireBuildLock({
      lockPath,
      command: "npm",
      args: ["run", "build:raw"],
      pidIsAlive: (pid) => pid === 123,
    });

    expect(result.acquired).toBe(false);
    expect(result.reason).toContain("already running");
    await rm(dir, { recursive: true, force: true });
  });

  it("clears a stale dead-pid lock before acquiring", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "rubicon-build-lock-"));
    const lockPath = path.join(dir, "lock.json");
    await writeFile(lockPath, JSON.stringify({ pid: 456, cwd: "old", startedAt: "2026-06-12T12:00:00.000Z" }), "utf8");

    const result = await acquireBuildLock({
      lockPath,
      command: "npm",
      args: ["run", "build:raw"],
      cwd: "new",
      pid: 789,
      pidIsAlive: () => false,
      startedAt: "2026-06-12T13:00:00.000Z",
    });

    expect(result.acquired).toBe(true);
    const next = JSON.parse(await readFile(lockPath, "utf8"));
    expect(next).toMatchObject({ pid: 789, command: "npm", args: ["run", "build:raw"] });
    expect(await releaseBuildLock(lockPath, 789)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it("spawns npm through node on Windows when npm exposes its cli path", () => {
    expect(
      spawnSpecForCommand("npm", ["run", "build:raw"], {
        platform: "win32",
        env: { npm_execpath: "C:\\node\\node_modules\\npm\\bin\\npm-cli.js" },
        execPath: "C:\\node\\node.exe",
      }),
    ).toEqual({
      command: "C:\\node\\node.exe",
      args: ["C:\\node\\node_modules\\npm\\bin\\npm-cli.js", "run", "build:raw"],
      shell: false,
    });
  });
});
