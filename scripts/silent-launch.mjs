// Silent Rubicon launcher — guarantees env-var flags reach launch-desktop.mjs
// and forces ALL detached spawns to stdio:'ignore' so Windows 11 doesn't
// allocate a visible console window for the Express server child.
//
// Trade-off: server stdout/stderr no longer write to data/desktop-server.*.log.
// To restore log capture, launch via launch-desktop.mjs directly (e.g. via
// `node scripts/launch-desktop.mjs` in a real terminal) instead of this wrapper.

import child_process from "node:child_process";

const originalSpawn = child_process.spawn;
child_process.spawn = function silentSpawn(command, args, options) {
  if (options && typeof options === "object") {
    const patched = { ...options, windowsHide: true };
    // Detached spawns with file-handle stdio cause Windows 11 to allocate a
    // visible console regardless of windowsHide. Force 'ignore' to suppress.
    if (patched.detached) {
      patched.stdio = "ignore";
    }
    return originalSpawn(command, args, patched);
  }
  return originalSpawn(command, args, options);
};

process.env.RUBICON_SKIP_DESKTOP_BUILD = process.env.RUBICON_SKIP_DESKTOP_BUILD ?? "1";
process.env.RUBICON_REUSE_READY_SERVER = process.env.RUBICON_REUSE_READY_SERVER ?? "1";

await import("./launch-desktop.mjs");
