import type { MorningLiveUpdate } from "../shared/types";

export type CompiledLiveUpdateFilter = {
  normalized: string;
  pattern: RegExp | null;
  term: string;
};

export function parseLiveUpdateFilterText(value: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const rawTerm of value.split(/[,\n;]+/)) {
    const term = rawTerm.replace(/\s+/g, " ").trim().toLowerCase();
    if (!term || seen.has(term)) {
      continue;
    }
    seen.add(term);
    terms.push(term);
  }
  return terms;
}

export function compileLiveUpdateFilters(filters: string[]): CompiledLiveUpdateFilter[] {
  const seen = new Set<string>();
  const compiled: CompiledLiveUpdateFilter[] = [];
  for (const filter of filters) {
    const normalized = normalizeForMatching(filter);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    compiled.push({
      normalized,
      pattern: /^[a-z0-9]+$/i.test(normalized)
        ? new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalized)}([^a-z0-9]|$)`, "i")
        : null,
      term: normalized,
    });
  }
  return compiled;
}

export function liveUpdateMatchesFilter(update: MorningLiveUpdate, filters: string[]): boolean {
  if (!filters.length) {
    return false;
  }
  return matchingCompiledLiveUpdateFilters(update, compileLiveUpdateFilters(filters)).length > 0;
}

export function matchingLiveUpdateFilters(update: MorningLiveUpdate, filters: string[]): string[] {
  return matchingCompiledLiveUpdateFilters(update, compileLiveUpdateFilters(filters)).map((filter) => filter.term);
}

export function liveUpdateSearchText(update: MorningLiveUpdate): string {
  return normalizeForMatching(
    [
      update.source,
      update.trackedAccount,
      update.author,
      update.originalAuthor,
      update.repostedBy,
      update.replyTo,
      update.kind,
      update.timeLabel,
      update.text,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function matchingCompiledLiveUpdateFilters(
  update: MorningLiveUpdate,
  filters: CompiledLiveUpdateFilter[],
): CompiledLiveUpdateFilter[] {
  if (!filters.length) {
    return [];
  }
  return matchingCompiledFiltersFromText(liveUpdateSearchText(update), filters);
}

export function matchingCompiledFiltersFromText(
  normalizedText: string,
  filters: CompiledLiveUpdateFilter[],
): CompiledLiveUpdateFilter[] {
  if (!filters.length) {
    return [];
  }
  const text = normalizeForMatching(normalizedText);
  return filters.filter((filter) => textContainsCompiledFilter(text, filter));
}

export function liveUpdateMatchesCompiledFilter(update: MorningLiveUpdate, filters: CompiledLiveUpdateFilter[]): boolean {
  return matchingCompiledLiveUpdateFilters(update, filters).length > 0;
}

export function alertableNewLiveUpdatesCompiled(
  updates: MorningLiveUpdate[],
  previousIds: Set<string>,
  filters: CompiledLiveUpdateFilter[],
): MorningLiveUpdate[] {
  return updates.filter((update) => !previousIds.has(update.id) && liveUpdateMatchesCompiledFilter(update, filters));
}

export function alertableNewLiveUpdates(
  updates: MorningLiveUpdate[],
  previousIds: Set<string>,
  filters: string[],
): MorningLiveUpdate[] {
  return alertableNewLiveUpdatesCompiled(updates, previousIds, compileLiveUpdateFilters(filters));
}

function normalizeForMatching(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function textContainsCompiledFilter(text: string, filter: CompiledLiveUpdateFilter | undefined): boolean {
  if (!filter) {
    return false;
  }
  if (filter.pattern) {
    return filter.pattern.test(text);
  }
  return text.includes(filter.normalized);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
