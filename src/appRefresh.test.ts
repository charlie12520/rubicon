import { describe, expect, it } from "vitest";
import { latestVersionUrl } from "./appRefresh";

describe("app shell refresh", () => {
  it("adds a cache-busting refresh marker while preserving the current URL context", () => {
    expect(latestVersionUrl("http://localhost:5174/?view=review#map", 12345)).toBe(
      "http://localhost:5174/?view=review&appRefresh=12345#map",
    );
  });

  it("replaces an older refresh marker", () => {
    expect(latestVersionUrl("http://localhost:5174/?appRefresh=old", 67890)).toBe("http://localhost:5174/?appRefresh=67890");
  });
});
