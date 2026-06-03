import { describe, expect, it } from "vitest";
import { formatListenUrl, fullReplayEnabled, resolveRubiconListenHost } from "./index.ts";

describe("Rubicon API server policy", () => {
  it("binds to loopback by default and formats IPv6 listen URLs", () => {
    expect(resolveRubiconListenHost({})).toBe("127.0.0.1");
    expect(formatListenUrl("::1", 5174)).toBe("http://[::1]:5174");
  });

  it("allows an explicit env opt-in to a non-loopback host", () => {
    expect(resolveRubiconListenHost({ RUBICON_LISTEN_HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });

  it("requires an explicit opt-in for full replay payloads", () => {
    expect(fullReplayEnabled({})).toBe(false);
    expect(fullReplayEnabled({ RUBICON_ENABLE_FULL_REPLAY: "0" })).toBe(false);
    expect(fullReplayEnabled({ RUBICON_ENABLE_FULL_REPLAY: "1" })).toBe(true);
  });
});
