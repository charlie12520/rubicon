import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyMirrorEnvDefaults } from "./mirror-env.mjs";
import { ensureRubiconIcon } from "./rubicon-icon.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
applyMirrorEnvDefaults();
ensureRubiconIcon(path.join(appRoot, "public", "favicon.ico"));
const defaultGoogleServiceAccountPath = path.resolve(appRoot, "..", ".secrets", "spx-replay-google-service-account.json");
if (!process.env.GOOGLE_SERVICE_ACCOUNT_PATH && fs.existsSync(defaultGoogleServiceAccountPath)) {
  process.env.GOOGLE_SERVICE_ACCOUNT_PATH = defaultGoogleServiceAccountPath;
}
const configuredAppUrl = process.env.RUBICON_APP_URL ?? process.env.SPX_REPLAY_APP_URL;
const reuseReadyServer = process.env.RUBICON_REUSE_READY_SERVER === "1";
const skipDesktopBuild = process.env.RUBICON_SKIP_DESKTOP_BUILD === "1";
const desktopMaxOldSpaceMb = process.env.RUBICON_DESKTOP_MAX_OLD_SPACE_MB || "16384";
const defaultPorts = [5174, 5184, 5187, 5194, 5196, 5198];
const appUrlCandidates = configuredAppUrl ? [configuredAppUrl] : appUrlCandidatesForPorts(defaultPorts);
const logPath = path.join(appRoot, "data", "desktop-launcher.log");

function log(message) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
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

function healthUrlFor(appUrl) {
  return `${appUrl}/api/health`;
}

function portForAppUrl(appUrl) {
  return Number(new URL(appUrl).port);
}

function appUrlCandidatesForPorts(ports) {
  return ports.flatMap((port) => [
    `http://[::1]:${port}`,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);
}

async function readRubiconHealth(appUrl) {
  try {
    const response = await fetch(healthUrlFor(appUrl), { cache: "no-store" });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      return null;
    }
    const payload = await response.json();
    return payload?.ok === true && payload.app === "rubicon" ? payload : null;
  } catch {
    return null;
  }
}

async function isServerReady(appUrl) {
  return Boolean(await readRubiconHealth(appUrl));
}

async function findReadyServer(candidates = appUrlCandidates) {
  for (const appUrl of candidates) {
    if (await isServerReady(appUrl)) {
      return appUrl;
    }
  }
  return null;
}

async function findReadyServers(candidates = appUrlCandidates) {
  const readyServers = [];
  const seenPorts = new Set();
  for (const appUrl of candidates) {
    const port = portForAppUrl(appUrl);
    if (!Number.isFinite(port) || seenPorts.has(port)) {
      continue;
    }
    const health = await readRubiconHealth(appUrl);
    if (health) {
      readyServers.push({ appUrl, health, port });
      seenPorts.add(port);
    }
  }
  return readyServers;
}

async function waitForServer() {
  const candidates = appUrlCandidatesForPorts(defaultPorts);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const readyUrl = await findReadyServer(candidates);
    if (readyUrl) {
      return readyUrl;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Rubicon did not start at ${candidates.map(healthUrlFor).join(", ")}`);
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
  if (skipDesktopBuild) {
    return;
  }
  const distIndexPath = path.join(appRoot, "dist", "index.html");
  const inputPaths = ["index.html", "package.json", "package-lock.json", "public", "server", "shared", "src"].map((entry) =>
    path.join(appRoot, entry),
  );
  const newestInput = Math.max(...inputPaths.map(latestMtimeMs));
  const distMtime = latestMtimeMs(distIndexPath);
  if (distMtime && distMtime + 1_000 >= newestInput) {
    return;
  }
  log(distMtime ? "Production build is stale; running npm run build." : "Production build missing; running npm run build.");
  await run(npmCommand(), ["run", "build"]);
}

async function stopServerOnPort(port) {
  if (!Number.isFinite(port)) {
    return;
  }
  if (process.platform !== "win32") {
    log(`Existing Rubicon server on port ${port} was not stopped automatically on this platform.`);
    return;
  }
  const command = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$owners = @(Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -ExpandProperty OwningProcess -Unique)`,
    "if ($owners.Count -eq 1 -and $owners[0] -and $owners[0] -ne $PID) { Stop-Process -Id $owners[0] -Force }",
  ].join("; ");
  await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]);
}

async function stopServerByPid(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) {
    return false;
  }
  if (process.platform === "win32") {
    await run("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Stop-Process -Id ${numericPid} -Force -ErrorAction SilentlyContinue`,
    ]);
    return true;
  }
  try {
    process.kill(numericPid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

async function stopDetachedRubiconServerProcesses() {
  if (process.platform !== "win32") {
    return;
  }
  const escapedAppRoot = appRoot.replace(/'/g, "''");
  const command = [
    `$root = '${escapedAppRoot}'`,
    "$servers = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like \"*$root*\" -and $_.CommandLine -like \"*server/index.ts*\" -and $_.CommandLine -notlike \"*watch server/index.ts*\" })",
    "foreach ($server in $servers) { if ($server.ProcessId -and $server.ProcessId -ne $PID) { Stop-Process -Id $server.ProcessId -Force -ErrorAction SilentlyContinue } }",
  ].join("; ");
  await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]);
  log("Stopped detached Rubicon server/index.ts processes before launch.");
}

async function restartReadyServers() {
  if (reuseReadyServer) {
    return;
  }
  const servers = await findReadyServers();
  for (const server of servers) {
    log(`Restarting existing Rubicon server on ${server.appUrl} (pid ${server.health.pid ?? "unknown"}).`);
    if (!(await stopServerByPid(server.health.pid))) {
      await stopServerOnPort(server.port);
    }
  }
  await stopDetachedRubiconServerProcesses();
  if (servers.length) {
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

function isPortAvailableOnHost(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (error?.code === "EADDRNOTAVAIL") {
        resolve(true);
        return;
      }
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function isPortAvailable(port) {
  const hosts = process.platform === "win32" ? ["127.0.0.1", "::1"] : ["127.0.0.1"];
  const results = await Promise.all(hosts.map((host) => isPortAvailableOnHost(port, host)));
  return results.every(Boolean);
}

async function chooseServerPort() {
  if (configuredAppUrl) {
    const parsed = new URL(configuredAppUrl);
    const configuredPort = Number(parsed.port);
    if (Number.isFinite(configuredPort) && configuredPort > 0 && await isPortAvailable(configuredPort)) {
      return configuredPort;
    }
  }

  for (const port of defaultPorts) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No free Rubicon app port found in ${defaultPorts.join(", ")}.`);
}

function startServer(port) {
  const tsxCliPath = path.join(appRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const outLogPath = path.join(appRoot, "data", "desktop-server.out.log");
  const errLogPath = path.join(appRoot, "data", "desktop-server.err.log");
  const nodeOptions = [process.env.NODE_OPTIONS, `--max-old-space-size=${desktopMaxOldSpaceMb}`].filter(Boolean).join(" ");
  const outLog = fs.openSync(outLogPath, "a");
  const errLog = fs.openSync(errLogPath, "a");
  const child = spawn(process.execPath, [`--max-old-space-size=${desktopMaxOldSpaceMb}`, tsxCliPath, "server/index.ts"], {
    cwd: appRoot,
    detached: true,
    env: { ...process.env, NODE_OPTIONS: nodeOptions, PORT: String(port) },
    shell: false,
    stdio: ["ignore", outLog, errLog],
    windowsHide: true,
  });
  log(`Spawned Rubicon server process ${child.pid ?? "unknown"} on port ${port}.`);
  child.unref();
}

function browserCandidates() {
  if (process.platform !== "win32") {
    return [];
  }

  return [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
}

function isBrowserCommandAvailable(command) {
  if (process.platform !== "win32") {
    return false;
  }
  try {
    const result = spawnSync("where.exe", [command], { encoding: "utf8", windowsHide: true });
    return result.status === 0 && Boolean((result.stdout ?? "").trim());
  } catch {
    return false;
  }
}

function resolveBrowserPath() {
  const directCandidate = browserCandidates().find((candidate) => fs.existsSync(candidate));
  if (directCandidate) {
    return directCandidate;
  }
  const pathCandidates = ["msedge", "chrome", "msedge.exe", "chrome.exe"];
  return pathCandidates.find((command) => isBrowserCommandAvailable(command)) ?? null;
}

function openAppWindow(appUrl) {
  const browserPath = resolveBrowserPath();
  if (!browserPath) {
    throw new Error("Could not find Microsoft Edge or Google Chrome for Rubicon app-mode launch.");
  }

  const profileDir = path.join(os.homedir(), "AppData", "Local", "Rubicon App");
  fs.mkdirSync(profileDir, { recursive: true });
  spawn(
    browserPath,
    [
      `--app=${appUrl}`,
      "--window-size=1500,980",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--disable-features=Translate",
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  ).unref();
}

try {
  await ensureBuildIsFresh();
  await restartReadyServers();
  let appUrl = reuseReadyServer ? await findReadyServer() : null;
  if (!appUrl) {
    const port = await chooseServerPort();
    log(`Starting local Rubicon app server on port ${port}.`);
    startServer(port);
    appUrl = await waitForServer();
  }
  openAppWindow(appUrl);
  log(`Opened desktop app window at ${appUrl}.`);
} catch (error) {
  log(error instanceof Error ? error.stack ?? error.message : String(error));
  throw error;
}
