import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function argValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function cleanSheetName(name, seen) {
  const fallback = "Sheet";
  const base = String(name || fallback)
    .replace(/[\\/?*:[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31) || fallback;
  let next = base;
  let index = 2;
  while (seen.has(next)) {
    const suffix = ` ${index}`;
    next = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }
  seen.add(next);
  return next;
}

function sanitizeCell(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  const text = String(value);
  return text.startsWith("=") ? `'${text}` : text;
}

async function loadArtifactTool() {
  try {
    return await import("@oai/artifact-tool");
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") {
      throw error;
    }
  }

  const bundledNodeModules =
    process.env.CODEX_NODE_MODULES ??
    process.env.CODEX_WORKSPACE_NODE_MODULES ??
    path.join(
      process.env.USERPROFILE ?? "",
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "node",
      "node_modules",
    );
  const packageRoot = path.join(bundledNodeModules, "@oai", "artifact-tool");
  const packageJson = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
  const exportedPath = String(packageJson.exports?.["."] ?? "./dist/artifact_tool.mjs").replace(/^\.\//, "");
  return import(pathToFileURL(path.join(packageRoot, exportedPath)).href);
}

async function main() {
  const { SpreadsheetFile, Workbook } = await loadArtifactTool();
  const payloadPath = argValue("--payload");
  if (!payloadPath) {
    throw new Error("Usage: node scripts/rebuild-google-upload-workbook.mjs --payload <google_sheet_upload_payload.json> [--out <workbook.xlsx>]");
  }

  const resolvedPayloadPath = path.resolve(payloadPath);
  const payload = JSON.parse(await fs.readFile(resolvedPayloadPath, "utf8"));
  const tabs = Array.isArray(payload.tabs) ? payload.tabs : [];
  if (!tabs.length) {
    throw new Error(`No tabs found in ${resolvedPayloadPath}.`);
  }

  const outPath = path.resolve(
    argValue("--out") ??
      path.join(path.dirname(resolvedPayloadPath), `spx_daily_upload_${String(payload.target_trade_date_et ?? "payload")}.xlsx`),
  );
  const workbook = Workbook.create();
  const seen = new Set();
  let totalRows = 0;

  for (const tab of tabs) {
    const headers = Array.isArray(tab.headers) ? tab.headers.map(sanitizeCell) : [];
    const bodyRows = Array.isArray(tab.rows) ? tab.rows : [];
    const width = Math.max(1, headers.length);
    const values = [
      headers.length ? headers : [String(tab.sheet_name ?? "Sheet")],
      ...bodyRows.map((row) =>
        Array.from({ length: width }, (_, index) => sanitizeCell(Array.isArray(row) ? row[index] : undefined)),
      ),
    ];
    const sheet = workbook.worksheets.add(cleanSheetName(tab.sheet_name, seen));
    sheet.showGridLines = true;
    sheet.getRangeByIndexes(0, 0, values.length, width).values = values;
    sheet.freezePanes.freezeRows(1);
    totalRows += bodyRows.length;
    console.log(`${tab.sheet_name}: ${bodyRows.length} rows x ${headers.length} cols`);
  }

  const inspect = await workbook.inspect({
    include: "name,usedRange",
    kind: "sheet",
    summary: "rebuilt upload workbook tab check",
  });
  console.log(inspect.ndjson.split("\n").slice(0, 12).join("\n"));

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outPath);
  const stat = await fs.stat(outPath);
  console.log(JSON.stringify({ outPath, bytes: stat.size, totalRows, tabCount: tabs.length }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
