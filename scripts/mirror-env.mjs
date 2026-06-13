import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function applyMirrorEnvDefaults() {
  const aiStuffRoot = process.env.AI_STUFF_ROOT || path.join(os.homedir(), "Desktop", "AI STUFF");
  if (!process.env.AI_STUFF_ROOT && fs.existsSync(aiStuffRoot)) {
    process.env.AI_STUFF_ROOT = aiStuffRoot;
  }

  const deprecatedRubiconRoot = path.join(aiStuffRoot, "spx-spread-replay-tracker_DEPRECATED_20260613");
  const originalRubiconRoot = path.join(aiStuffRoot, "spx-spread-replay-tracker");
  const evidenceRubiconRoot = fs.existsSync(deprecatedRubiconRoot)
    ? deprecatedRubiconRoot
    : originalRubiconRoot;
  setExistingPathDefault(
    "GOOGLE_SERVICE_ACCOUNT_PATH",
    path.join(aiStuffRoot, ".secrets", "spx-replay-google-service-account.json"),
  );
  setExistingPathDefault(
    "SPX_GOOGLE_DRIVE_TRACKER_SNAPSHOT_PATH",
    path.join(evidenceRubiconRoot, "data", "google-drive-tracker-snapshot.json"),
  );
  setExistingPathDefault(
    "SPX_GOOGLE_RECEIPT_CHECKS_PATH",
    path.join(evidenceRubiconRoot, "data", "google-drive-receipt-checks.json"),
  );
}

function setExistingPathDefault(envName, filePath) {
  if (!process.env[envName] && fs.existsSync(filePath)) {
    process.env[envName] = filePath;
  }
}
