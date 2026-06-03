const ACRONYMS = new Set([
  "ADP",
  "AI",
  "API",
  "BOC",
  "BOE",
  "BOJ",
  "CDC",
  "CEO",
  "CFTC",
  "CPI",
  "CUPW",
  "DOJ",
  "ECB",
  "EIA",
  "EU",
  "FDA",
  "FOMC",
  "FTC",
  "GDP",
  "GOP",
  "IDF",
  "IMF",
  "ISM",
  "JOLTS",
  "NATO",
  "NFP",
  "OPEC",
  "OTC",
  "PCE",
  "PMI",
  "PPI",
  "SEC",
  "SPX",
  "UAE",
  "UK",
  "UN",
  "US",
  "USDA",
  "USD",
  "WHO",
  "WTI",
]);

export function formatLiveUpdateDisplayText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!isMostlyUppercase(text)) {
    return text;
  }
  const tokens = text.match(/[A-Za-z][A-Za-z0-9']*|[^A-Za-z]+/g) ?? [text];
  let capitalizeNext = true;
  return applyLiveUpdatePhraseFixups(
    tokens
      .map((token) => {
        if (!/[A-Za-z]/.test(token)) {
          if (/[.!?:]\s*$/.test(token) || /^\s+(?:-|\u2013|\u2014)\s+$/.test(token)) {
            capitalizeNext = true;
          }
          return token;
        }

        const rendered = renderAllCapsWord(token, capitalizeNext);
        capitalizeNext = false;
        return rendered;
      })
      .join(""),
  );
}

function isMostlyUppercase(value: string): boolean {
  const letters = [...value].filter((char) => /[A-Za-z]/.test(char));
  if (!letters.length) {
    return false;
  }
  const uppercaseCount = letters.filter((char) => char === char.toUpperCase() && char !== char.toLowerCase()).length;
  const lowercaseCount = letters.filter((char) => char === char.toLowerCase() && char !== char.toUpperCase()).length;
  return uppercaseCount / letters.length >= 0.78 && uppercaseCount > lowercaseCount * 3;
}

function renderAllCapsWord(word: string, capitalize: boolean): string {
  const upper = word.toUpperCase();
  if (ACRONYMS.has(upper) || upper === "I") {
    return upper;
  }
  if (/\d/.test(word) || word.startsWith("$")) {
    return word;
  }
  const lower = word.toLowerCase();
  return capitalize ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}` : lower;
}

function applyLiveUpdatePhraseFixups(value: string): string {
  return value
    .replace(/\bbeirut\b/gi, "Beirut")
    .replace(/\bbrent\b/gi, "Brent")
    .replace(/\bcanada post\b/gi, "Canada Post")
    .replace(/\bhezbollah\b/gi, "Hezbollah")
    .replace(/\bislamic republic of iran\b/gi, "Islamic Republic of Iran")
    .replace(/\biran\b/gi, "Iran")
    .replace(/\biraqi\b/gi, "Iraqi")
    .replace(/\bisrael\b/gi, "Israel")
    .replace(/\bisraeli\b/gi, "Israeli")
    .replace(/\bjan\b/gi, "Jan")
    .replace(/\bpowell\b/gi, "Powell")
    .replace(/\btrump\b/gi, "Trump")
    .replace(/\bTruth social\b/gi, "Truth Social")
    .replace(/\bAl hadath\b/gi, "Al Hadath")
    .replace(/\bBibi netanyahu\b/gi, "Bibi Netanyahu");
}
