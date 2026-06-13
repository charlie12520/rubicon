import type { TradeRecord } from "../shared/types";
import {
  journalAspectChecklistForTrade,
  splitJournalTags,
  type JournalAspectKey,
  type JournalEmotion,
  type JournalGrade,
  type TradeJournalEntry,
} from "./tradeJournal";

export const JOURNAL_QA_EMOTIONS: JournalEmotion[] = ["Focused", "Calm", "FOMO", "Hesitant", "Impulsive"];
export const JOURNAL_QA_GRADES: JournalGrade[] = ["A", "B", "C", "D", "F"];

export type JournalQaStepKind = "text" | "textarea" | "tags" | "boolean" | "choice" | "score";

export type JournalQaStep = {
  aspectKey?: JournalAspectKey;
  id: string;
  kind: JournalQaStepKind;
  options?: string[];
  prompt: string;
};

export function journalQaStepsForTrade(trade: Pick<TradeRecord, "priceType" | "side" | "strategy">): JournalQaStep[] {
  const aspectSteps = journalAspectChecklistForTrade(trade).map((item): JournalQaStep => ({
    aspectKey: item.key,
    id: `aspect-${item.key}`,
    kind: "boolean",
    prompt: item.optional ? `${item.label}?` : item.label,
  }));

  return [
    { id: "setup", kind: "text", prompt: "What setup or playbook was this?" },
    { id: "tags", kind: "tags", prompt: "Any tags for this trade?" },
    { id: "thesis", kind: "textarea", prompt: "What was the thesis before entry?" },
    { id: "execution", kind: "textarea", prompt: "What happened during execution?" },
    ...aspectSteps,
    { id: "emotion", kind: "choice", options: JOURNAL_QA_EMOTIONS, prompt: "What emotion was present?" },
    { id: "processScore", kind: "score", options: ["1", "2", "3", "4", "5"], prompt: "Process score?" },
    { id: "grade", kind: "choice", options: JOURNAL_QA_GRADES, prompt: "Final grade?" },
    { id: "followUp", kind: "boolean", prompt: "Does this need follow-up?" },
  ];
}

export function journalQaAnswerValue(entry: TradeJournalEntry, step: JournalQaStep): string {
  switch (step.id) {
    case "setup":
      return entry.setup;
    case "tags":
      return entry.tags.join(", ");
    case "thesis":
      return entry.thesis;
    case "execution":
      return entry.execution;
    case "emotion":
      return entry.emotion;
    case "processScore":
      return String(entry.processScore);
    case "grade":
      return entry.grade;
    case "followUp":
      return entry.followUp ? "yes" : "no";
    default:
      if (step.aspectKey) {
        return entry.aspectChecks[step.aspectKey] ? "yes" : "no";
      }
      return "";
  }
}

export function journalQaPatchForAnswer(
  entry: TradeJournalEntry,
  step: JournalQaStep,
  answer: string | boolean | number,
): Partial<TradeJournalEntry> {
  switch (step.id) {
    case "setup":
      return { setup: String(answer).slice(0, 120) };
    case "tags":
      return { tags: splitJournalTags(String(answer)) };
    case "thesis":
      return { thesis: String(answer).slice(0, 1200) };
    case "execution":
      return { execution: String(answer).slice(0, 1200) };
    case "emotion":
      return { emotion: isJournalEmotion(answer) ? answer : entry.emotion };
    case "processScore":
      return { processScore: clampScore(answer) };
    case "grade":
      return { grade: isJournalGrade(answer) ? answer : entry.grade };
    case "followUp":
      return { followUp: booleanAnswer(answer) };
    default:
      if (step.aspectKey) {
        return {
          aspectChecks: {
            ...entry.aspectChecks,
            [step.aspectKey]: booleanAnswer(answer),
          },
        };
      }
      return {};
  }
}

function booleanAnswer(answer: string | boolean | number): boolean {
  if (typeof answer === "boolean") {
    return answer;
  }
  if (typeof answer === "number") {
    return answer > 0;
  }
  const normalized = answer.trim().toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "1";
}

function clampScore(answer: string | boolean | number): number {
  const numeric = Number(answer);
  if (!Number.isFinite(numeric)) {
    return 3;
  }
  return Math.max(1, Math.min(5, Math.round(numeric)));
}

function isJournalEmotion(value: unknown): value is JournalEmotion {
  return JOURNAL_QA_EMOTIONS.includes(value as JournalEmotion);
}

function isJournalGrade(value: unknown): value is JournalGrade {
  return JOURNAL_QA_GRADES.includes(value as JournalGrade);
}
