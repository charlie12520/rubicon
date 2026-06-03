import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Rubicon Windows icon generation", () => {
  it("creates a multi-size ICO file for Windows shortcuts", async () => {
    const { createRubiconIco, ensureRubiconIcon } = await import("./rubicon-icon.mjs");
    const icon = createRubiconIco([16, 32]);

    expect(icon.readUInt16LE(0)).toBe(0);
    expect(icon.readUInt16LE(2)).toBe(1);
    expect(icon.readUInt16LE(4)).toBe(2);
    expect(icon.readUInt8(6)).toBe(16);
    expect(icon.readUInt8(22)).toBe(32);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubicon-icon-"));
    const iconPath = path.join(tempDir, "Rubicon.ico");
    ensureRubiconIcon(iconPath, [16]);

    expect(fs.existsSync(iconPath)).toBe(true);
    expect(fs.readFileSync(iconPath).readUInt16LE(2)).toBe(1);
  });

  it("creates PNG icons for PWA installation metadata", async () => {
    const { createRubiconPng, ensureRubiconPng } = await import("./rubicon-icon.mjs");
    const png = createRubiconPng(192);

    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.includes(Buffer.from("IHDR", "ascii"))).toBe(true);
    expect(png.includes(Buffer.from("IDAT", "ascii"))).toBe(true);
    expect(png.includes(Buffer.from("IEND", "ascii"))).toBe(true);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubicon-png-"));
    const iconPath = path.join(tempDir, "rubicon-192.png");
    ensureRubiconPng(iconPath, 192);

    expect(fs.existsSync(iconPath)).toBe(true);
    expect([...fs.readFileSync(iconPath).subarray(0, 8)]).toEqual([...png.subarray(0, 8)]);
  });

  it("keeps shortcut icons on Rubicon assets instead of browser executables", () => {
    const installerSource = fs.readFileSync(path.resolve("scripts", "install-desktop-shortcut.mjs"), "utf8");

    expect(installerSource).toContain("public\", \"favicon.ico");
    expect(installerSource).toContain("ensureRubiconPng");
    expect(installerSource).not.toContain("Microsoft\\\\Edge\\\\Application\\\\msedge.exe");
    expect(installerSource).not.toContain("Google\\\\Chrome\\\\Application\\\\chrome.exe");
  });

  it("uses a windowless launcher for desktop shortcuts", () => {
    const installerSource = fs.readFileSync(path.resolve("scripts", "install-desktop-shortcut.mjs"), "utf8");
    const wrapperSource = fs.readFileSync(path.resolve("scripts", "launch-desktop.vbs"), "utf8");

    expect(installerSource).toContain('path.join(scriptDir, "launch-desktop.vbs")');
    expect(installerSource).toContain('$shortcut.TargetPath = "wscript.exe"');
    expect(installerSource).toContain('const shortcutArguments = `//B "${launcherPath}"`;');
    expect(installerSource).not.toContain('$shortcut.TargetPath = "powershell.exe"');
    expect(wrapperSource).toContain("silent-launch.mjs");
    expect(wrapperSource).toContain("Win32_ProcessStartup");
    expect(wrapperSource).toContain("startup.ShowWindow = 0");
    expect(wrapperSource).toContain("shell.Run nodeCmd, 0, False");
  });

  it("sets a stable AppUserModelID for the Rubicon desktop shortcut", () => {
    const installerSource = fs.readFileSync(path.resolve("scripts", "install-desktop-shortcut.mjs"), "utf8");

    expect(installerSource).toContain("const appUserModelId = \"Rubicon.RubiconApp\";");
    expect(installerSource).toContain("$appUserModelId =");
    expect(installerSource).toContain("IPropertyStore");
    expect(installerSource).toContain("persistFile.Load(shortcutPath, 2)");
    expect(installerSource).toContain("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
    expect(installerSource).toContain("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    expect(installerSource).toContain("SetAppUserModelId");
  });

  it("publishes an installable Rubicon web app manifest", () => {
    const indexHtml = fs.readFileSync(path.resolve("index.html"), "utf8");
    const manifest = JSON.parse(fs.readFileSync(path.resolve("public", "site.webmanifest"), "utf8"));

    expect(indexHtml).toContain('<link rel="manifest" href="/site.webmanifest" />');
    expect(manifest.name).toBe("Rubicon");
    expect(manifest.short_name).toBe("Rubicon");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/rubicon-192.png", sizes: "192x192", type: "image/png" }),
        expect.objectContaining({ src: "/rubicon-512.png", sizes: "512x512", type: "image/png" }),
      ]),
    );
  });

  it("prefers Edge/Chrome app-mode launch for desktop startup when available", () => {
    const launcherSource = fs.readFileSync(path.resolve("scripts", "launch-desktop.mjs"), "utf8");

    expect(launcherSource).toContain("isBrowserCommandAvailable");
    expect(launcherSource).toContain("resolveBrowserPath");
    expect(launcherSource).toContain("`--app=${appUrl}`");
    expect(launcherSource).toContain("return pathCandidates.find((command) => isBrowserCommandAvailable(command)) ?? null;");
    expect(launcherSource).toContain("Could not find Microsoft Edge or Google Chrome for Rubicon app-mode launch.");
    expect(launcherSource).not.toContain('spawn("cmd", ["/c", "start", "", appUrl]');
  });
});
