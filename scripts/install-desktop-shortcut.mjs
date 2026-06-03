import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureRubiconIcon, ensureRubiconPng } from "./rubicon-icon.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const desktopShortcutPath = path.join(os.homedir(), "Desktop", "Rubicon.lnk");
const startMenuShortcutPath = path.join(os.homedir(), "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Rubicon.lnk");
const pinnedShortcutPath = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  "Microsoft",
  "Internet Explorer",
  "Quick Launch",
  "User Pinned",
  "TaskBar",
  "Rubicon.lnk",
);
const launcherPath = path.join(scriptDir, "launch-desktop.vbs");
const iconPath = ensureRubiconIcon(path.join(appRoot, "public", "favicon.ico"));
ensureRubiconPng(path.join(appRoot, "public", "rubicon-192.png"), 192);
ensureRubiconPng(path.join(appRoot, "public", "rubicon-512.png"), 512);
const appUserModelId = "Rubicon.RubiconApp";
const shortcutArguments = `//B "${launcherPath}"`;
const shortcutPaths = [desktopShortcutPath, startMenuShortcutPath];
if (fs.existsSync(pinnedShortcutPath)) {
  shortcutPaths.push(pinnedShortcutPath);
}

const powershell = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace RubiconShortcutProperties
{
    [ComImport]
    [Guid("00021401-0000-0000-C000-000000000046")]
    public class ShellLink
    {
    }

    [ComImport]
    [Guid("0000010b-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPersistFile
    {
        [PreserveSig]
        int GetClassID(out Guid classId);

        [PreserveSig]
        int IsDirty();

        [PreserveSig]
        int Load([MarshalAs(UnmanagedType.LPWStr)] string fileName, uint mode);

        [PreserveSig]
        int Save([MarshalAs(UnmanagedType.LPWStr)] string fileName, bool remember);

        [PreserveSig]
        int SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string fileName);

        [PreserveSig]
        int GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string fileName);
    }

    [ComImport]
    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore
    {
        [PreserveSig]
        int GetCount(out uint propertyCount);

        [PreserveSig]
        int GetAt(uint propertyIndex, out PropertyKey key);

        [PreserveSig]
        int GetValue(ref PropertyKey key, out PropVariant value);

        [PreserveSig]
        int SetValue(ref PropertyKey key, ref PropVariant value);

        [PreserveSig]
        int Commit();
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct PropertyKey
    {
        public Guid FormatId;
        public uint PropertyId;

        public PropertyKey(Guid formatId, uint propertyId)
        {
            FormatId = formatId;
            PropertyId = propertyId;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PropVariant
    {
        public ushort VariantType;
        public ushort Reserved1;
        public ushort Reserved2;
        public ushort Reserved3;
        public IntPtr PointerValue;
    }

    public static class ShortcutIdentity
    {
        private static readonly PropertyKey AppUserModelIdKey =
            new PropertyKey(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5);

        public static void SetAppUserModelId(string shortcutPath, string appUserModelId)
        {
            object shellLink = new ShellLink();
            try
            {
                IPersistFile persistFile = (IPersistFile)shellLink;
                ThrowIfFailed(persistFile.Load(shortcutPath, 2));

                IPropertyStore propertyStore = (IPropertyStore)shellLink;
                PropVariant value = new PropVariant
                {
                    VariantType = 31,
                    PointerValue = Marshal.StringToCoTaskMemUni(appUserModelId)
                };

                try
                {
                    PropertyKey key = AppUserModelIdKey;
                    ThrowIfFailed(propertyStore.SetValue(ref key, ref value));
                    ThrowIfFailed(propertyStore.Commit());
                    ThrowIfFailed(persistFile.Save(shortcutPath, true));
                }
                finally
                {
                    if (value.PointerValue != IntPtr.Zero)
                    {
                        Marshal.FreeCoTaskMem(value.PointerValue);
                    }
                }
            }
            finally
            {
                if (Marshal.IsComObject(shellLink))
                {
                    Marshal.FinalReleaseComObject(shellLink);
                }
            }
        }

        private static void ThrowIfFailed(int hresult)
        {
            if (hresult < 0)
            {
                Marshal.ThrowExceptionForHR(hresult);
            }
        }
    }
}
"@

$shell = New-Object -ComObject WScript.Shell
$shortcutPaths = @(${shortcutPaths.map(psQuote).join(", ")})
$appUserModelId = ${psQuote(appUserModelId)}
foreach ($shortcutPath in $shortcutPaths) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $shortcutPath) -Force | Out-Null
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "wscript.exe"
  $shortcut.Arguments = ${psQuote(shortcutArguments)}
  $shortcut.WorkingDirectory = ${psQuote(appRoot)}
  $shortcut.WindowStyle = 7
  $shortcut.Description = "Open Rubicon as a local desktop app"
  $shortcut.IconLocation = ${psQuote(`${iconPath},0`)}
  $shortcut.Save()
  [RubiconShortcutProperties.ShortcutIdentity]::SetAppUserModelId($shortcutPath, $appUserModelId)
}
`;

const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", powershell], {
  cwd: appRoot,
  encoding: "utf8",
  windowsHide: true,
});

if (result.status !== 0) {
  throw new Error(result.stderr || result.stdout || "Failed to install desktop shortcut.");
}

console.log(shortcutPaths.join("\n"));

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
