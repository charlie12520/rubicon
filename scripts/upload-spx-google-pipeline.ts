import path from "node:path";
import { defaultPayloadPath, uploadDailyPipelineToGoogle } from "../server/googleSheetsUpload.ts";
import { refreshGoogleDriveSnapshot } from "./refresh-google-drive-snapshot.ts";

function argValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const date = argValue("--date");
  const payloadArg = argValue("--payload");
  if (!payloadArg && !date) {
    throw new Error("Pass --payload <google_sheet_upload_payload.json> or --date YYYY-MM-DD.");
  }
  const payloadPath = path.resolve(payloadArg ?? defaultPayloadPath(date ?? ""));
  const result = await uploadDailyPipelineToGoogle({
    payloadPath,
    runId: argValue("--run-id"),
  });
  try {
    await refreshGoogleDriveSnapshot();
  } catch (error) {
    console.warn(`Google snapshot refresh warning: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
