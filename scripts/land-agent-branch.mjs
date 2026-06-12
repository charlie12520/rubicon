#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { spawnSpecForCommand } from "./build-lock.mjs";
import { defaultWorktreeRoot, directoryNameForBranch, timestampForPath } from "./worktree-tools.mjs";

function usage() {
  console.error("Usage: npm run land -- --branch agent/A196-short-name [--push] [--keep] [--skip-validate]");
  process.exit(1);
}

function takeArg(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    usage();
  }
  return value;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).replace(/[\r\n]+$/, "");
}

function run(command, args, options = {}) {
  const env = options.env ?? process.env;
  const spawnSpec = spawnSpecForCommand(command, args, { env });
  const result = spawnSync(spawnSpec.command, spawnSpec.args, { stdio: "inherit", shell: spawnSpec.shell, windowsHide: true, ...options, env });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? result.signal}`);
  }
}

const args = process.argv.slice(2);
const branch = takeArg(args, "--branch");
if (!branch) {
  usage();
}
const shouldPush = hasFlag(args, "--push");
const keepWorktree = hasFlag(args, "--keep") || !shouldPush;
const skipValidate = hasFlag(args, "--skip-validate");
const customRoot = takeArg(args, "--root");

const repoRoot = git(["rev-parse", "--show-toplevel"]);
const worktreeRoot = customRoot ? path.resolve(customRoot) : defaultWorktreeRoot(repoRoot);
const landingName = `landing-${directoryNameForBranch(branch)}-${timestampForPath()}`;
const landingPath = path.join(worktreeRoot, landingName);

fs.mkdirSync(worktreeRoot, { recursive: true });
run("git", ["fetch", "origin", "main", "--quiet"]);
run("git", ["worktree", "add", "--detach", landingPath, "origin/main"]);

try {
  run("git", ["merge", "--no-ff", "--no-edit", branch], {
    cwd: landingPath,
    env: { ...process.env, RUBICON_LANDING_OVERRIDE: "1" },
  });
  if (!skipValidate) {
    if (!fs.existsSync(path.join(landingPath, "node_modules"))) {
      run("npm", ["ci"], { cwd: landingPath });
    }
    run("npm", ["run", "validate:mvp"], { cwd: landingPath });
  }
  const mergedHead = git(["rev-parse", "--short", "HEAD"], { cwd: landingPath });
  if (shouldPush) {
    run("git", ["push", "origin", "HEAD:main"], { cwd: landingPath });
    console.log(`Pushed ${mergedHead} to origin/main.`);
  } else {
    console.log(`Validated local merge at ${mergedHead}. Re-run with --push to publish to origin/main.`);
  }
  if (!keepWorktree) {
    run("git", ["worktree", "remove", landingPath], { cwd: repoRoot });
  } else {
    console.log(`Landing worktree kept at ${landingPath}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`Landing worktree kept for inspection: ${landingPath}`);
  process.exit(1);
}
