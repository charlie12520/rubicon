import { refreshGoogleDriveSnapshot } from "../scripts/refresh-google-drive-snapshot.ts";
import { googleSheetsCredentialSources, type GoogleSnapshotRefreshRuntimeStatus } from "./googleSheetsSnapshot.ts";

const DEFAULT_AUTO_REFRESH_MINUTES = 30;

let lastRuntimeStatus: GoogleSnapshotRefreshRuntimeStatus | null = null;

type AutoRefreshOptions = {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  refresh?: () => Promise<string>;
};

export function resetGoogleSnapshotAutoRefreshForTests(): void {
  lastRuntimeStatus = null;
}

export function googleSnapshotAutoRefreshEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !["0", "false", "off"].includes(String(env.SPX_GOOGLE_AUTO_REFRESH ?? "1").toLowerCase());
}

export function googleSnapshotAutoRefreshIntervalMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.SPX_GOOGLE_AUTO_REFRESH_MINUTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_AUTO_REFRESH_MINUTES;
}

export async function maybeAutoRefreshGoogleDriveSnapshot({
  env = process.env,
  now = new Date(),
  refresh = refreshGoogleDriveSnapshot,
}: AutoRefreshOptions = {}): Promise<GoogleSnapshotRefreshRuntimeStatus> {
  const generatedAt = now.toISOString();
  const credentialSources = googleSheetsCredentialSources(env);

  if (!googleSnapshotAutoRefreshEnabled(env)) {
    return {
      attempted: false,
      credentialSources,
      generatedAt,
      message: "Automatic Google tracker snapshot refresh is disabled by SPX_GOOGLE_AUTO_REFRESH.",
      mode: "disabled",
      ok: false,
    };
  }

  if (!credentialSources.length) {
    return {
      attempted: false,
      credentialSources,
      generatedAt,
      message: "Automatic Google tracker snapshot refresh is waiting for a reusable Google Sheets credential.",
      mode: "waiting_for_credential",
      ok: false,
    };
  }

  const intervalMs = googleSnapshotAutoRefreshIntervalMinutes(env) * 60_000;
  const previousAttempt = lastRuntimeStatus?.lastAttemptAt ? Date.parse(lastRuntimeStatus.lastAttemptAt) : Number.NaN;
  const nextAttemptAfter = Number.isFinite(previousAttempt) ? new Date(previousAttempt + intervalMs) : null;

  if (nextAttemptAfter && now.getTime() < nextAttemptAfter.getTime()) {
    return {
      ...lastRuntimeStatus!,
      credentialSources,
      generatedAt,
      message: lastRuntimeStatus?.ok
        ? `Automatic Google tracker snapshot refresh last succeeded at ${lastRuntimeStatus.lastSuccessAt}; next attempt after ${nextAttemptAfter.toISOString()}.`
        : `Automatic Google tracker snapshot refresh last failed at ${lastRuntimeStatus?.lastAttemptAt}; retry after ${nextAttemptAfter.toISOString()}.`,
      mode: "skipped_recent",
      nextAttemptAfter: nextAttemptAfter.toISOString(),
    };
  }

  const lastAttemptAt = generatedAt;
  try {
    const outPath = await refresh();
    lastRuntimeStatus = {
      attempted: true,
      credentialSources,
      generatedAt,
      lastAttemptAt,
      lastSuccessAt: generatedAt,
      message: `Automatic Google tracker snapshot refresh succeeded at ${generatedAt}.`,
      mode: "refreshed",
      ok: true,
      outPath,
    };
  } catch (error) {
    lastRuntimeStatus = {
      attempted: true,
      credentialSources,
      generatedAt,
      lastAttemptAt,
      message: `Automatic Google tracker snapshot refresh failed at ${generatedAt}: ${error instanceof Error ? error.message : String(error)}.`,
      mode: "failed",
      ok: false,
    };
  }

  return lastRuntimeStatus;
}
