import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Open an append stream for a log file, rotating first when the file exceeds
 * maxBytes: the current file moves to `<file>.1` (replacing any previous
 * archive). Every live-feed/launch log opens its stream through this at run
 * start, so no log grows unbounded across weeks of daily sessions.
 */
export async function openRotatingLogStream(target: string, maxBytes: number = DEFAULT_LOG_MAX_BYTES): Promise<fs.WriteStream> {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  try {
    const stats = await fsp.stat(target);
    if (stats.size > maxBytes) {
      await fsp.rm(`${target}.1`, { force: true });
      await fsp.rename(target, `${target}.1`);
    }
  } catch {
    // Missing log file (or a concurrent rotation already moved it) — nothing
    // to rotate.
  }
  return fs.createWriteStream(target, { flags: "a" });
}
