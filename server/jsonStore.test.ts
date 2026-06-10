import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readJson, writeJsonAtomic } from "./jsonStore.ts";

let tempDir = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-jsonstore-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("writeJsonAtomic", () => {
  it("round-trips a payload and creates parent directories", async () => {
    const target = path.join(tempDir, "nested", "deeper", "state.json");
    await writeJsonAtomic(target, { ok: true, count: 3 });
    expect(await readJson(target, null)).toEqual({ ok: true, count: 3 });
  });

  it("survives concurrent writes to the same target without losing the file", async () => {
    const target = path.join(tempDir, "contended.json");
    const writers = Array.from({ length: 25 }, (_, index) => writeJsonAtomic(target, { writer: index }));

    // With a shared `${target}.tmp` this rejects (one rename consumes the
    // other writer's temp file → ENOENT) — every write must resolve.
    await expect(Promise.all(writers)).resolves.toBeDefined();

    const final = await readJson<{ writer: number } | null>(target, null);
    expect(final).not.toBeNull();
    expect(final!.writer).toBeGreaterThanOrEqual(0);
    expect(final!.writer).toBeLessThan(25);
  });

  it("leaves no temp files behind", async () => {
    const target = path.join(tempDir, "clean.json");
    await Promise.all(Array.from({ length: 10 }, (_, index) => writeJsonAtomic(target, { index })));
    const leftovers = (await fs.readdir(tempDir)).filter((name) => name.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });
});
