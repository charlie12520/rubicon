import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function mtimeMs(target: string | null): Promise<number | null> {
  if (!target) {
    return null;
  }
  try {
    return (await fs.stat(target)).mtimeMs;
  } catch {
    return null;
  }
}

export async function readJson<T>(target: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(target, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function firstExistingPath(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  // On Windows, renaming onto a target that is mid-replace by another writer
  // (or briefly held by antivirus/indexing) fails with a transient
  // EPERM/EACCES/EBUSY. Retry with a short backoff before giving up.
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5 + attempt * 10));
    }
  }
  throw lastError;
}

export async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Unique temp name per write: concurrent writers to the same target (server
  // routes + schedulers + sidecars all share data/*.json) must not share a
  // temp file, or one writer's rename consumes the other's payload and the
  // loser throws ENOENT.
  const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await renameWithRetry(temp, target);
  } finally {
    // No-op after a successful rename; cleans up the orphan when the write or
    // rename failed so data/ doesn't accumulate temp files.
    await fs.rm(temp, { force: true });
  }
}
