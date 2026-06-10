// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReplayPayload } from "../../shared/types";

// lightweight-charts needs a real canvas; this test is about the enlarge
// orchestration, so stub MarketChart with a probe that exposes its props.
vi.mock("./MarketChart", () => ({
  MarketChart: (props: { title: string; enlarged?: boolean; markerScale?: number; markerMode?: string; onToggleEnlarge?: () => void }) => (
    <section
      data-testid={`chart:${props.title}`}
      data-enlarged={String(Boolean(props.enlarged))}
      data-marker-scale={String(props.markerScale ?? 1)}
      data-marker-mode={props.markerMode ?? "full"}
    >
      {props.onToggleEnlarge && (
        <button onClick={props.onToggleEnlarge} type="button">
          enlarge {props.title}
        </button>
      )}
    </section>
  ),
  chartCountLabel: () => "",
}));

import { ReplayCharts } from "./ReplayCharts";

const REPLAY = {
  date: "2026-06-09",
  spxBars: [{ time: 100, timestampEt: "2026-06-09T09:30:00-04:00", label: "09:30", open: 1, high: 2, low: 1, close: 2 }],
  spreadMarks: [],
  openInterest: [],
  volume: [],
  quickTrades: [],
} as unknown as ReplayPayload;

afterEach(() => {
  cleanup();
});

function renderCharts() {
  return render(
    <ReplayCharts replay={REPLAY} replayIndex={0} replayMode={false} selectedTrade={null} selectedTrades={[]} />,
  );
}

describe("ReplayCharts enlarge mode", () => {
  it("enlarges one chart at a time with scaled markers and a backdrop", () => {
    const { container } = renderCharts();
    const spx = screen.getByTestId(/chart:SPX Intraday/);
    expect(spx).toHaveAttribute("data-enlarged", "false");
    expect(spx).toHaveAttribute("data-marker-scale", "1");
    expect(container.querySelector(".chart-enlarge-backdrop")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /enlarge SPX Intraday/ }));

    expect(screen.getByTestId(/chart:SPX Intraday/)).toHaveAttribute("data-enlarged", "true");
    // enlarging scales the ticks but the presentation stays compact — event
    // detail comes from hovering, like the Daily Review chart
    expect(screen.getByTestId(/chart:SPX Intraday/)).toHaveAttribute("data-marker-scale", "1.7");
    expect(screen.getByTestId(/chart:SPX Intraday/)).toHaveAttribute("data-marker-mode", "compact");
    expect(screen.getByTestId("chart:Selected Spread")).toHaveAttribute("data-enlarged", "false");
    expect(screen.getByTestId("chart:Selected Spread")).toHaveAttribute("data-marker-mode", "compact");
    expect(container.querySelector(".chart-enlarge-backdrop")).not.toBeNull();
  });

  it("uses the compact marker mode for all charts in every state", () => {
    renderCharts();
    expect(screen.getByTestId(/chart:SPX Intraday/)).toHaveAttribute("data-marker-mode", "compact");
    expect(screen.getByTestId("chart:Selected Spread")).toHaveAttribute("data-marker-mode", "compact");
  });

  it("Escape and the backdrop both restore the normal layout", () => {
    const { container } = renderCharts();
    fireEvent.click(screen.getByRole("button", { name: /enlarge Selected Spread/ }));
    expect(screen.getByTestId("chart:Selected Spread")).toHaveAttribute("data-enlarged", "true");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("chart:Selected Spread")).toHaveAttribute("data-enlarged", "false");
    expect(container.querySelector(".chart-enlarge-backdrop")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /enlarge Selected Spread/ }));
    const backdrop = container.querySelector(".chart-enlarge-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(screen.getByTestId("chart:Selected Spread")).toHaveAttribute("data-enlarged", "false");
  });
});
