// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppUpdateButton } from "./AppUpdateButton";

function stubVersion(payload: Partial<Record<string, unknown>>, postResult?: Record<string, unknown>) {
  const base = {
    ok: true,
    currentBranch: "main",
    isMainBranch: true,
    localRev: "aaaa1111",
    localRevShort: "aaaa111",
    remoteBranch: "origin/main",
    remoteRevShort: "bbbb222",
    behindCount: 0,
    aheadCount: 0,
    dirtyFiles: [],
    marketHours: false,
  };
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      return { json: async () => postResult ?? { ok: false, message: "no post stub" } } as Response;
    }
    void url;
    return { json: async () => ({ ...base, ...payload }) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AppUpdateButton", () => {
  it("shows Latest and falls back to bundle refresh when up to date", async () => {
    stubVersion({ behindCount: 0 });
    const onBundleRefresh = vi.fn();
    render(<AppUpdateButton onBundleRefresh={onBundleRefresh} />);

    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Latest"));
    fireEvent.click(screen.getByRole("button"));
    expect(onBundleRefresh).toHaveBeenCalledTimes(1);
  });

  it("offers the update when behind GitHub and posts after confirmation", async () => {
    const fetchMock = stubVersion({ behindCount: 3 }, { ok: false, message: "gate said no" });
    vi.stubGlobal("confirm", vi.fn(() => true));
    const onBundleRefresh = vi.fn();
    render(<AppUpdateButton onBundleRefresh={onBundleRefresh} />);

    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Update (3)"));
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
      expect(postCall?.[0]).toBe("/api/app-update");
    });
    expect(onBundleRefresh).not.toHaveBeenCalled();
    // gate refusal surfaces in the tooltip instead of restarting
    await waitFor(() => expect(screen.getByRole("button")).toHaveAttribute("title", "gate said no"));
  });

  it("does not post when the confirm dialog is declined", async () => {
    const fetchMock = stubVersion({ behindCount: 1 });
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<AppUpdateButton onBundleRefresh={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Update (1)"));
    fireEvent.click(screen.getByRole("button"));
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("treats local edits as blocked: stays on bundle refresh and explains in the tooltip", async () => {
    stubVersion({ behindCount: 2, dirtyFiles: ["server/dailySync.ts"] });
    const onBundleRefresh = vi.fn();
    render(<AppUpdateButton onBundleRefresh={onBundleRefresh} />);

    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Latest"));
    expect(screen.getByRole("button").getAttribute("title")).toContain("uncommitted local changes");
    fireEvent.click(screen.getByRole("button"));
    expect(onBundleRefresh).toHaveBeenCalledTimes(1);
  });

  it("blocks GitHub updates on a dev branch and shows the git summary", async () => {
    const fetchMock = stubVersion({
      currentBranch: "agent/A196-multi-agent-safety",
      isMainBranch: false,
      localRevShort: "cccc333",
      behindCount: 2,
    });
    const onBundleRefresh = vi.fn();
    render(<AppUpdateButton onBundleRefresh={onBundleRefresh} />);

    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Dev branch"));
    const title = screen.getByRole("button").getAttribute("title") ?? "";
    expect(title).toContain("Dev branch: update blocked");
    expect(title).toContain("branch agent/A196-multi-agent-safety");
    expect(title).toContain("HEAD cccc333");
    fireEvent.click(screen.getByRole("button"));
    expect(onBundleRefresh).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });
});
