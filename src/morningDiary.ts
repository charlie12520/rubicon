import type { DailyReviewNote, TradeRecord } from "../shared/types";
import type { TradeJournalEntry } from "./tradeJournal";

export type MorningDiarySummary = {
  date: string;
  available: boolean;
  source: string;
  headline: string;
  bullets: string[];
};

export function previousSessionDate(selectedDate: string, availableDates: string[]): string {
  const earlier = availableDates.filter((date) => date < selectedDate).sort((a, b) => b.localeCompare(a));
  if (earlier[0]) {
    return earlier[0];
  }
  const fallback = new Date(`${selectedDate}T12:00:00`);
  fallback.setDate(fallback.getDate() - 1);
  return fallback.toLocaleDateString("en-CA");
}

export function buildMorningDiarySummary({
  selectedDate,
  availableDates,
  entries,
  reviewNotes,
  trades,
}: {
  selectedDate: string;
  availableDates: string[];
  entries: Record<string, TradeJournalEntry>;
  reviewNotes: Record<string, DailyReviewNote>;
  trades: TradeRecord[];
}): MorningDiarySummary {
  const date = previousSessionDate(selectedDate, availableDates);
  const dayEntries = Object.values(entries).filter((entry) => entry.date === date && entry.status !== "todo");
  const dayTrades = trades.filter((trade) => trade.date === date);
  const reviewNote = reviewNotes[date]?.note.trim() ?? "";

  if (!dayEntries.length && !reviewNote) {
    return {
      date,
      available: false,
      source: "Local journal",
      headline: `No saved diary entries for ${date}.`,
      bullets: ["Save journal notes or Daily Review notes, then Morning will summarize the prior session here."],
    };
  }

  const bullets: string[] = [];
  if (dayEntries.length) {
    const reviewed = dayEntries.filter((entry) => entry.status === "reviewed").length;
    const avgScore = dayEntries.reduce((sum, entry) => sum + entry.processScore, 0) / dayEntries.length;
    const followUps = dayEntries.filter((entry) => entry.followUp).length;
    const grades = topCounts(dayEntries.map((entry) => entry.grade), 3);
    const emotions = topCounts(dayEntries.map((entry) => entry.emotion), 2);
    bullets.push(
      `${dayEntries.length} journal entries (${reviewed} reviewed) across ${dayTrades.length} trades; average process score ${avgScore.toFixed(1)}/5.`,
    );
    if (grades) bullets.push(`Grade mix: ${grades}.`);
    if (emotions) bullets.push(`Dominant state: ${emotions}.`);
    const lessons = dayEntries.map((entry) => entry.lesson.trim()).filter(Boolean);
    const mistakes = dayEntries.map((entry) => entry.mistake.trim()).filter(Boolean);
    if (lessons[0]) bullets.push(`Key lesson: ${shorten(lessons[0])}`);
    if (mistakes[0]) bullets.push(`Mistake to watch: ${shorten(mistakes[0])}`);
    if (followUps) bullets.push(`${followUps} follow-up item${followUps === 1 ? "" : "s"} carried into today.`);
  }

  if (reviewNote) {
    bullets.push(...sentences(reviewNote).slice(0, Math.max(1, 4 - bullets.length)));
  }

  return {
    date,
    available: true,
    source: dayEntries.length ? "Local trade journal" : "Daily Review note",
    headline: dayEntries.length
      ? `Yesterday's journal: ${dayEntries.length} saved trade notes.`
      : "Yesterday's Daily Review note is available.",
    bullets: bullets.slice(0, 5),
  };
}

function topCounts(values: string[], limit: number): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => `${value} x${count}`)
    .join(", ");
}

function sentences(note: string): string[] {
  return note
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map(shorten);
}

function shorten(value: string): string {
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}
