import fs from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const url = args.url || process.env.RUBICON_GODEL_NEWS_URL;
const outPath = path.resolve(args.out || process.env.RUBICON_GODEL_NEWS_CAPTURE_PATH || "data/godel-live-news.json");

if (!url) {
  throw new Error("Provide --url or RUBICON_GODEL_NEWS_URL for the Godel news source to capture.");
}

const headers = {
  Accept: "application/json,text/html,application/xml;q=0.9,*/*;q=0.8",
  "User-Agent": "Mozilla/5.0 Rubicon Godel News Capture/1.0",
};
if (process.env.RUBICON_GODEL_NEWS_COOKIE) {
  headers.Cookie = process.env.RUBICON_GODEL_NEWS_COOKIE;
}
if (process.env.RUBICON_GODEL_NEWS_BEARER) {
  headers.Authorization = `Bearer ${process.env.RUBICON_GODEL_NEWS_BEARER}`;
}

const response = await fetch(url, { headers });
const text = await response.text();
if (!response.ok) {
  throw new Error(`Godel capture failed: HTTP ${response.status} ${response.statusText}`);
}

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, text, "utf8");
console.log(JSON.stringify({ ok: true, outPath, bytes: Buffer.byteLength(text), status: response.status }));

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--url") {
      result.url = values[index + 1];
      index += 1;
    } else if (value === "--out") {
      result.out = values[index + 1];
      index += 1;
    }
  }
  return result;
}
