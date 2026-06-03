import type { TradeRecord } from "../shared/types";

export const JOURNAL_STORAGE_KEY = "spx-trade-journal-v1";

export type JournalGrade = "A" | "B" | "C" | "D" | "F";
export type JournalEmotion = "Calm" | "Focused" | "FOMO" | "Hesitant" | "Impulsive";
export type JournalStatus = "todo" | "draft" | "reviewed";
export type JournalFilter = "all" | "needs_review" | "follow_up" | "winners" | "losers";
export type JournalAspectKey = "entryStructure" | "priceAction" | "volumeNode" | "orderflow";
export type JournalAspectChecks = Record<JournalAspectKey, boolean>;

export type JournalAspectChecklistItem = {
  key: JournalAspectKey;
  label: string;
  optional: boolean;
};

export const JOURNAL_ASPECT_KEYS: JournalAspectKey[] = ["entryStructure", "priceAction", "volumeNode", "orderflow"];

export type TradeJournalEntry = {
  tradeId: string;
  date: string;
  setup: string;
  thesis: string;
  execution: string;
  emotion: JournalEmotion;
  mistake: string;
  lesson: string;
  grade: JournalGrade;
  processScore: number;
  tags: string[];
  aspectChecks: JournalAspectChecks;
  followUp: boolean;
  status: JournalStatus;
  updatedAt: string | null;
};

export type JournalCoverage = {
  total: number;
  drafted: number;
  reviewed: number;
  needsReview: number;
  followUps: number;
  avgProcessScore: number | null;
};

export function defaultJournalEntry(trade: TradeRecord): TradeJournalEntry {
  return {
    tradeId: trade.id,
    date: trade.date,
    setup: trade.strategy || `${trade.side} spread`,
    thesis: "",
    execution: trade.notes || "",
    emotion: "Focused",
    mistake: "",
    lesson: "",
    grade: "B",
    processScore: 3,
    tags: [],
    aspectChecks: defaultAspectChecks(),
    followUp: false,
    status: "todo",
    updatedAt: null,
  };
}

export function defaultAspectChecks(): JournalAspectChecks {
  return {
    entryStructure: false,
    priceAction: false,
    volumeNode: false,
    orderflow: false,
  };
}

export function journalAspectChecklistForTrade(trade: Pick<TradeRecord, "priceType" | "side" | "strategy">): JournalAspectChecklistItem[] {
  const spreadSide = journalSpreadSide(trade);
  if (!spreadSide) {
    return [];
  }

  return [
    {
      key: "entryStructure",
      label: spreadSide === "Call"
        ? "Entry is at a level validation or a lower high"
        : "Entry is at a level validation or a higher low",
      optional: false,
    },
    {
      key: "priceAction",
      label: "Price action is positive",
      optional: false,
    },
    {
      key: "volumeNode",
      label: spreadSide === "Call"
        ? "Spread is above the Option Volume Node"
        : "Spread is below the Option Volume Node",
      optional: false,
    },
    {
      key: "orderflow",
      label: spreadSide === "Call" ? "Strong selling orderflow" : "Strong buying orderflow",
      optional: true,
    },
  ];
}

export function buildJournalCoverage(trades: TradeRecord[], entries: Record<string, TradeJournalEntry>): JournalCoverage {
  const relevantEntries = trades.map((trade) => entries[trade.id]).filter(Boolean);
  const drafted = relevantEntries.filter((entry) => entry.status === "draft" || entry.status === "reviewed").length;
  const reviewed = relevantEntries.filter((entry) => entry.status === "reviewed").length;
  const followUps = relevantEntries.filter((entry) => entry.followUp).length;
  const scoredEntries = relevantEntries.filter((entry) => Number.isFinite(entry.processScore));
  const avgProcessScore = scoredEntries.length
    ? scoredEntries.reduce((sum, entry) => sum + entry.processScore, 0) / scoredEntries.length
    : null;

  return {
    total: trades.length,
    drafted,
    reviewed,
    needsReview: Math.max(0, trades.length - reviewed),
    followUps,
    avgProcessScore,
  };
}

export function filterJournalTrades(
  trades: TradeRecord[],
  entries: Record<string, TradeJournalEntry>,
  filter: JournalFilter,
): TradeRecord[] {
  switch (filter) {
    case "needs_review":
      return trades.filter((trade) => entries[trade.id]?.status !== "reviewed");
    case "follow_up":
      return trades.filter((trade) => entries[trade.id]?.followUp);
    case "winners":
      return trades.filter((trade) => trade.pnl > 0);
    case "losers":
      return trades.filter((trade) => trade.pnl < 0);
    case "all":
    default:
      return trades;
  }
}

export function nextUnreviewedTradeId(
  trades: TradeRecord[],
  entries: Record<string, TradeJournalEntry>,
  currentTradeId: string,
): string | null {
  if (!trades.length) {
    return null;
  }

  const currentIndex = Math.max(0, trades.findIndex((trade) => trade.id === currentTradeId));
  for (let offset = 1; offset <= trades.length; offset += 1) {
    const candidate = trades[(currentIndex + offset) % trades.length];
    if (entries[candidate.id]?.status !== "reviewed") {
      return candidate.id;
    }
  }
  return null;
}

export function mergeJournalEntry(
  trade: TradeRecord,
  current: TradeJournalEntry | undefined,
  patch: Partial<TradeJournalEntry>,
  now: string,
): TradeJournalEntry {
  return sanitizeJournalEntry({
    ...(current ?? defaultJournalEntry(trade)),
    ...patch,
    tradeId: trade.id,
    date: trade.date,
    updatedAt: now,
  }, trade) ?? { ...defaultJournalEntry(trade), updatedAt: now };
}

export function parseJournalEntries(raw: string | null | undefined): Record<string, TradeJournalEntry> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const entries: Record<string, TradeJournalEntry> = {};
    for (const [tradeId, value] of Object.entries(parsed)) {
      const entry = sanitizeJournalEntry(value, { id: tradeId, date: "" } as TradeRecord);
      if (entry) {
        entries[entry.tradeId] = entry;
      }
    }
    return entries;
  } catch {
    return {};
  }
}

export function serializeJournalEntries(entries: Record<string, TradeJournalEntry>): string {
  return JSON.stringify(entries);
}

export function splitJournalTags(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function sanitizeJournalEntry(value: unknown, trade: Pick<TradeRecord, "id" | "date">): TradeJournalEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<TradeJournalEntry>;
  const tradeId = typeof candidate.tradeId === "string" && candidate.tradeId ? candidate.tradeId : trade.id;
  const date = typeof candidate.date === "string" && candidate.date ? candidate.date : trade.date;
  if (!tradeId) {
    return null;
  }

  return {
    tradeId,
    date,
    setup: safeText(candidate.setup),
    thesis: safeText(candidate.thesis),
    execution: safeText(candidate.execution),
    emotion: isEmotion(candidate.emotion) ? candidate.emotion : "Focused",
    mistake: safeText(candidate.mistake),
    lesson: safeText(candidate.lesson),
    grade: isGrade(candidate.grade) ? candidate.grade : "B",
    processScore: clampProcessScore(candidate.processScore),
    tags: Array.isArray(candidate.tags) ? splitJournalTags(candidate.tags.join(",")) : [],
    aspectChecks: sanitizeAspectChecks(candidate.aspectChecks),
    followUp: candidate.followUp === true,
    status: isStatus(candidate.status) ? candidate.status : "todo",
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : null,
  };
}

function sanitizeAspectChecks(value: unknown): JournalAspectChecks {
  const checks = defaultAspectChecks();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return checks;
  }
  const record = value as Partial<Record<JournalAspectKey, unknown>>;
  for (const key of JOURNAL_ASPECT_KEYS) {
    checks[key] = record[key] === true;
  }
  return checks;
}

function journalSpreadSide(trade: Pick<TradeRecord, "priceType" | "side" | "strategy">): "Call" | "Put" | null {
  if (trade.priceType !== "Credit") {
    return null;
  }
  if (trade.side === "Call" || /\bcall\b/i.test(trade.strategy)) {
    return "Call";
  }
  if (trade.side === "Put" || /\bput\b/i.test(trade.strategy)) {
    return "Put";
  }
  return null;
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 4000) : "";
}

function clampProcessScore(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 3;
  }
  return Math.max(1, Math.min(5, Math.round(numeric)));
}

function isGrade(value: unknown): value is JournalGrade {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "F";
}

function isEmotion(value: unknown): value is JournalEmotion {
  return value === "Calm" || value === "Focused" || value === "FOMO" || value === "Hesitant" || value === "Impulsive";
}

function isStatus(value: unknown): value is JournalStatus {
  return value === "todo" || value === "draft" || value === "reviewed";
}
