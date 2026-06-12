#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { branchNameForAgent, defaultWorktreeRoot, worktreePathForBranch } from "./worktree-tools.mjs";

function usage() {
  console.error("Usage: npm run worktree:create -- --id A196 --slug short-name [--from origin/main]");
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

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).replace(/[\r\n]+$/, "");
}

const args = process.argv.slice(2);
const id = takeArg(args, "--id");
const slug = takeArg(args, "--slug");
const fromRef = takeArg(args, "--from") ?? "origin/main";
const customRoot = takeArg(args, "--root");
if (!id || !slug) {
  usage();
}

const repoRoot = git(["rev-parse", "--show-toplevel"]);
const worktreeRoot = customRoot ? path.resolve(customRoot) : defaultWorktreeRoot(repoRoot);
const branch = branchNameForAgent(id, slug);
const worktreePath = worktreePathForBranch(worktreeRoot, branch);
if (fs.existsSync(worktreePath)) {
  throw new Error(`Worktree path already exists: ${worktreePath}`);
}

fs.mkdirSync(worktreeRoot, { recursive: true });
if (fromRef === "origin/main") {
  execFileSync("git", ["fetch", "origin", "main", "--quiet"], { stdio: "inherit" });
}
execFileSync("git", ["worktree", "add", worktreePath, "-b", branch, fromRef], { stdio: "inherit" });
console.log(`Worktree ready: ${worktreePath}`);
console.log(`Branch: ${branch}`);
