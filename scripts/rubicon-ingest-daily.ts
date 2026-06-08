import { refreshDailySyncDerivedState } from "../server/dailySync.ts";

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
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Pass --date YYYY-MM-DD to run Rubicon ingest.");
  }
  const result = await refreshDailySyncDerivedState({ date });
  console.log(JSON.stringify({ ok: result.warnings.length === 0, ...result }, null, 2));
  if (result.warnings.length) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
