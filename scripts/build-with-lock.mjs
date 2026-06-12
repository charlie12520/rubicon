#!/usr/bin/env node
import { runWithBuildLock } from "./build-lock.mjs";

const separator = process.argv.indexOf("--");
const commandArgs = separator >= 0 ? process.argv.slice(separator + 1) : process.argv.slice(2);

try {
  await runWithBuildLock(commandArgs);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
