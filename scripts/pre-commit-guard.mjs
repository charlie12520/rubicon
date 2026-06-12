#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { runGitSafetyChecks } from "./git-safety-core.mjs";

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).replace(/[\r\n]+$/, "");
}

function optionalGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

const branch = git(["branch", "--show-current"]);
const nameStatusText = git(["diff", "--cached", "--name-status", "-M"]);
const stagedAcceptanceContent = optionalGit(["show", ":naive_acceptance.md"]);
const headAcceptanceContent = optionalGit(["show", "HEAD:naive_acceptance.md"]);
const problems = runGitSafetyChecks({
  branch,
  nameStatusText,
  stagedAcceptanceContent,
  headAcceptanceContent,
  env: process.env,
});

if (problems.length) {
  console.error(["Rubicon git safety guard failed:", ...problems.map((problem) => `- ${problem}`)].join("\n"));
  process.exit(1);
}
