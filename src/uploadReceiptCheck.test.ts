import { describe, expect, it } from "vitest";
import type { DailySummary } from "../shared/types";
import { buildUploadReceiptCheck } from "./uploadReceiptCheck";

describe("upload receipt check", () => {
  it("builds concrete recovery steps for a locally staged but unconfirmed Google upload", () => {
    const check = buildUploadReceiptCheck(summary({
      generatedAtLocal: "2026-05-29T16:38:22-04:00",
      payloadRows: 59333,
      uploadReceiptCheck: {
        checkedAt: "2026-05-29T17:43:01-04:00",
        detail: "Connector search returned 0 matching rows.",
        matchedRowCount: 0,
        scannedRange: "A1:AA998",
        source: "Google Drive connector row search",
        status: "missing_receipt_row",
      },
      uploadStatus: "payload_ready_unconfirmed",
      uploadTabCount: 10,
    }));

    expect(check?.tone).toBe("warning");
    expect(check?.badge).toBe("Needs receipt");
    expect(check?.detail).toContain("59,333 locally staged rows");
    expect(check?.facts).toContainEqual({ label: "Local payload", value: "59,333 rows / 10 tabs" });
    expect(check?.facts).toContainEqual({
      label: "Connector search",
      value: "0 rows at 17:43 ET (A1:AA998)",
    });
    expect(check?.steps.join(" ")).toContain("GOOGLE_SHEETS_ACCESS_TOKEN");
    expect(check?.steps.join(" ")).toContain("npm run google:snapshot");
    expect(check?.steps.join(" ")).toContain("2026-05-29");
    expect(check?.steps.join(" ")).toContain("raw_upload_google_sheet_url");
  });

  it("stays quiet when the raw Google workbook receipt is already confirmed", () => {
    expect(buildUploadReceiptCheck(summary({
      rawUploadGoogleSheetUrl: "https://docs.google.com/spreadsheets/d/raw",
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
