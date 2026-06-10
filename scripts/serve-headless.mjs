// Headless server pre-step used by scripts/serve-headless.vbs (the "Rubicon
// Server" logon Scheduled Task). The task serves the built dist/, but nothing
// rebuilt it after source edits — the installed PWA silently showed a stale UI
// until the next `npm run desktop`. This wrapper rebuilds when dist is older
// than the inputs, then starts the real server detached (same lifecycle as the
// old direct `tsx server/index.ts` launch: the server outlives this process).
//
// Failure policy: a broken build must NOT take Rubicon down at logon — log it
// and serve the existing (stale) dist instead.
//
// Deliberately self-contained: importing launch-desktop.mjs would execute the
// whole desktop launcher (it runs at module top level, including a ready-server
// kill sweep).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const logPath = path.join(appRoot, "data", "serve-headless.log");

// Truncate per launch — this log only ever describes the most recent start.
fs.mkdirSync(path.dirname(logPath), { recursive: true });
fs.writeFileSync(logPath, "", "utf8");

function log(message) {
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, "utf8");
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const usesWindowsCmdShim = process.platform === "win32" && command.endsWith(".cmd");
    const child = spawn(usesWindowsCmdShim ? "cmd.exe" : command, usesWindowsCmdShim ? ["/d", "/s", "/c", command, ...args] : args, {
      cwd: appRoot,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
    child.on("error", reject);
  });
}

function latestMtimeMs(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }
  const stats = fs.statSync(targetPath);
  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }
  let latest = stats.mtimeMs;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const entryPath = path.join(targetPath, entry.name);
    latest = Math.max(latest, latestMtimeMs(entryPath));
  }
  return latest;
}

async function ensureBuildIsFresh() {
  if (String(process.env.RUBICON_SKIP_HEADLESS_BUILD ?? "").toLowerCase() === "1") {
    log("RUBICON_SKIP_HEADLESS_BUILD=1; serving existing dist as-is.");
    return;
  }
  const distIndexPath = path.join(appRoot, "dist", "index.html");
  const inputPaths = ["index.html", "package.json", "package-lock.json", "public", "server", "shared", "src"].map((entry) =>
    path.join(appRoot, entry),
  );
  const newestInput = Math.max(...inputPaths.map(latestMtimeMs));
  const distMtime = latestMtimeMs(distIndexPath);
  if (distMtime && distMtime + 1_000 >= newestInput) {
    log("dist is fresh; no rebuild needed.");
    return;
  }
  log(distMtime ? "dist is stale; running npm run build." : "dist is missing; running npm run build.");
  await run(npmCommand(), ["run", "build"]);
  log("Build finished.");
}

function startServerDetached() {
  const tsxCli = path.join(appRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(process.execPath, [tsxCli, "server/index.ts"], {
    cwd: appRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  log(`Server launched detached (pid ${child.pid}). The server's own port probe exits cleanly if 5174 is already owned.`);
}

try {
  await ensureBuildIsFresh();
} catch (error) {
  log(`Build failed; serving existing dist instead. ${error?.message ?? error}`);
}
startServerDetached();
