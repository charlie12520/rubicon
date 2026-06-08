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

  it("launches calendar alerts through the native Windows toast (long duration, no wscript popup)", async () => {
    vi.resetModules();
    const spawn = vi.fn();
    const spawnSync = vi.fn((_command: string, _args: string[], _options: unknown) => ({
      status: 0,
      stderr: "",
      stdout: "Rubicon.RubiconApp\r\n",
    }));
    vi.doMock("node:child_process", () => ({ spawn, spawnSync }));

    const { showCalendarDesktopAlert } = await import("./desktopAlert.ts");
    const result = showCalendarDesktopAlert({ body: "CPI in one minute" }, "C:\\rubicon");

    expect(spawn).not.toHaveBeenCalled(); // no more centered wscript Popup dialog
    const spawnArgs = spawnSync.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];

    expect(spawnArgs[0]).toBe("powershell.exe");
    expect(spawnArgs[1]).toContain("C:\\rubicon\\scripts\\show-windows-toast.ps1");
    expect(spawnArgs[1]).toContain("Calendar event starts in 1 minute");
    expect(spawnArgs[1]).toContain("CPI in one minute");
    expect(spawnArgs[1]).toContain("long"); // a 1-minute pre-event warning lingers
    expect(spawnArgs[2]).toEqual(expect.objectContaining({ windowsHide: true }));
    expect(result.ok).toBe(true);
  });

  it("launches live-update alerts through a native Windows toast helper", async () => {
    vi.resetModules();
    const spawn = vi.fn();
    const spawnSync = vi.fn((_command: string, _args: string[], _options: unknown) => ({
      status: 0,
      stderr: "",
      stdout: "127.0.0.1-9BBB1E10_tz517vvf8m8yt!App\r\n",
    }));
    vi.doMock("node:child_process", () => ({ spawn, spawnSync }));

    const { showLiveUpdateDesktopToast } = await import("./desktopAlert.ts");
    showLiveUpdateDesktopToast(
      {
        body: "Fed speaker comments on tariff risks",
        detail: "Matched fed - 8:00 AM",
        title: "FirstSquawk word-filter alert",
      },
      "C:\\rubicon",
    );

    const spawnArgs = spawnSync.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];

    expect(spawnArgs[0]).toBe("powershell.exe");
    expect(spawnArgs[1]).toContain("-File");
    expect(spawnArgs[1]).toContain("C:\\rubicon\\scripts\\show-windows-toast.ps1");
    expect(spawnArgs[1]).toContain("-AppId");
    expect(spawnArgs[1]).toContain("auto");
    expect(spawnArgs[1]).toContain("FirstSquawk word-filter alert");
    expect(spawnArgs[1]).toContain("Fed speaker comments on tariff risks");
    expect(spawnArgs[1]).toContain("short");
    expect(spawnArgs[2]).toEqual(expect.objectContaining({ windowsHide: true }));
  });
});
