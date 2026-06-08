import { describe, expect, it } from "vitest";
import type { DailySummary } from "../shared/types";
import { buildUploadReceiptCheck } from "./uploadReceiptCheck";

describe("upload receipt check", () => {
  it("builds concrete recovery steps for a locally staged but unconfirmed Google upload", () => {
    const check = buildUploadReceiptCheck(summary({
      generatedAtLocal: "2026-05-29T16:38:22-04:00",
      payloadRows: 20,
      uploadReceiptCheck: {
        checkedAt: "2026-05-29T17:43:01-04:00",
        detail: "Connector search returned 0 matching rows.",
        matchedRowCount: 0,
        scannedRange: "A1:AA998",
        source: "Google Drive connector row search",
        status: "missing_receipt_row",
      },
      uploadStatus: "payload_ready_unconfirmed",
      uploadTabCount: 1,
    }));

    expect(check?.tone).toBe("warning");
    expect(check?.badge).toBe("Needs upload");
    expect(check?.detail).toContain("20 locally staged tracker rows");
    expect(check?.facts).toContainEqual({ label: "Local payload", value: "20 rows / 1 tab" });
    expect(check?.facts).toContainEqual({
      label: "Connector search",
      value: "0 rows at 17:43 ET (A1:AA998)",
    });
    expect(check?.steps.join(" ")).toContain("GOOGLE_SHEETS_ACCESS_TOKEN");
    expect(check?.steps.join(" ")).toContain("npm run google:snapshot");
    expect(check?.steps.join(" ")).toContain("2026-05-29");
    expect(check?.steps.join(" ")).toContain("google_upload_status complete");
  });

  it("stays quiet when the Google tracker upload is already confirmed", () => {
    expect(buildUploadReceiptCheck(summary({
      uploadStatus: "uploaded",
    }))).toBeNull();
  });

  it("escalates a missing payload to an upload gap", () => {
    const check = buildUploadReceiptCheck(summary({
      payloadRows: 0,
      uploadStatus: "missing_payload",
      uploadTabCount: 0,
    }));

    expect(check?.tone).toBe("error");
    expect(check?.title).toBe("Google upload payload missing");
    expect(check?.facts).toContainEqual({ label: "Local payload", value: "Not found" });
    expect(check?.steps.join(" ")).toContain("Run Daily Sync");
  });
});

function summary(overrides: Partial<DailySummary>): DailySummary {
  return {
    availabilityStatus: "ok",
    date: "2026-05-29",
    entryCount: 19,
    fillCount: 136,
    issueCount: 0,
    issues: [],
    optionContractCount: 12,
    optionIntradayStatus: "ok",
    payloadRows: 59333,
    spxStatus: "up_to_date",
    spreadCount: 24,
    tradeCount: 136,
    tradeStatus: "ok",
    uploadStatus: "payload_ready_unconfirmed",
    uploadTabCount: 10,
    ...overrides,
  };
}
