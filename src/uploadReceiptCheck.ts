import type { DailySummary } from "../shared/types";
import { formatNumber } from "./format";

export type UploadReceiptCheck = {
  badge: string;
  detail: string;
  facts: Array<{ label: string; value: string }>;
  steps: string[];
  title: string;
  tone: "warning" | "error";
};

const GOOGLE_CREDENTIALS = [
  "GOOGLE_SHEETS_ACCESS_TOKEN",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_SERVICE_ACCOUNT_PATH",
  "GOOGLE_SHEETS_API_KEY",
].join(", ");

export function buildUploadReceiptCheck(summary: DailySummary | null | undefined): UploadReceiptCheck | null {
  if (!summary || summary.rawUploadGoogleSheetUrl || summary.uploadStatus === "uploaded") {
    return null;
  }

  if (summary.uploadStatus === "payload_ready_unconfirmed") {
    return {
      badge: "Needs receipt",
      detail: `${summary.date} has ${formatNumber(summary.payloadRows)} locally staged rows across ${formatNumber(summary.uploadTabCount)} tabs, but no raw Google workbook receipt is confirmed yet.`,
      facts: compactFacts([
        { label: "Status", value: statusFact(summary.uploadStatus) },
        { label: "Local payload", value: payloadFact(summary) },
        summary.uploadReceiptCheck ? { label: "Connector search", value: connectorSearchFact(summary) } : null,
        { label: "Generated", value: summary.generatedAtLocal ?? "Not reported" },
      ].filter((fact): fact is { label: string; value: string } => Boolean(fact))),
      steps: [
        `Configure one Google credential: ${GOOGLE_CREDENTIALS}.`,
        "Click Refresh Google in Source State, or run npm run google:snapshot from this app folder.",
        `Confirm SPX Spread Trade Tracker > Daily Sync Runs contains ${summary.date} with raw_upload_google_sheet_url.`,
      ],
      title: "Google receipt not confirmed",
      tone: "warning",
    };
  }

  return {
    badge: "Upload gap",
    detail: `${summary.date} does not have a confirmed Google upload payload or raw workbook receipt.`,
    facts: compactFacts([
      { label: "Status", value: statusFact(summary.uploadStatus || "unknown") },
      { label: "Local payload", value: payloadFact(summary) },
      { label: "Workbook", value: summary.workbookPath ?? "Not found" },
    ]),
    steps: [
      "Run Daily Sync after the same-day cutoff opens, then wait for the local staged payload to be written.",
      "Click Refresh Google in Source State after a Google credential is configured.",
      `Confirm SPX Spread Trade Tracker > Daily Sync Runs contains ${summary.date} with raw_upload_google_sheet_url.`,
    ],
    title: "Google upload payload missing",
    tone: "error",
  };
}

function payloadFact(summary: DailySummary): string {
  if (!summary.payloadRows && !summary.uploadTabCount) {
    return "Not found";
  }
  return `${formatNumber(summary.payloadRows)} rows / ${formatNumber(summary.uploadTabCount)} tabs`;
}

function statusFact(value: string): string {
  return value.replaceAll("_", " ");
}

function connectorSearchFact(summary: DailySummary): string {
  const check = summary.uploadReceiptCheck;
  if (!check) {
    return "Not checked";
  }

  const checkedAt = check.checkedAt ? ` at ${check.checkedAt}` : "";
  const range = check.scannedRange ? ` (${check.scannedRange})` : "";
  if (check.status === "missing_receipt_row") {
    return `${formatNumber(check.matchedRowCount ?? 0)} rows${shortCheckedAt(check.checkedAt)}${range}`;
  }
  if (check.status === "found") {
    return `${formatNumber(Math.max(1, check.matchedRowCount ?? 1))} row${check.matchedRowCount === 1 ? "" : "s"}${shortCheckedAt(check.checkedAt)}${range}`;
  }
  if (check.status === "quota_limited") {
    return `Quota limited${checkedAt}${range}`;
  }
  if (check.status === "error") {
    return `Search error${checkedAt}${range}`;
  }
  return `Checked${checkedAt}${range}`;
}

function shortCheckedAt(value: string | undefined): string {
  const match = value?.match(/T(\d{2}):(\d{2})/);
  return match ? ` at ${match[1]}:${match[2]} ET` : value ? ` at ${value}` : "";
}

function compactFacts(facts: Array<{ label: string; value: string }>): Array<{ label: string; value: string }> {
  return facts.map((fact) => ({
    label: fact.label,
    value: fact.value.replaceAll("\\", "/").replace(/\s+/g, " ").trim(),
  }));
}
