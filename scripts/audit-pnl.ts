import fs from "node:fs/promises";
import path from "node:path";
import { auditPnl, formatPnlAuditMarkdown, type PnlAuditOptions } from "../server/pnlAudit.ts";

type OutputFormat = "json" | "markdown";

function argValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function outputFormat(): OutputFormat {
  const raw = argValue("--format") ?? "json";
  if (raw === "json" || raw === "markdown") {
    return raw;
  }
  throw new Error("--format must be json or markdown.");
}

function auditOptions(): PnlAuditOptions {
  const toleranceArg = argValue("--tolerance");
  return {
    date: argValue("--date"),
    from: argValue("--from"),
    root: argValue("--root"),
    to: argValue("--to"),
    tolerance: toleranceArg === undefined ? undefined : Number(toleranceArg),
  };
}

async function main(): Promise<void> {
  const options = auditOptions();
  const format = outputFormat();
  const result = await auditPnl(options);
  const body = format === "markdown" ? formatPnlAuditMarkdown(result) : `${JSON.stringify(result, null, 2)}\n`;
  const outPath = argValue("--out");
  if (outPath) {
    const target = path.resolve(outPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body, "utf8");
  } else {
    process.stdout.write(body);
  }
  if (result.status === "fail" && !hasFlag("--no-fail-on-drift")) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
