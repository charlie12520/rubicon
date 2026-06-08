import crypto from "node:crypto";
import fs from "node:fs/promises";
import { DEFAULT_GOOGLE_SERVICE_ACCOUNT_PATH } from "./googleSheetsSnapshot.ts";

const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";

type ServiceAccount = {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
};

export type GoogleAuthConfig = {
  credentialSource: "GOOGLE_SHEETS_ACCESS_TOKEN" | "GOOGLE_SERVICE_ACCOUNT_JSON" | "GOOGLE_SERVICE_ACCOUNT_PATH";
  headers: Record<string, string>;
};

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readServiceAccount(env: NodeJS.ProcessEnv = process.env): Promise<{ source: GoogleAuthConfig["credentialSource"]; account: ServiceAccount } | null> {
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return {
      source: "GOOGLE_SERVICE_ACCOUNT_JSON",
      account: JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as ServiceAccount,
    };
  }

  const credentialPath = env.GOOGLE_SERVICE_ACCOUNT_PATH || (await fileExists(DEFAULT_GOOGLE_SERVICE_ACCOUNT_PATH) ? DEFAULT_GOOGLE_SERVICE_ACCOUNT_PATH : "");
  if (credentialPath) {
    return {
      source: "GOOGLE_SERVICE_ACCOUNT_PATH",
      account: JSON.parse(await fs.readFile(credentialPath, "utf8")) as ServiceAccount,
    };
  }

  return null;
}

async function serviceAccountAccessToken(serviceAccount: ServiceAccount, scopes: string[]): Promise<string> {
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
      scope: scopes.join(" "),
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = base64Url(signer.sign(serviceAccount.private_key.replaceAll("\\n", "\n")));
  const response = await fetch(tokenUri, {
    body: new URLSearchParams({
      assertion: `${unsigned}.${signature}`,
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const payload = (await response.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(`Google OAuth token request failed: ${payload.error_description ?? payload.error ?? response.statusText}`);
  }
  return payload.access_token;
}

export function googleWriteCredentialSources(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    env.GOOGLE_SHEETS_ACCESS_TOKEN ? "GOOGLE_SHEETS_ACCESS_TOKEN" : "",
    env.GOOGLE_SERVICE_ACCOUNT_JSON ? "GOOGLE_SERVICE_ACCOUNT_JSON" : "",
    env.GOOGLE_SERVICE_ACCOUNT_PATH ? "GOOGLE_SERVICE_ACCOUNT_PATH" : "",
  ].filter(Boolean);
}

export async function googleBearerAuth(scopes: string[], env: NodeJS.ProcessEnv = process.env): Promise<GoogleAuthConfig> {
  if (env.GOOGLE_SHEETS_ACCESS_TOKEN) {
    return {
      credentialSource: "GOOGLE_SHEETS_ACCESS_TOKEN",
      headers: { authorization: `Bearer ${env.GOOGLE_SHEETS_ACCESS_TOKEN}` },
    };
  }

  const serviceAccount = await readServiceAccount(env);
  if (serviceAccount) {
    return {
      credentialSource: serviceAccount.source,
      headers: { authorization: `Bearer ${await serviceAccountAccessToken(serviceAccount.account, scopes)}` },
    };
  }

  throw new Error("Google upload requires write credentials: set GOOGLE_SHEETS_ACCESS_TOKEN, GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_SERVICE_ACCOUNT_PATH.");
}

export async function fetchGoogleJson<T>(url: string, init: RequestInit, auth: GoogleAuthConfig): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...auth.headers,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T & { error?: { message?: string } }) : ({} as T & { error?: { message?: string } });
  if (!response.ok) {
    throw new Error(`Google API request failed: ${payload.error?.message ?? response.statusText}`);
  }
  return payload;
}
