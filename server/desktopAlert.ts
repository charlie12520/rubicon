import { spawn } from "node:child_process";
import path from "node:path";
import type { DesktopAlertResult } from "../shared/types.ts";

export type DesktopAlertPayload = {
  body: string;
  detail?: string;
  title?: string;
};

export function sanitizeDesktopAlertText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function showCalendarDesktopAlert(payload: DesktopAlertPayload, appRoot: string): DesktopAlertResult {
  const title = sanitizeDesktopAlertText(payload.title || "Calendar event starts in 1 minute", 120);
  const body = sanitizeDesktopAlertText(payload.body, 360);
  const detail = sanitizeDesktopAlertText(payload.detail ?? "", 360);
  if (!body) {
    throw new Error("Desktop alert body is required.");
  }

  const scriptPath = path.join(appRoot, "scripts", "show-calendar-alert.vbs");
  const child = spawn(
    "wscript.exe",
    [scriptPath, title, body, detail, "12"],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    },
  );
  child.on("error", (error) => {
    console.warn(`Desktop calendar alert failed to launch: ${error.message}`);
  });
  child.unref();

  return {
    generatedAt: new Date().toISOString(),
    message: "Desktop calendar alert launched as a visible Windows popup.",
    ok: true,
    pid: child.pid,
  };
}
