import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_AUTO_START = process.env.FPL_AUTO_START;
const ORIGINAL_AUTO_START_TIME = process.env.FPL_AUTO_START_TIME;

describe("FPL live runtime scheduler", () => {
  afterEach(() => {
    restoreEnv("FPL_AUTO_START", ORIGINAL_AUTO_START);
    restoreEnv("FPL_AUTO_START_TIME", ORIGINAL_AUTO_START_TIME);
    vi.restoreAllMocks();
  });

  it("unrefs the auto-start interval so it does not keep the backend alive", async () => {
    vi.resetModules();
    process.env.FPL_AUTO_START = "true";
    process.env.FPL_AUTO_START_TIME = "23:59";
    const unref = vi.fn();
    vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref } as unknown as ReturnType<typeof setInterval>);

    const { armFplLiveAutoStart } = await import("./fplLive.ts");
    armFplLiveAutoStart();

    expect(unref).toHaveBeenCalledOnce();
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
