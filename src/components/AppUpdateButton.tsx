import { useCallback, useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";

type AppVersionStatus = {
  ok: boolean;
  localRev: string | null;
  localRevShort: string | null;
  behindCount: number;
  aheadCount: number;
  dirtyFiles: string[];
  marketHours: boolean;
  error?: string;
};

type UpdatePhase = "idle" | "updating" | "restarting";

const RESTART_POLL_MS = 2_500;
const RESTART_TIMEOUT_MS = 180_000;

/**
 * The header "Latest" button. Up to date -> plain bundle refresh (the old
 * behavior). Behind GitHub -> confirm, then the server pulls origin/main,
 * rebuilds, and restarts itself; we poll until the new revision answers and
 * hard-refresh onto the new bundle. Blocked states (local edits / unpushed
 * commits) fall back to bundle refresh and explain themselves in the tooltip.
 */
export function AppUpdateButton({ onBundleRefresh }: { onBundleRefresh: () => void }) {
  const [status, setStatus] = useState<AppVersionStatus | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [notice, setNotice] = useState<string | null>(null);

  // Mount-time version check; every state write lands in a promise callback
  // (nothing synchronous in the effect body), with an active-guard for unmount.
  useEffect(() => {
    let active = true;
    fetch("/api/app-version")
      .then(async (res) => (await res.json()) as AppVersionStatus)
      .then((payload) => {
        if (!active) {
          return;
        }
        setStatus(payload);
        setNotice(payload.ok ? null : payload.error ?? "version check failed");
      })
      .catch(() => {
        if (active) {
          setNotice("version check unavailable");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const waitForRestart = useCallback(async (previousRev: string | null) => {
    const deadline = Date.now() + RESTART_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, RESTART_POLL_MS));
      try {
        const res = await fetch("/api/app-version?refresh=0");
        const payload = (await res.json()) as AppVersionStatus;
        if (payload.localRev && payload.localRev !== previousRev) {
          onBundleRefresh();
          return;
        }
      } catch {
        // server is restarting — keep polling
      }
    }
    setPhase("idle");
    setNotice("restart took too long — check data/app-update.log");
  }, [onBundleRefresh]);

  const behind = status?.behindCount ?? 0;
  const blocked = (status?.dirtyFiles.length ?? 0) > 0 || (status?.aheadCount ?? 0) > 0;
  const updateAvailable = Boolean(status?.ok) && behind > 0 && !blocked;

  const onClick = useCallback(async () => {
    if (phase === "updating" || phase === "restarting") {
      return;
    }
    if (!updateAvailable) {
      onBundleRefresh();
      return;
    }
    const marketWarning = status?.marketHours
      ? "\n\nWARNING: market hours — restarting stops today's live feeds until tomorrow's open."
      : "";
    if (!window.confirm(`Update Rubicon to the latest GitHub version? (${behind} commit${behind === 1 ? "" : "s"} behind)${marketWarning}`)) {
      return;
    }
    setPhase("updating");
    setNotice(null);
    try {
      const res = await fetch("/api/app-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const payload = (await res.json()) as { ok: boolean; message: string; restarting?: boolean };
      if (payload.ok && payload.restarting) {
        setPhase("restarting");
        void waitForRestart(status?.localRev ?? null);
      } else {
        setPhase("idle");
        setNotice(payload.message);
      }
    } catch {
      setPhase("idle");
      setNotice("update request failed — is the server reachable?");
    }
  }, [behind, onBundleRefresh, phase, status, updateAvailable, waitForRestart]);

  const label =
    phase === "updating" ? "Updating…"
    : phase === "restarting" ? "Restarting…"
    : updateAvailable ? `Update (${behind})`
    : "Latest";
  const title = notice
    ? notice
    : phase === "updating" ? "Pulling and rebuilding from GitHub"
    : phase === "restarting" ? "Waiting for the server to come back on the new version"
    : updateAvailable ? `GitHub main is ${behind} commit${behind === 1 ? "" : "s"} ahead — click to pull, rebuild, and restart`
    : blocked && behind > 0 ? `Update available but blocked: ${status?.dirtyFiles.length ? "uncommitted local changes" : "local commits not on GitHub"} — click reloads the bundle only`
    : "On the latest GitHub version — click to reload the app shell and newest built bundle";

  return (
    <button
      aria-label={updateAvailable ? "Update to latest GitHub version" : "Refresh to latest version"}
      className={`version-refresh-button${updateAvailable ? " update-available" : ""}${phase === "updating" || phase === "restarting" ? " busy" : ""}`}
      onClick={() => void onClick()}
      title={title}
      type="button"
    >
      <RefreshCcw size={14} />
      {label}
    </button>
  );
}
