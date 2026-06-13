import { useCallback, useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";

type AppVersionStatus = {
  ok: boolean;
  currentBranch: string | null;
  isMainBranch: boolean;
  localRev: string | null;
  localRevShort: string | null;
  remoteBranch: string;
  remoteRevShort: string | null;
  behindCount: number;
  aheadCount: number;
  dirtyFiles: string[];
  marketHours: boolean;
  error?: string;
};

type UpdatePhase = "idle" | "updating" | "restarting";

const RESTART_POLL_MS = 2_500;
const RESTART_TIMEOUT_MS = 180_000;
const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

function gitStatusSummary(status: AppVersionStatus | null): string {
  if (!status?.ok) {
    return "version check unavailable";
  }
  const branch = status.currentBranch ?? "detached HEAD";
  const local = status.localRevShort ?? "unknown";
  const remoteBranch = status.remoteBranch || "origin/main";
  const remote = status.remoteRevShort ?? "unknown";
  return `branch ${branch}; HEAD ${local}; ${remoteBranch} ${remote}; behind ${status.behindCount}; ahead ${status.aheadCount}; dirty ${status.dirtyFiles.length}`;
}

/**
 * The header "Latest" button. Up to date -> plain bundle refresh. Behind
 * GitHub -> confirm, then the server pulls origin/main, rebuilds, and restarts
 * itself. Blocked states fall back to bundle refresh and explain themselves.
 */
export function AppUpdateButton({ onBundleRefresh }: { onBundleRefresh: () => void }) {
  const [status, setStatus] = useState<AppVersionStatus | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const checkVersion = async () => {
      try {
        const res = await fetch("/api/app-version");
        const payload = (await res.json()) as AppVersionStatus;
        if (!active) {
          return;
        }
        setStatus(payload);
        setNotice(payload.ok ? null : payload.error ?? "version check failed");
      } catch {
        if (active) {
          setNotice("version check unavailable");
        }
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkVersion();
      }
    };

    void checkVersion();
    const intervalId = window.setInterval(() => void checkVersion(), VERSION_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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
        // server is restarting; keep polling
      }
    }
    setPhase("idle");
    setNotice("restart took too long - check data/app-update.log");
  }, [onBundleRefresh]);

  const behind = status?.behindCount ?? 0;
  const dirtyCount = status?.dirtyFiles.length ?? 0;
  const offMain = Boolean(status?.ok && !status.isMainBranch);
  const blocked = offMain || dirtyCount > 0 || (status?.aheadCount ?? 0) > 0;
  const updateAvailable = Boolean(status?.ok) && status?.isMainBranch === true && behind > 0 && !blocked;
  const summary = gitStatusSummary(status);

  const onClick = useCallback(async () => {
    if (phase === "updating" || phase === "restarting") {
      return;
    }
    if (!updateAvailable) {
      onBundleRefresh();
      return;
    }
    const marketWarning = status?.marketHours
      ? "\n\nWARNING: market hours - restarting stops today's live feeds until tomorrow's open."
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
      setNotice("update request failed - is the server reachable?");
    }
  }, [behind, onBundleRefresh, phase, status, updateAvailable, waitForRestart]);

  const label =
    phase === "updating" ? "Updating..."
    : phase === "restarting" ? "Restarting..."
    : updateAvailable ? `Update (${behind})`
    : offMain ? "Dev branch"
    : "Latest";
  const title = notice
    ? notice
    : phase === "updating" ? "Pulling and rebuilding from GitHub"
    : phase === "restarting" ? "Waiting for the server to come back on the new version"
    : offMain ? `Dev branch: update blocked - ${summary}`
    : updateAvailable ? `GitHub main is ${behind} commit${behind === 1 ? "" : "s"} ahead - click to pull, rebuild, and restart`
    : blocked && behind > 0 ? `Update available but blocked: ${dirtyCount ? "uncommitted local changes" : "local commits not on GitHub"} - ${summary} - click reloads the bundle only`
    : `On the latest GitHub version - ${summary} - click to reload the app shell and newest built bundle`;

  return (
    <button
      aria-label={updateAvailable ? "Update to latest GitHub version" : offMain ? `Dev branch: update blocked - ${summary}` : `Refresh to latest version - ${summary}`}
      className={`version-refresh-button${updateAvailable ? " update-available" : ""}${offMain ? " dev-blocked" : ""}${phase === "updating" || phase === "restarting" ? " busy" : ""}`}
      onClick={() => void onClick()}
      title={title}
      type="button"
    >
      <RefreshCcw size={14} />
      <span>{label}</span>
      {status?.ok && <span className="version-refresh-meta">{status.localRevShort ?? "unknown"}</span>}
    </button>
  );
}
