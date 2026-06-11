import { spawnSync } from "node:child_process";
import path from "node:path";
import type { DesktopAlertResult } from "../shared/types.ts";

const RUBICON_APP_USER_MODEL_ID = process.env.RUBICON_WINDOWS_TOAST_APP_ID || "auto";

export type DesktopAlertPayload = {
  body: string;
  detail?: string;
  title?: string;
};

export function sanitizeDesktopAlertText(value: unknown, maxLength: number): string {
  // Strip C0 control characters + DEL without a control-char regex (lint:
  // no-control-regex): they break the PowerShell toast argument round-trip.
  const withoutControlChars = Array.from(String(value ?? ""), (ch) => {
    const code = ch.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? " " : ch;
  }).join("");
  return withoutControlChars
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

// Shared native Windows toast launcher (bottom-right corner / Action Center) via
// scripts/show-windows-toast.ps1. Both the calendar alert and the FirstSquawk
// live-update alert funnel through here so they look and land identically.
function launchWindowsToast(
  sanitized: { title: string; body: string; detail: string },
  appRoot: string,
  duration: "short" | "long",
): DesktopAlertResult {
  const scriptPath = path.join(appRoot, "scripts", "show-windows-toast.ps1");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-AppId",
      RUBICON_APP_USER_MODEL_ID,
      "-Title",
      sanitized.title,
      "-Body",
      sanitized.body,
      "-Detail",
      sanitized.detail,
      "-Duration",
      duration,
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `PowerShell exited with status ${result.status}`).trim());
  }

  const resolvedAppId = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);

  return {
    generatedAt: new Date().toISOString(),
    message: resolvedAppId
      ? `Desktop toast launched through Windows notifications via ${resolvedAppId}.`
      : "Desktop toast launched through Windows notifications.",
    ok: true,
  };
}

// Calendar 1-minute alerts now use the native Windows toast (same as FirstSquawk),
// replacing the centered wscript Popup dialog. "long" duration so a pre-event
// warning lingers in the Action Center.
export function showCalendarDesktopAlert(payload: DesktopAlertPayload, appRoot: string): DesktopAlertResult {
  const title = sanitizeDesktopAlertText(payload.title || "Calendar event starts in 1 minute", 120);
  const body = sanitizeDesktopAlertText(payload.body, 360);
  const detail = sanitizeDesktopAlertText(payload.detail ?? "", 360);
  if (!body) {
    throw new Error("Desktop alert body is required.");
  }
  return launchWindowsToast({ title, body, detail }, appRoot, "long");
}

export function showLiveUpdateDesktopToast(payload: DesktopAlertPayload, appRoot: string): DesktopAlertResult {
  const title = sanitizeDesktopAlertText(payload.title || "FirstSquawk alert", 120);
  const body = sanitizeDesktopAlertText(payload.body, 420);
  const detail = sanitizeDesktopAlertText(payload.detail ?? "", 300);
  if (!body) {
    throw new Error("Desktop alert body is required.");
  }
  return launchWindowsToast({ title, body, detail }, appRoot, "short");
}
