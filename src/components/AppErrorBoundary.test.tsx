// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";

function Bomb(): never {
  throw new Error("kaboom from a deep panel");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <AppErrorBoundary>
        <div>cockpit content</div>
      </AppErrorBoundary>,
    );
    expect(screen.getByText("cockpit content")).toBeInTheDocument();
  });

  it("shows the crash screen with the error message instead of a blank page", () => {
    // React logs the thrown error during the boundary pass — keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Rubicon hit a render error")).toBeInTheDocument();
    expect(screen.getByText("kaboom from a deep panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Clear saved UI state/ })).toBeInTheDocument();
  });
});
