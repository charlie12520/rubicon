import { describe, expect, it } from "vitest";
import { countReviewFlags, filterReviewFlagTrades, reviewFlagQueue } from "./reviewFlags";

const trades = [{ id: "one" }, { id: "two" }, { id: "three" }, { id: "four" }];

describe("daily review flag helpers", () => {
  it("counts selected-date flags and ignores stale flags", () => {
    const counts = countReviewFlags(trades, {
      one: "follow_up",
      two: "mistake",
      three: "quality",
      stale: "mistake",
    });

    expect(counts).toEqual({
      all: 4,
      flagged: 3,
      follow_up: 1,
      mistake: 1,
      quality: 1,
      unflagged: 1,
    });
  });

  it("filters ledger trades by selected review flag", () => {
    const flags = {
      one: "follow_up" as const,
      three: "quality" as const,
    };

    expect(filterReviewFlagTrades(trades, flags, "all").map((trade) => trade.id)).toEqual(["one", "two", "three", "four"]);
    expect(filterReviewFlagTrades(trades, flags, "follow_up").map((trade) => trade.id)).toEqual(["one"]);
    expect(filterReviewFlagTrades(trades, flags, "quality").map((trade) => trade.id)).toEqual(["three"]);
    expect(filterReviewFlagTrades(trades, flags, "unflagged").map((trade) => trade.id)).toEqual(["two", "four"]);
  });

  it("builds a replay queue for flagged trades in ledger order", () => {
    expect(reviewFlagQueue(trades, { three: "quality", one: "follow_up", stale: "mistake" })).toEqual([
      { flag: "follow_up", trade: { id: "one" } },
      { flag: "quality", trade: { id: "three" } },
    ]);
  });
});
