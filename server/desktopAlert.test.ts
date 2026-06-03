import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeDesktopAlertText } from "./desktopAlert.ts";

describe("desktop alert helpers", () => {
  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.restoreAllMocks();
  });

  it("normalizes control characters and whitespace before sending text to PowerShell", () => {
    expect(sanitizeDesktopAlertText("  Event\u0000\n\nstarts\tsoon  ", 80)).toBe("Event starts soon");
  });

  it("caps alert text length", () => {
    expect(sanitizeDesktopAlertText("abcdef", 3)).toBe("abc");
  });

  it("logs async PowerShell spawn errors before detaching the alert process", async () => {
    vi.resetModules();
    let errorHandler: ((error: Error) => void) | undefined;
    const unref = vi.fn();
    const child = {
      on: vi.fn((event: string, handler: (error: Error) => void) => {
        if (event === "error") {
          errorHandler = handler;
        }
        return child;
      }),
      pid: 12345,
      unref,
    };
    const spawn = vi.fn((_command: string, _args: string[], _options: unknown) => child);
    vi.doMock("node:child_process", () => ({ spawn }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { showCalendarDesktopAlert } = await import("./desktopAlert.ts");
    showCalendarDesktopAlert({ body: "CPI in one minute" }, "C:\\rubicon");

    expect(child.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(errorHandler).toBeDefined();
    errorHandler?.(new Error("powershell missing"));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("powershell missing"));
    expect(unref).toHaveBeenCalledOnce();
  });

  it("launches calendar alerts through a visible Windows Script Host popup", async () => {
    vi.resetModules();
    const on = vi.fn().mockReturnThis();
    const unref = vi.fn();
    const spawn = vi.fn((_command: string, _args: string[], _options: unknown) => ({ on, pid: 12345, unref }));
    vi.doMock("node:child_process", () => ({ spawn }));

    const { showCalendarDesktopAlert } = await import("./desktopAlert.ts");
    showCalendarDesktopAlert({ body: "CPI in one minute" }, "C:\\rubicon");

    const spawnArgs = spawn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];

    expect(spawnArgs[0]).toBe("wscript.exe");
    expect(spawnArgs[1]).toContain("C:\\rubicon\\scripts\\show-calendar-alert.vbs");
    expect(spawnArgs[1]).toContain("Calendar event starts in 1 minute");
    expect(spawnArgs[1]).toContain("CPI in one minute");
    expect(spawnArgs[2]).toEqual(expect.objectContaining({ windowsHide: false }));
  });
});
