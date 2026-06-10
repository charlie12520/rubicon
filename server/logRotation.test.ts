import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openRotatingLogStream } from "./logRotation.ts";

let tempDir = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-logrotate-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function writeAndClose(stream: import("node:fs").WriteStream, text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(text, (error) => (error ? reject(error) : resolve()));
  });
  await new Promise<void>((resolve) => stream.end(resolve));
}

describe("openRotatingLogStream", () => {
  it("appends to a fresh file and creates parent directories", async () => {
    const target = path.join(tempDir, "nested", "feed.log");
    const stream = await openRotatingLogStream(target);
    await writeAndClose(stream, "line one\n");
    expect(await fs.readFile(target, "utf8")).toBe("line one\n");
  });

  it("keeps appending below the size cap", async () => {
    const target = path.join(tempDir, "feed.log");
    await fs.writeFile(target, "existing\n", "utf8");
    const stream = await openRotatingLogStream(target, 1024);
    await writeAndClose(stream, "appended\n");
    expect(await fs.readFile(target, "utf8")).toBe("existing\nappended\n");
  });

  it("rotates an oversized log to .1 and starts fresh", async () => {
    const target = path.join(tempDir, "feed.log");
    await fs.writeFile(target, "x".repeat(64), "utf8");
    const stream = await openRotatingLogStream(target, 16);
    await writeAndClose(stream, "new session\n");

    expect(await fs.readFile(target, "utf8")).toBe("new session\n");
    expect(await fs.readFile(`${target}.1`, "utf8")).toBe("x".repeat(64));
  });

  it("replaces a previous .1 archive on the next rotation", async () => {
    const target = path.join(tempDir, "feed.log");
    await fs.writeFile(`${target}.1`, "ancient\n", "utf8");
    await fs.writeFile(target, "y".repeat(64), "utf8");
    const stream = await openRotatingLogStream(target, 16);
    await writeAndClose(stream, "fresh\n");

    expect(await fs.readFile(`${target}.1`, "utf8")).toBe("y".repeat(64));
    expect(await fs.readFile(target, "utf8")).toBe("fresh\n");
  });
});
