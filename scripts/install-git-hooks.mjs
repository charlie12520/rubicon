#!/usr/bin/env node
import { execFileSync } from "node:child_process";

execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "inherit" });
console.log("Rubicon git hooks installed: core.hooksPath=.githooks");
