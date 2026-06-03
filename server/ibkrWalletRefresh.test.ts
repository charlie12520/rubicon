import { describe, expect, it } from "vitest";
import { ibkrWalletRefreshSourceHealth, parseIbkrPorts } from "./ibkrWalletRefresh.ts";

describe("IBKR wallet refresh helpers", () => {
  it("parses a unique ordered list of TWS/Gateway ports", () => {
    expect(parseIbkrPorts("7496, 4001,7496")).toEqual([7496, 4001]);
    expect(() => parseIbkrPorts("7496,nope")).toThrow("valid TCP ports");
  });

  it("reports live wallet refresh as ready when any configured port is reachable", async () => {
    const previousPorts = process.env.IBKR_WALLET_PORTS;
    process.env.IBKR_WALLET_PORTS = "7496,4001";

    try {
      const health = await ibkrWalletRefreshSourceHealth(async (_host, port) => port === 7496);

      expect(health.label).toBe("IBKR live wallet refresh");
      expect(health.status).toBe("ok");
      expect(health.count).toBe(1);
      expect(health.detail).toContain("127.0.0.1:7496");
    } finally {
      if (previousPorts === undefined) {
        delete process.env.IBKR_WALLET_PORTS;
      } else {
        process.env.IBKR_WALLET_PORTS = previousPorts;
      }
    }
  });

  it("reports a setup warning when no IBKR API port is reachable", async () => {
    const previousPorts = process.env.IBKR_WALLET_PORTS;
    process.env.IBKR_WALLET_PORTS = "7496,4001";

    try {
      const health = await ibkrWalletRefreshSourceHealth(async () => false);

      expect(health.status).toBe("warning");
      expect(health.detail).toContain("No TWS/Gateway API socket accepted connections");
      expect(health.detail).toContain("7496, 4001");
    } finally {
      if (previousPorts === undefined) {
        delete process.env.IBKR_WALLET_PORTS;
      } else {
        process.env.IBKR_WALLET_PORTS = previousPorts;
      }
    }
  });
});
