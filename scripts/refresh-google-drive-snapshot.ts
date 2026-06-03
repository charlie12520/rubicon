import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGoogleDriveTrackerSnapshot,
  DAILY_SYNC_RUNS_RANGE,
  googleSheetsApiUrl,
  type GoogleSheetsMetadataResponse,
  type GoogleSheetsValuesResponse,
  SPX_TRACKER_SPREADSHEET_ID,
} from "../server/googleSheetsSnapshot.ts";
import { writeJsonAtomic } from "../server/jsonStore.ts";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const DEFAULT_SERVICE_ACCOUNT_PATH = path.resolve(SCRIPT_DIR, "..", "..", ".secrets", "spx-replay-google-service-account.json");

type AuthConfig = {
  apiKey?: string;
  headers?: Record<string, string>;
};

type ServiceAccount = {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
};

function argValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

async function readServiceAccount(): Promise<ServiceAccount | null> {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    return JSON.parse(rawJson) as ServiceAccount;
  }

  const credentialPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH || (await fileExists(DEFAULT_SERVICE_ACCOUNT_PATH) ? DEFAULT_SERVICE_ACCOUNT_PATH : "");
  if (credentialPath) {
    return JSON.parse(await fs.readFile(credentialPath, "utf8")) as ServiceAccount;
  }

  return null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function serviceAccountAccessToken(serviceAccount: ServiceAccount): Promise<string> {
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("Service account credential must include client_email and private_key.");
  }

  const tokenUri = serviceAccount.token_uri ?? DEFAULT_TOKEN_URL;
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      aud: tokenUri,
      exp: now + 3600,
      iat: now,
      iss: serviceAccount.client_email,
      scope: SHEETS_SCOPE,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = base64Url(signer.sign(serviceAccount.private_key.replaceAll("\\n", "\n")));
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch(tokenUri, {
    body: new URLSearchParams({
      assertion,
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const payload = await response.json() as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(`Google OAuth token request failed: ${payload.error_description ?? payload.error ?? response.statusText}`);
  }
  return payload.access_token;
}

async function authConfig(): Promise<AuthConfig> {
  if (process.env.GOOGLE_SHEETS_ACCESS_TOKEN) {
    return { headers: { authorization: `Bearer ${process.env.GOOGLE_SHEETS_ACCESS_TOKEN}` } };
  }

  const serviceAccount = await readServiceAccount();
  if (serviceAccount) {
    return { headers: { authorization: `Bearer ${await serviceAccountAccessToken(serviceAccount)}` } };
  }

  if (process.env.GOOGLE_SHEETS_API_KEY) {
    return { apiKey: process.env.GOOGLE_SHEETS_API_KEY };
  }

  throw new Error(
    "No Google Sheets credential configured. Set GOOGLE_SHEETS_ACCESS_TOKEN, GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SERVICE_ACCOUNT_PATH, or GOOGLE_SHEETS_API_KEY.",
  );
}

async function fetchJson<T>(url: string, auth: AuthConfig): Promise<T> {
  const nextUrl = new URL(url);
  if (auth.apiKey) {
    nextUrl.searchParams.set("key", auth.apiKey);
  }
  const response = await fetch(nextUrl, { headers: auth.headers });
  const payload = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(`Google Sheets API request failed: ${payload.error?.message ?? response.statusText}`);
  }
  return payload;
}

export async function refreshGoogleDriveSnapshot(): Promise<string> {
  const spreadsheetId = argValue("--spreadsheet-id") ?? process.env.SPX_GOOGLE_SHEET_ID ?? SPX_TRACKER_SPREADSHEET_ID;
  const range = argValue("--range") ?? process.env.SPX_GOOGLE_SHEET_DAILY_SYNC_RANGE ?? DAILY_SYNC_RUNS_RANGE;
  const outPath = path.resolve(argValue("--out") ?? process.env.SPX_GOOGLE_DRIVE_TRACKER_SNAPSHOT_PATH ?? "data/google-drive-tracker-snapshot.json");
  const auth = await authConfig();

  const metadata = await fetchJson<GoogleSheetsMetadataResponse>(
    googleSheetsApiUrl(spreadsheetId, "", {
      fields: "properties(title,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
    }),
    auth,
  );
  const dailySyncRuns = await fetchJson<GoogleSheetsValuesResponse>(
    googleSheetsApiUrl(spreadsheetId, `/values/${encodeURIComponent(range)}`),
    auth,
  );
  const snapshot = buildGoogleDriveTrackerSnapshot({
    dailySyncRuns,
    metadata,
    readAt: new Date().toISOString(),
    source: "Google Sheets API refresh",
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  });

  await writeJsonAtomic(outPath, snapshot);
  return outPath;
}

if (process.argv[1] && SCRIPT_PATH === path.resolve(process.argv[1])) {
  refreshGoogleDriveSnapshot()
    .then((outPath) => {
      console.log(`Wrote ${outPath}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
