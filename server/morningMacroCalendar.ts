import type { MorningBriefSource, MorningCalendarEvent, MorningCalendarSource, MorningMajorEvent } from "../shared/types.ts";

export const BLS_RELEASE_CALENDAR_URL = "https://www.bls.gov/schedule/news_release/bls.ics";
export const BEA_RELEASE_SCHEDULE_URL = "https://www.bea.gov/news/schedule/full";
export const CENSUS_RELEASE_SCHEDULE_URL = "https://www.census.gov/economic-indicators/calendar-listview.html";
export const DOL_CLAIMS_SCHEDULE_URL = "https://oui.doleta.gov/unemploy/archive.asp";
export const FED_FOMC_CALENDAR_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
export const FED_CALENDAR_URL = "https://www.federalreserve.gov/newsevents/calendar.htm";
export const ISM_RELEASE_CALENDAR_URL = "https://www.ismworld.org/supply-management-news-and-reports/reports/rob-report-calendar/";
export const TREASURY_ANNOUNCED_AUCTIONS_URL = "https://www.treasurydirect.gov/TA_WS/securities/announced?format=json";
export const EIA_WPSR_SCHEDULE_URL = "https://www.eia.gov/petroleum/supply/weekly/schedule.php";
export const MBA_WEEKLY_APPLICATIONS_URL = "https://www.mba.org/news-and-research/research-and-economics/single-family-research/weekly-applications-survey";
export const ADP_EMPLOYMENT_REPORT_URL = "https://adpemploymentreport.com/";
export const NAR_RELEASE_SCHEDULE_URL = "https://www.nar.realtor/newsroom/nar-releases-2026-statistical-news-release-schedule";
export const UMICH_SURVEY_INFO_URL = "https://data.sca.isr.umich.edu/survey-info.php";
export const NYFED_EMPIRE_STATE_SURVEY_URL = "https://www.newyorkfed.org/survey/empire/empiresurvey_overview.html";
export const NAHB_HMI_RELEASE_DATES_URL = "https://www.nahb.org/News-and-Economics/Housing-Economics/Indices/NAHB-Wells-Fargo-Housing-Market-Index-Release-Dates";
export const API_WSB_SCHEDULE_URL = "https://www.api.org/energy-insights/statistics/wsb";

export type UsMacroFetchText = (url: string) => Promise<{ text: string; status?: number }>;

export type UsMacroSource = Exclude<MorningCalendarSource, "RollCall">;

export type UsMacroRawEvent = {
  coverage?: string;
  date: string;
  detail?: string;
  source: UsMacroSource;
  sortMinute: number | null;
  timeLabel: string;
  title: string;
  url: string;
};

export type UsMacroUnratedEvent = Pick<UsMacroRawEvent, "date" | "source" | "timeLabel" | "title">;

export type UsMacroCalendarResult = {
  items: MorningCalendarEvent[];
  rawCount: number;
  source: MorningBriefSource;
  unrated: UsMacroUnratedEvent[];
  warnings: string[];
};

type UsMacroEventRating = {
  aliases: RegExp[];
  components?: UsMacroEventComponent[];
  displayTitle?: string;
  impact: "medium" | "high";
  kind: MorningMajorEvent["kind"];
  major: boolean;
  sources?: UsMacroSource[];
};

type UsMacroEventComponent = {
  impact: "medium" | "high";
  kind: MorningMajorEvent["kind"];
  major: boolean;
  title: string;
};

export const US_MACRO_EVENT_RATINGS = {
  "consumer-price-index": {
    aliases: [/\bconsumer price index\b/i],
    components: [
      { impact: "high", kind: "inflation", major: true, title: "Inflation Rate YoY" },
      { impact: "high", kind: "inflation", major: true, title: "Inflation Rate MoM" },
      { impact: "high", kind: "inflation", major: true, title: "Core Inflation Rate YoY" },
      { impact: "high", kind: "inflation", major: true, title: "Core Inflation Rate MoM" },
      { impact: "medium", kind: "inflation", major: false, title: "CPI" },
      { impact: "medium", kind: "inflation", major: false, title: "CPI s.a" },
    ],
    displayTitle: "Consumer Price Index",
    impact: "high",
    kind: "inflation",
    major: true,
    sources: ["BLS"],
  },
  "inflation-rate": {
    aliases: [/\binflation rate (?:yoy|mom)\b/i, /\bcore inflation rate (?:yoy|mom)\b/i],
    impact: "high",
    kind: "inflation",
    major: true,
    sources: ["BLS"],
  },
  "cpi-index-level": {
    aliases: [/\bcpi\b/i, /\bcpi s\.?a\.?\b/i],
    impact: "medium",
    kind: "inflation",
    major: false,
    sources: ["BLS"],
  },
  "core-ppi-mom": {
    aliases: [/\bcore ppi mom\b/i],
    displayTitle: "Core PPI MoM",
    impact: "medium",
    kind: "inflation",
    major: false,
    sources: ["BLS"],
  },
  "ppi-mom": {
    aliases: [/\bppi mom\b/i],
    displayTitle: "PPI MoM",
    impact: "high",
    kind: "inflation",
    major: true,
    sources: ["BLS"],
  },
  "producer-price-index": {
    aliases: [/\bproducer price index\b/i],
    components: [
      { impact: "high", kind: "inflation", major: true, title: "PPI MoM" },
      { impact: "medium", kind: "inflation", major: false, title: "Core PPI MoM" },
    ],
    displayTitle: "Producer Price Index",
    impact: "high",
    kind: "inflation",
    major: true,
    sources: ["BLS"],
  },
  "non-farm-payrolls": {
    aliases: [/\bnon[-\s]?farm payrolls?\b/i],
    displayTitle: "Non Farm Payrolls",
    impact: "high",
    kind: "jobs",
    major: true,
    sources: ["BLS"],
  },
  "unemployment-rate": {
    aliases: [/\bunemployment rate\b/i],
    displayTitle: "Unemployment Rate",
    impact: "high",
    kind: "jobs",
    major: true,
    sources: ["BLS"],
  },
  "employment-situation": {
    aliases: [/\bemployment situation\b/i],
    components: [
      { impact: "high", kind: "jobs", major: true, title: "Non Farm Payrolls" },
      { impact: "high", kind: "jobs", major: true, title: "Unemployment Rate" },
      { impact: "medium", kind: "jobs", major: false, title: "Average Hourly Earnings YoY" },
      { impact: "medium", kind: "jobs", major: false, title: "Average Hourly Earnings MoM" },
      { impact: "medium", kind: "jobs", major: false, title: "Participation Rate" },
    ],
    displayTitle: "Employment Situation",
    impact: "high",
    kind: "jobs",
    major: true,
    sources: ["BLS"],
  },
  "average-hourly-earnings-yoy": {
    aliases: [/\baverage hourly earnings yoy\b/i],
    displayTitle: "Average Hourly Earnings YoY",
    impact: "medium",
    kind: "jobs",
    major: false,
    sources: ["BLS"],
  },
  "average-hourly-earnings-mom": {
    aliases: [/\baverage hourly earnings mom\b/i],
    displayTitle: "Average Hourly Earnings MoM",
    impact: "medium",
    kind: "jobs",
    major: false,
    sources: ["BLS"],
  },
  "participation-rate": {
    aliases: [/\bparticipation rate\b/i, /\blabor force participation\b/i],
    displayTitle: "Participation Rate",
    impact: "medium",
    kind: "jobs",
    major: false,
    sources: ["BLS"],
  },
  "jolts": {
    aliases: [/\bjob openings and labor turnover\b/i, /\bjolts\b/i],
    displayTitle: "JOLTS Job Openings",
    impact: "high",
    kind: "jobs",
    major: true,
    sources: ["BLS"],
  },
  "jobless-claims": {
    aliases: [/\binitial jobless claims\b/i, /\bweekly claims\b/i, /\bunemployment insurance weekly claims\b/i],
    displayTitle: "Initial Jobless Claims",
    impact: "medium",
    kind: "jobs",
    major: false,
    sources: ["DOL"],
  },
  "adp-employment-change": {
    aliases: [/\badp employment change(?: weekly)?\b/i, /\badp employment\b/i, /\badp national employment\b/i],
    displayTitle: "ADP Employment Change",
    impact: "medium",
    kind: "jobs",
    major: false,
    sources: ["ADP"],
  },
  "mba-mortgage-rate": {
    aliases: [/\bmba 30-year mortgage rate\b/i, /\b30-year mortgage rate\b/i, /\bmortgage rate\b/i],
    displayTitle: "MBA 30-Year Mortgage Rate",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["MBA"],
  },
  "personal-income-outlays": {
    aliases: [/\bpersonal income and outlays\b/i, /\bpce\b/i, /\bpersonal consumption expenditures\b/i],
    displayTitle: "Personal Income and Outlays",
    impact: "high",
    kind: "inflation",
    major: true,
    sources: ["BEA"],
  },
  "gross-domestic-product": {
    aliases: [/\bgross domestic product\b/i, /\bgdp\b/i],
    displayTitle: "GDP",
    impact: "high",
    kind: "macro",
    major: true,
    sources: ["BEA"],
  },
  "trade-balance": {
    aliases: [/\bbalance of trade\b/i],
    displayTitle: "Balance of Trade",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["BEA", "Census"],
  },
  "trade-report-aggregate": {
    aliases: [/\binternational trade\b/i, /\btrade in goods and services\b/i, /\badvance economic indicators\b/i],
    components: [
      { impact: "medium", kind: "macro", major: false, title: "Balance of Trade" },
      { impact: "medium", kind: "macro", major: false, title: "Imports" },
      { impact: "medium", kind: "macro", major: false, title: "Exports" },
    ],
    displayTitle: "U.S. Trade Balance",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["BEA", "Census"],
  },
  "imports": {
    aliases: [/\bimports\b/i],
    displayTitle: "Imports",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["BEA", "Census"],
  },
  "exports": {
    aliases: [/\bexports\b/i],
    displayTitle: "Exports",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["BEA", "Census"],
  },
  "retail-sales": {
    aliases: [/\badvance monthly sales\b/i, /\bretail and food services\b/i, /\bretail sales\b/i],
    displayTitle: "Retail Sales",
    impact: "high",
    kind: "macro",
    major: true,
    sources: ["Census"],
  },
  "housing-starts-mom": {
    aliases: [/\bhousing starts mom\b/i, /\bhousing starts m\/m\b/i],
    displayTitle: "Housing Starts MoM",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["Census"],
  },
  "building-permits-mom": {
    aliases: [/\bbuilding permits mom(?: prel)?\b/i, /\bbuilding permits m\/m(?: prel)?\b/i],
    displayTitle: "Building Permits MoM Prel",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["Census"],
  },
  "housing-starts-headline": {
    aliases: [/\bhousing starts\b/i],
    displayTitle: "Housing Starts",
    impact: "high",
    kind: "macro",
    major: true,
    sources: ["Census"],
  },
  "building-permits-headline": {
    aliases: [/\bbuilding permits(?: prel)?\b/i],
    displayTitle: "Building Permits Prel",
    impact: "high",
    kind: "macro",
    major: true,
    sources: ["Census"],
  },
  "housing-starts": {
    aliases: [/\bnew residential construction\b/i],
    components: [
      { impact: "high", kind: "macro", major: true, title: "Housing Starts" },
      { impact: "high", kind: "macro", major: true, title: "Building Permits Prel" },
      { impact: "medium", kind: "macro", major: false, title: "Housing Starts MoM" },
      { impact: "medium", kind: "macro", major: false, title: "Building Permits MoM Prel" },
    ],
    displayTitle: "Housing Starts / Building Permits",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["Census"],
  },
  "new-home-sales": {
    aliases: [/\bnew residential sales\b/i, /\bnew home sales\b/i],
    displayTitle: "New Home Sales",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["Census"],
  },
  "import-prices": {
    aliases: [/\bimport prices mom\b/i, /\bimport price index\b/i],
    displayTitle: "Import Prices MoM",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["BLS"],
  },
  "import-export-prices": {
    aliases: [/\bimport and export price indexes\b/i, /\bu\.s\. import and export price indexes\b/i],
    components: [
      { impact: "medium", kind: "macro", major: false, title: "Import Prices MoM" },
      { impact: "medium", kind: "macro", major: false, title: "Export Prices MoM" },
    ],
    displayTitle: "Import / Export Prices",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["BLS"],
  },
  "export-prices": {
    aliases: [/\bexport prices mom\b/i, /\bexport price index\b/i],
    displayTitle: "Export Prices MoM",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["BLS"],
  },
  "durable-goods": {
    aliases: [/\bdurable goods\b/i, /\bfactory orders\b/i, /\bmanufacturers'? shipments\b/i, /\bmanufacturers'? orders\b/i],
    displayTitle: "Factory Orders MoM",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["Census"],
  },
  "construction-spending": {
    aliases: [/\bconstruction spending\b/i],
    displayTitle: "Construction Spending",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["Census"],
  },
  "existing-home-sales-mom": {
    aliases: [/\bexisting home sales mom\b/i, /\bexisting home sales m\/m\b/i],
    displayTitle: "Existing Home Sales MoM",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["NAR"],
  },
  "existing-home-sales": {
    aliases: [/\bexisting home sales\b/i],
    displayTitle: "Existing Home Sales",
    impact: "high",
    kind: "macro",
    major: true,
    sources: ["NAR"],
  },
  "michigan-sentiment": {
    aliases: [/\bmichigan consumer sentiment prel\b/i, /\bmichigan consumer sentiment\b/i, /\buniversity of michigan sentiment\b/i],
    displayTitle: "Michigan Consumer Sentiment Prel",
    impact: "high",
    kind: "macro",
    major: true,
    sources: ["UMich"],
  },
  "ny-empire-state": {
    aliases: [/\bny empire state manufacturing index\b/i, /\bempire state manufacturing\b/i],
    displayTitle: "NY Empire State Manufacturing Index",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["NYFed"],
  },
  "industrial-production": {
    aliases: [/\bindustrial production mom\b/i, /\bindustrial production\b/i],
    displayTitle: "Industrial Production MoM",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["Fed"],
  },
  "nahb-housing-market": {
    aliases: [/\bnahb housing market index\b/i],
    displayTitle: "NAHB Housing Market Index",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["NAHB"],
  },
  "fomc-rate-decision": {
    aliases: [/\bfomc rate decision\b/i, /\bfomc statement\b/i, /\binterest rate decision\b/i],
    displayTitle: "FOMC Rate Decision",
    impact: "high",
    kind: "fomc",
    major: true,
    sources: ["Fed"],
  },
  "fomc-press-conference": {
    aliases: [/\bfomc press conference\b/i, /\bpress conference\b/i],
    displayTitle: "FOMC Press Conference",
    impact: "high",
    kind: "fomc",
    major: true,
    sources: ["Fed"],
  },
  "fomc-minutes": {
    aliases: [/\bfomc minutes\b/i, /\bminutes\b/i],
    displayTitle: "FOMC Minutes",
    impact: "high",
    kind: "fomc",
    major: true,
    sources: ["Fed"],
  },
  "fed-speaker": {
    aliases: [/\bfed\b/i, /\bfederal reserve\b/i, /\bchair\b/i, /\bgovernor\b/i, /\bspeech\b/i, /\btestimony\b/i],
    impact: "medium",
    kind: "fomc",
    major: false,
    sources: ["Fed"],
  },
  "ism-manufacturing": {
    aliases: [/\bism manufacturing\b/i, /\bmanufacturing pmi\b/i],
    displayTitle: "ISM Manufacturing PMI",
    impact: "high",
    kind: "macro",
    major: true,
    sources: ["ISM"],
  },
  "ism-services": {
    aliases: [/\bism services\b/i, /\bservices pmi\b/i, /\bnon-manufacturing\b/i],
    displayTitle: "ISM Services PMI",
    impact: "high",
    kind: "macro",
    major: true,
    sources: ["ISM"],
  },
  "treasury-auction": {
    aliases: [/\btreasury\b/i, /\bnote auction\b/i, /\bbond auction\b/i, /\btips auction\b/i],
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["Treasury"],
  },
  "eia-wpsr": {
    aliases: [/\bweekly petroleum status\b/i],
    components: [
      { impact: "medium", kind: "macro", major: false, title: "EIA Crude Oil Stocks Change" },
      { impact: "medium", kind: "macro", major: false, title: "EIA Gasoline Stocks Change" },
    ],
    displayTitle: "EIA Weekly Petroleum Status Report",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["EIA"],
  },
  "eia-crude-inventories": {
    aliases: [/\bcrude oil stocks? change\b/i, /\bcrude oil inventories\b/i],
    displayTitle: "EIA Crude Oil Stocks Change",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["EIA"],
  },
  "eia-gasoline-inventories": {
    aliases: [/\bgasoline stocks? change\b/i, /\bgasoline inventories\b/i],
    displayTitle: "EIA Gasoline Stocks Change",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["EIA"],
  },
  "api-crude-inventories": {
    aliases: [/\bapi crude oil stock change\b/i, /\bapi crude inventories\b/i],
    displayTitle: "API Crude Oil Stock Change",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["API"],
  },
  "monthly-budget-statement": {
    aliases: [/\bmonthly budget statement\b/i],
    displayTitle: "Monthly Budget Statement",
    impact: "medium",
    kind: "macro",
    major: false,
    sources: ["Treasury"],
  },
} satisfies Record<string, UsMacroEventRating>;

type AdapterResult = {
  items: UsMacroRawEvent[];
  source: UsMacroSource;
  warning?: string;
};

type TreasuryAuctionRow = {
  auctionDate?: unknown;
  closingTimeCompetitive?: unknown;
  securityTerm?: unknown;
  securityType?: unknown;
};

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const FED_MONTH_URL_SLUGS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const MONTH_ABBREVIATIONS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const UMICH_PRELIMINARY_SENTIMENT_DATES_BY_YEAR: Record<number, string[]> = {
  2026: [
    "2026-01-09",
    "2026-02-06",
    "2026-03-13",
    "2026-04-10",
    "2026-05-08",
    "2026-06-12",
    "2026-07-17",
    "2026-08-14",
    "2026-09-11",
    "2026-10-09",
    "2026-11-06",
    "2026-12-04",
  ],
};

export async function readUsMacroCalendar(fetchText: UsMacroFetchText, start: string, endExclusive: string): Promise<UsMacroCalendarResult> {
  const adapterResults = await Promise.all([
    readFetchedAdapter("BLS", BLS_RELEASE_CALENDAR_URL, fetchText, (text) => parseBlsIcsCalendar(text, start, endExclusive)),
    readFetchedAdapter("BEA", BEA_RELEASE_SCHEDULE_URL, fetchText, (text) => parseBeaReleaseSchedule(text, start, endExclusive)),
    readFetchedAdapter("Census", CENSUS_RELEASE_SCHEDULE_URL, fetchText, (text) => parseCensusReleaseSchedule(text, start, endExclusive)),
    readDolClaimsAdapter(fetchText, start, endExclusive),
    readFetchedAdapter("Fed", FED_FOMC_CALENDAR_URL, fetchText, (text) => parseFedFomcCalendar(text, start, endExclusive)),
    readFedBoardCalendarAdapter(fetchText, start, endExclusive),
    Promise.resolve<AdapterResult>({ items: generateIsmCalendarEvents(start, endExclusive), source: "ISM" }),
    readFetchedAdapter("Treasury", TREASURY_ANNOUNCED_AUCTIONS_URL, fetchText, (text) => parseTreasuryAuctions(text, start, endExclusive)),
    readEiaWpsrAdapter(fetchText, start, endExclusive),
    Promise.resolve<AdapterResult>({ items: generateMbaMortgageEvents(start, endExclusive), source: "MBA" }),
    Promise.resolve<AdapterResult>({ items: generateAdpEmploymentEvents(start, endExclusive), source: "ADP" }),
    readFetchedAdapter("NAR", NAR_RELEASE_SCHEDULE_URL, fetchText, (text) => parseNarReleaseSchedule(text, start, endExclusive)),
    readUmichSentimentAdapter(start, endExclusive),
    readFetchedAdapter("NYFed", NYFED_EMPIRE_STATE_SURVEY_URL, fetchText, (text) => parseNyFedEmpireStateCalendar(text, start, endExclusive)),
    readFetchedAdapter("NAHB", NAHB_HMI_RELEASE_DATES_URL, fetchText, (text) => parseNahbHmiReleaseDates(text, start, endExclusive)),
    Promise.resolve<AdapterResult>({ items: generateApiWsbEvents(start, endExclusive), source: "API" }),
  ]);
  const rawEvents = uniqueRawEvents(adapterResults.flatMap((result) => result.items));
  const normalized = normalizeUsMacroEvents(rawEvents);
  const warnings = adapterResults.map((result) => result.warning).filter((item): item is string => Boolean(item));
  const countsBySource = countBySource(normalized.items);
  const ratedSummary = Object.entries(countsBySource)
    .map(([source, count]) => `${source} ${count}`)
    .join(", ");
  const hiddenBySource = countUnratedBySource(normalized.unrated);
  const hiddenSummary = Object.entries(hiddenBySource)
    .map(([source, count]) => `${source} ${count}`)
    .join(", ");
  const details = [
    normalized.items.length
      ? `Pulled ${normalized.items.length} rated SPX macro event${normalized.items.length === 1 ? "" : "s"} for ${start} to ${addDays(endExclusive, -1)}${ratedSummary ? ` (${ratedSummary})` : ""}.`
      : `No rated SPX macro events found for ${start} to ${addDays(endExclusive, -1)}.`,
    normalized.unrated.length ? `Hid ${normalized.unrated.length} unrated official row${normalized.unrated.length === 1 ? "" : "s"}${hiddenSummary ? ` (${hiddenSummary})` : ""}.` : "",
    ...warnings.slice(0, 4),
    warnings.length > 4 ? `${warnings.length - 4} additional source warning${warnings.length - 4 === 1 ? "" : "s"}.` : "",
  ].filter(Boolean);

  return {
    items: normalized.items,
    rawCount: rawEvents.length,
    source: {
      detail: details.join(" "),
      label: "US macro calendar",
      status: normalized.items.length && warnings.length === 0 ? "ok" : "warning",
      url: FED_CALENDAR_URL,
    },
    unrated: normalized.unrated,
    warnings,
  };
}

export function parseBlsIcsCalendar(text: string, start: string, endExclusive: string): UsMacroRawEvent[] {
  return parseIcsEvents(text).flatMap((event): UsMacroRawEvent[] => {
    const startedAt = parseIcsDateTime(event.DTSTART ?? "");
    if (!startedAt || !isWithinRange(startedAt.date, start, endExclusive)) {
      return [];
    }
    return [
      {
        date: startedAt.date,
        detail: "BLS release schedule",
        source: "BLS",
        sortMinute: startedAt.sortMinute,
        timeLabel: startedAt.timeLabel,
        title: event.SUMMARY ?? "",
        url: BLS_RELEASE_CALENDAR_URL,
      },
    ];
  });
}

export function parseBeaReleaseSchedule(html: string, start: string, endExclusive: string): UsMacroRawEvent[] {
  const year = Number.parseInt(start.slice(0, 4), 10);
  const startMonth = Number.parseInt(start.slice(5, 7), 10);
  return htmlRows(html).flatMap((row): UsMacroRawEvent[] => {
    const dateText = cleanText(row.match(/<div class="release-date">([\s\S]*?)<\/div>/i)?.[1] ?? "");
    const timeLabel = normalizeTimeLabel(cleanText(row.match(/<small[^>]*>([\s\S]*?)<\/small>/i)?.[1] ?? "")) ?? "Time TBD";
    const title = cleanText(row.match(/<td[^>]*class="[^"]*release-title[^"]*"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "");
    const parsedDate = parseMonthDayDate(dateText, resolveYearForMonth(dateText, year, startMonth));
    if (!title || !parsedDate || !isWithinRange(parsedDate, start, endExclusive)) {
      return [];
    }
    return [
      {
        date: parsedDate,
        detail: "BEA release schedule",
        source: "BEA",
        sortMinute: parseTimeMinute(timeLabel),
        timeLabel,
        title,
        url: BEA_RELEASE_SCHEDULE_URL,
      },
    ];
  });
}

export function parseCensusReleaseSchedule(html: string, start: string, endExclusive: string): UsMacroRawEvent[] {
  return htmlRows(html).flatMap((row): UsMacroRawEvent[] => {
    const cells = htmlCells(row);
    if (cells.length < 3) {
      return [];
    }
    const title = cells[0];
    const date = parseFullDate(cells[1]);
    const timeLabel = normalizeTimeLabel(cells[2]) ?? "Time TBD";
    if (!title || !date || !isWithinRange(date, start, endExclusive)) {
      return [];
    }
    return [
      {
        coverage: cells[3] ? `Reference period ${cells[3]}` : undefined,
        date,
        detail: "Census economic indicators calendar",
        source: "Census",
        sortMinute: parseTimeMinute(timeLabel),
        timeLabel,
        title,
        url: CENSUS_RELEASE_SCHEDULE_URL,
      },
    ];
  });
}

export function parseDolClaimsExceptions(html: string): Map<string, string> {
  const result = new Map<string, string>();
  const text = cleanText(html);
  const pattern = /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday),\s+([A-Z][a-z]+ \d{1,2}, \d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\s+EST/gi;
  for (const match of text.matchAll(pattern)) {
    const date = parseFullDate(match[1]);
    const timeLabel = normalizeTimeLabel(match[2]);
    if (date && timeLabel) {
      result.set(date, timeLabel);
    }
  }
  return result;
}

export function generateDolClaimsEvents(start: string, endExclusive: string, exceptions = new Map<string, string>()): UsMacroRawEvent[] {
  const exceptionWeeks = new Set([...exceptions.keys()].map(weekStartMonday));
  const events: UsMacroRawEvent[] = [];
  for (const [date, timeLabel] of exceptions) {
    if (isWithinRange(date, start, endExclusive)) {
      events.push({
        date,
        detail: "DOL weekly claims alternate release date",
        source: "DOL",
        sortMinute: parseTimeMinute(timeLabel),
        timeLabel,
        title: "Initial Jobless Claims",
        url: DOL_CLAIMS_SCHEDULE_URL,
      });
    }
  }
  for (const date of eachDate(start, endExclusive)) {
    if (utcDay(date) !== 4 || exceptionWeeks.has(weekStartMonday(date))) {
      continue;
    }
    events.push({
      date,
      detail: "DOL weekly claims release schedule",
      source: "DOL",
      sortMinute: parseTimeMinute("8:30 AM"),
      timeLabel: "8:30 AM",
      title: "Initial Jobless Claims",
      url: DOL_CLAIMS_SCHEDULE_URL,
    });
  }
  return events;
}

export function parseFedFomcCalendar(html: string, start: string, endExclusive: string): UsMacroRawEvent[] {
  const events: UsMacroRawEvent[] = [];
  const panelPattern = /<h4><a[^>]*>(\d{4}) FOMC Meetings<\/a><\/h4><\/div>([\s\S]*?)(?=<div class="panel panel-default"><div class="panel-heading"><h4>|$)/gi;
  for (const panelMatch of html.matchAll(panelPattern)) {
    const year = Number.parseInt(panelMatch[1], 10);
    const panel = panelMatch[2];
    const rowPattern = /<div class="[^"]*fomc-meeting__month[^"]*"[^>]*>\s*<strong>([^<]+)<\/strong><\/div>\s*<div class="[^"]*fomc-meeting__date[^"]*"[^>]*>([^<]+)<\/div>([\s\S]*?)(?=<div class="[^"]*fomc-meeting__month|$)/gi;
    for (const rowMatch of panel.matchAll(rowPattern)) {
      const month = MONTHS[rowMatch[1].trim().toLowerCase()];
      const decisionDay = lastDayFromRange(rowMatch[2]);
      if (!month || !decisionDay) {
        continue;
      }
      const decisionDate = isoDate(year, month, decisionDay);
      if (isWithinRange(decisionDate, start, endExclusive)) {
        events.push({
          date: decisionDate,
          detail: "Federal Reserve FOMC calendar",
          source: "Fed",
          sortMinute: parseTimeMinute("2:00 PM"),
          timeLabel: "2:00 PM",
          title: "FOMC Rate Decision",
          url: FED_FOMC_CALENDAR_URL,
        });
        if (/Press Conference/i.test(rowMatch[3])) {
          events.push({
            date: decisionDate,
            detail: "Federal Reserve FOMC calendar",
            source: "Fed",
            sortMinute: parseTimeMinute("2:30 PM"),
            timeLabel: "2:30 PM",
            title: "FOMC Press Conference",
            url: FED_FOMC_CALENDAR_URL,
          });
        }
      }
      const minutesMatch = rowMatch[3].match(/\(Released ([A-Z][a-z]+ \d{1,2}, \d{4})\)/i);
      const minutesDate = minutesMatch ? parseFullDate(minutesMatch[1]) : null;
      if (minutesDate && isWithinRange(minutesDate, start, endExclusive)) {
        events.push({
          date: minutesDate,
          detail: "Federal Reserve FOMC minutes release",
          source: "Fed",
          sortMinute: parseTimeMinute("2:00 PM"),
          timeLabel: "2:00 PM",
          title: "FOMC Minutes",
          url: FED_FOMC_CALENDAR_URL,
        });
      }
    }
  }
  return events;
}

export function parseFedBoardCalendar(html: string, year: number, month: number, start: string, endExclusive: string, url: string): UsMacroRawEvent[] {
  const events: UsMacroRawEvent[] = [];
  const rowPattern = /<div class="col-xs-2">\s*<p>([\s\S]*?)<\/p>\s*<\/div>\s*<div class="col-xs-7">([\s\S]*?)<\/div>\s*<div class="col-xs-3">\s*<p>(\d{1,2})<\/p>/gi;
  for (const match of html.matchAll(rowPattern)) {
    const timeLabel = normalizeTimeLabel(cleanText(match[1])) ?? "Time TBD";
    const content = match[2];
    const firstLine = cleanText(content.match(/<p>([\s\S]*?)<\/p>/i)?.[1] ?? "");
    const topic = cleanText(content.match(/<p class=['"]calendar__title['"]><em>([\s\S]*?)<\/em><\/p>/i)?.[1] ?? "");
    const day = Number.parseInt(match[3], 10);
    const date = isoDate(year, month, day);
    if (!isWithinRange(date, start, endExclusive) || !isFedSpeechEvent(firstLine)) {
      continue;
    }
    events.push({
      coverage: topic || undefined,
      date,
      detail: "Federal Reserve public calendar",
      source: "Fed",
      sortMinute: parseTimeMinute(timeLabel),
      timeLabel,
      title: topic ? `${firstLine}: ${topic}` : firstLine,
      url,
    });
  }
  return events;
}

export function generateIsmCalendarEvents(start: string, endExclusive: string): UsMacroRawEvent[] {
  const months = monthsInRange(start, endExclusive);
  const events: UsMacroRawEvent[] = [];
  for (const { month, year } of months) {
    const businessDays = businessDaysInMonth(year, month);
    const manufacturing = businessDays[0];
    const services = businessDays[2];
    if (manufacturing && isWithinRange(manufacturing, start, endExclusive)) {
      events.push({
        date: manufacturing,
        detail: "Generated from ISM first-business-day release rule",
        source: "ISM",
        sortMinute: parseTimeMinute("10:00 AM"),
        timeLabel: "10:00 AM",
        title: "ISM Manufacturing PMI",
        url: ISM_RELEASE_CALENDAR_URL,
      });
    }
    if (services && isWithinRange(services, start, endExclusive)) {
      events.push({
        date: services,
        detail: "Generated from ISM third-business-day release rule",
        source: "ISM",
        sortMinute: parseTimeMinute("10:00 AM"),
        timeLabel: "10:00 AM",
        title: "ISM Services PMI",
        url: ISM_RELEASE_CALENDAR_URL,
      });
    }
  }
  return events;
}

export function parseTreasuryAuctions(text: string, start: string, endExclusive: string): UsMacroRawEvent[] {
  let rows: TreasuryAuctionRow[];
  try {
    rows = JSON.parse(text) as TreasuryAuctionRow[];
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.flatMap((row): UsMacroRawEvent[] => {
    const securityType = firstText(row.securityType);
    const securityTerm = firstText(row.securityTerm);
    const date = firstText(row.auctionDate).slice(0, 10);
    const timeLabel = normalizeTimeLabel(firstText(row.closingTimeCompetitive)) ?? "1:00 PM";
    if (!isTreasuryCouponAuction(securityType, securityTerm) || !isWithinRange(date, start, endExclusive)) {
      return [];
    }
    return [
      {
        coverage: `${securityTerm} ${securityType}`,
        date,
        detail: "TreasuryDirect announced auction",
        source: "Treasury",
        sortMinute: parseTimeMinute(timeLabel),
        timeLabel,
        title: `${securityTerm} ${securityType} Auction`,
        url: TREASURY_ANNOUNCED_AUCTIONS_URL,
      },
    ];
  });
}

export function parseEiaWpsrExceptions(html: string): Map<string, string> {
  const exceptions = new Map<string, string>();
  for (const row of htmlRows(html)) {
    const cells = htmlCells(row);
    if (cells.length < 4) {
      continue;
    }
    const releaseDate = parseFullDate(cells[1]);
    const timeLabel = normalizeTimeLabel(cells[3]);
    if (releaseDate && timeLabel) {
      exceptions.set(releaseDate, timeLabel);
    }
  }
  return exceptions;
}

export function generateEiaWpsrEvents(start: string, endExclusive: string, exceptions = new Map<string, string>()): UsMacroRawEvent[] {
  const exceptionWeeks = new Set([...exceptions.keys()].map(weekStartMonday));
  const events: UsMacroRawEvent[] = [];
  for (const [date, timeLabel] of exceptions) {
    if (isWithinRange(date, start, endExclusive)) {
      events.push({
        date,
        detail: "EIA holiday-adjusted WPSR release date",
        source: "EIA",
        sortMinute: parseTimeMinute(timeLabel),
        timeLabel,
        title: "Weekly Petroleum Status Report",
        url: EIA_WPSR_SCHEDULE_URL,
      });
    }
  }
  for (const date of eachDate(start, endExclusive)) {
    if (utcDay(date) !== 3 || exceptionWeeks.has(weekStartMonday(date))) {
      continue;
    }
    events.push({
      date,
      detail: "EIA Weekly Petroleum Status Report release schedule",
      source: "EIA",
      sortMinute: parseTimeMinute("10:30 AM"),
      timeLabel: "10:30 AM",
      title: "Weekly Petroleum Status Report",
      url: EIA_WPSR_SCHEDULE_URL,
    });
  }
  return events;
}

export function generateMbaMortgageEvents(start: string, endExclusive: string): UsMacroRawEvent[] {
  return eachDate(start, endExclusive)
    .filter((date) => utcDay(date) === 3)
    .map((date) => ({
      date,
      detail: "Generated from MBA Wednesday weekly release rule",
      source: "MBA",
      sortMinute: parseTimeMinute("7:00 AM"),
      timeLabel: "7:00 AM",
      title: "MBA 30-Year Mortgage Rate",
      url: MBA_WEEKLY_APPLICATIONS_URL,
    }));
}

export function generateAdpEmploymentEvents(start: string, endExclusive: string): UsMacroRawEvent[] {
  const events: UsMacroRawEvent[] = [];
  for (const date of eachDate(start, endExclusive)) {
    if (utcDay(date) === 2) {
      events.push({
        date,
        detail: "Generated from ADP weekly preliminary release rule",
        source: "ADP",
        sortMinute: parseTimeMinute("8:15 AM"),
        timeLabel: "8:15 AM",
        title: "ADP Employment Change Weekly",
        url: ADP_EMPLOYMENT_REPORT_URL,
      });
    }
    if (utcDay(date) === 3 && Number.parseInt(date.slice(8, 10), 10) <= 7) {
      events.push({
        date,
        detail: "Generated from ADP first-Wednesday monthly release rule",
        source: "ADP",
        sortMinute: parseTimeMinute("8:15 AM"),
        timeLabel: "8:15 AM",
        title: "ADP Employment Change",
        url: ADP_EMPLOYMENT_REPORT_URL,
      });
    }
  }
  return events;
}

export function parseNarReleaseSchedule(html: string, start: string, endExclusive: string): UsMacroRawEvent[] {
  const text = cleanText(html).replace(/\u2011/g, "-");
  const scheduleYear = Number.parseInt(text.match(/\b(20\d{2})\s+statistical news release schedule\b/i)?.[1] ?? start.slice(0, 4), 10);
  const events: UsMacroRawEvent[] = [];
  const pattern = /\b(?:Mon|Tue|Wed|Thu|Fri)(?:day)?\.?,?\s+([A-Z][a-z]+)\s+(\d{1,2})\s+([^.;]*?Existing[-\s]Home Sales)\b/gi;
  for (const match of text.matchAll(pattern)) {
    const date = parseMonthDayDate(`${match[1]} ${match[2]}`, scheduleYear);
    if (!date || !isWithinRange(date, start, endExclusive)) {
      continue;
    }
    events.push({
      date,
      detail: "NAR statistical news release schedule",
      source: "NAR",
      sortMinute: parseTimeMinute("10:00 AM"),
      timeLabel: "10:00 AM",
      title: "Existing Home Sales",
      url: NAR_RELEASE_SCHEDULE_URL,
    });
  }
  return events;
}

export function generateUmichSentimentEvents(start: string, endExclusive: string): UsMacroRawEvent[] {
  const events: UsMacroRawEvent[] = [];
  for (const year of yearsInRange(start, endExclusive)) {
    const releaseDates = UMICH_PRELIMINARY_SENTIMENT_DATES_BY_YEAR[year] ?? [];
    for (const date of releaseDates) {
      if (!isWithinRange(date, start, endExclusive)) {
        continue;
      }
      events.push({
        date,
        detail: "University of Michigan Surveys of Consumers 2026 release dates",
        source: "UMich",
        sortMinute: parseTimeMinute("10:00 AM"),
        timeLabel: "10:00 AM",
        title: "Michigan Consumer Sentiment Prel",
        url: UMICH_SURVEY_INFO_URL,
      });
    }
  }
  return events;
}

export function parseNyFedEmpireStateCalendar(html: string, start: string, endExclusive: string): UsMacroRawEvent[] {
  const text = cleanText(html);
  const events: UsMacroRawEvent[] = [];
  for (const year of yearsInRange(start, endExclusive)) {
    const releaseDays = nyFedEmpireReleaseDays(text, year);
    for (const [month, day] of releaseDays) {
      const date = isoDate(year, month, day);
      if (!isWithinRange(date, start, endExclusive)) {
        continue;
      }
      events.push({
        date,
        detail: "New York Fed Empire State Manufacturing Survey schedule",
        source: "NYFed",
        sortMinute: parseTimeMinute("8:30 AM"),
        timeLabel: "8:30 AM",
        title: "NY Empire State Manufacturing Index",
        url: NYFED_EMPIRE_STATE_SURVEY_URL,
      });
    }
  }
  return events;
}

export function parseNahbHmiReleaseDates(html: string, start: string, endExclusive: string): UsMacroRawEvent[] {
  const events: UsMacroRawEvent[] = [];
  for (const row of htmlRows(html)) {
    const cells = htmlCells(row);
    if (cells.length < 2 || !/\bHMI\b|\b20\d{2}\b/i.test(cells.join(" "))) {
      continue;
    }
    const date = parseFlexibleFullDate(cells[1]);
    if (!date || !isWithinRange(date, start, endExclusive)) {
      continue;
    }
    events.push(nahbHmiEvent(date));
  }
  if (events.length) {
    return events;
  }

  const text = cleanText(html);
  const pattern = /\b(?:Jan\.?|Feb\.?|Mar\.?|Apr\.?|May|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Sept\.?|Oct\.?|Nov\.?|Dec\.?|January|February|March|April|June|July|August|September|October|November|December)\s+20\d{2}\s+([A-Z][a-z]+\.?,?\s+\d{1,2},\s+20\d{2})\b/gi;
  for (const match of text.matchAll(pattern)) {
    const date = parseFlexibleFullDate(match[1]);
    if (date && isWithinRange(date, start, endExclusive)) {
      events.push(nahbHmiEvent(date));
    }
  }
  return events;
}

export function generateApiWsbEvents(start: string, endExclusive: string): UsMacroRawEvent[] {
  const events: UsMacroRawEvent[] = [];
  for (const date of eachDate(start, endExclusive)) {
    const releaseAfterNormalMonday = utcDay(date) === 2 && !isMondayFederalHoliday(addDays(date, -1));
    const releaseAfterHolidayMonday = utcDay(date) === 3 && isMondayFederalHoliday(addDays(date, -2));
    if (!releaseAfterNormalMonday && !releaseAfterHolidayMonday) {
      continue;
    }
    events.push({
      date,
      detail: releaseAfterHolidayMonday ? "Generated from API WSB Wednesday-after-Monday-holiday release rule" : "Generated from API WSB Tuesday weekly release rule",
      source: "API",
      sortMinute: parseTimeMinute("4:30 PM"),
      timeLabel: "4:30 PM",
      title: "API Crude Oil Stock Change",
      url: API_WSB_SCHEDULE_URL,
    });
  }
  return events;
}

export function normalizeUsMacroEvents(rawEvents: UsMacroRawEvent[]): {
  items: MorningCalendarEvent[];
  unrated: UsMacroUnratedEvent[];
} {
  const items: MorningCalendarEvent[] = [];
  const unrated: UsMacroUnratedEvent[] = [];
  for (const raw of rawEvents) {
    const ratingEntry = ratingForRawEvent(raw);
    if (!ratingEntry) {
      unrated.push({ date: raw.date, source: raw.source, timeLabel: raw.timeLabel, title: raw.title });
      continue;
    }
    const [key, rating] = ratingEntry;
    const displayTitle = displayTitleForRawEvent(raw, key, rating);
    const components = rating.components?.length ? rating.components : [{ impact: rating.impact, title: displayTitle }];
    for (const component of components) {
      const title = component.title;
      items.push({
        country: "US",
        coverage: raw.coverage ?? (title !== raw.title ? raw.title : undefined),
        date: raw.date,
        detail: raw.detail,
        id: `macro-${raw.source.toLowerCase()}-${raw.date}-${slug(`${raw.timeLabel}-${title}`)}`,
        impact: component.impact,
        source: raw.source,
        sortMinute: raw.sortMinute,
        timeLabel: raw.timeLabel,
        title,
        url: raw.url,
      });
    }
  }
  return {
    items: sortCalendarEvents(uniqueCalendarEvents(items)),
    unrated,
  };
}

export function isUsMacroMajorEvent(event: MorningCalendarEvent): event is MorningCalendarEvent & { impact: "high"; source: UsMacroSource } {
  if (event.impact !== "high" || !isUsMacroSource(event.source)) {
    return false;
  }
  const ratingEntry = ratingForText(`${event.title} ${event.detail ?? ""} ${event.coverage ?? ""}`, event.source);
  return Boolean(ratingEntry?.[1].major);
}

export function usMacroEventKind(event: MorningCalendarEvent): MorningMajorEvent["kind"] {
  if (!isUsMacroSource(event.source)) {
    return "macro";
  }
  return ratingForText(`${event.title} ${event.detail ?? ""} ${event.coverage ?? ""}`, event.source)?.[1].kind ?? "macro";
}

async function readFetchedAdapter(
  source: UsMacroSource,
  url: string,
  fetchText: UsMacroFetchText,
  parser: (text: string) => UsMacroRawEvent[],
): Promise<AdapterResult> {
  try {
    const result = await fetchText(url);
    return { items: parser(result.text), source };
  } catch (error) {
    return {
      items: [],
      source,
      warning: `${source} calendar failed: ${error instanceof Error ? error.message : String(error)}.`,
    };
  }
}

async function readDolClaimsAdapter(fetchText: UsMacroFetchText, start: string, endExclusive: string): Promise<AdapterResult> {
  try {
    const result = await fetchText(DOL_CLAIMS_SCHEDULE_URL);
    return { items: generateDolClaimsEvents(start, endExclusive, parseDolClaimsExceptions(result.text)), source: "DOL" };
  } catch (error) {
    return {
      items: generateDolClaimsEvents(start, endExclusive),
      source: "DOL",
      warning: `DOL claims exception schedule failed (${error instanceof Error ? error.message : String(error)}); used default Thursday 8:30 AM rule.`,
    };
  }
}

async function readEiaWpsrAdapter(fetchText: UsMacroFetchText, start: string, endExclusive: string): Promise<AdapterResult> {
  try {
    const result = await fetchText(EIA_WPSR_SCHEDULE_URL);
    return { items: generateEiaWpsrEvents(start, endExclusive, parseEiaWpsrExceptions(result.text)), source: "EIA" };
  } catch (error) {
    return {
      items: generateEiaWpsrEvents(start, endExclusive),
      source: "EIA",
      warning: `EIA WPSR exception schedule failed (${error instanceof Error ? error.message : String(error)}); used default Wednesday 10:30 AM rule.`,
    };
  }
}

function readUmichSentimentAdapter(start: string, endExclusive: string): Promise<AdapterResult> {
  const unsupportedYears = yearsInRange(start, endExclusive).filter((year) => !UMICH_PRELIMINARY_SENTIMENT_DATES_BY_YEAR[year]);
  return Promise.resolve({
    items: generateUmichSentimentEvents(start, endExclusive),
    source: "UMich",
    warning: unsupportedYears.length
      ? `UMich release schedule is configured through 2026; missing release-date table for ${unsupportedYears.join(", ")}.`
      : undefined,
  });
}

async function readFedBoardCalendarAdapter(fetchText: UsMacroFetchText, start: string, endExclusive: string): Promise<AdapterResult> {
  const results: UsMacroRawEvent[] = [];
  const warnings: string[] = [];
  for (const { month, year } of monthsInRange(start, endExclusive)) {
    const candidates = fedCalendarMonthUrls(year, month);
    let loaded = false;
    for (const url of candidates) {
      try {
        const response = await fetchText(url);
        results.push(...parseFedBoardCalendar(response.text, year, month, start, endExclusive, url));
        loaded = true;
        break;
      } catch (error) {
        if (url === candidates[candidates.length - 1]) {
          warnings.push(`Fed public calendar ${year}-${pad(month)} failed: ${error instanceof Error ? error.message : String(error)}.`);
        }
      }
    }
    if (!loaded && !warnings.length) {
      warnings.push(`Fed public calendar ${year}-${pad(month)} returned no usable month page.`);
    }
  }
  return { items: results, source: "Fed", warning: warnings.join(" ") || undefined };
}

function ratingForRawEvent(raw: UsMacroRawEvent): [string, UsMacroEventRating] | null {
  return ratingForText(`${raw.title} ${raw.detail ?? ""} ${raw.coverage ?? ""}`, raw.source);
}

function ratingForText(text: string, source: UsMacroSource): [string, UsMacroEventRating] | null {
  for (const entry of Object.entries(US_MACRO_EVENT_RATINGS)) {
    const [key, rating] = entry;
    if (rating.sources && !(rating.sources as readonly UsMacroSource[]).includes(source)) {
      continue;
    }
    if (rating.aliases.some((alias) => alias.test(text))) {
      return [key, rating];
    }
  }
  return null;
}

function displayTitleForRawEvent(raw: UsMacroRawEvent, key: string, rating: UsMacroEventRating): string {
  if (key === "fed-speaker") {
    return dailyFxFedSpeakerTitle(raw.title);
  }
  return rating.displayTitle ?? raw.title;
}

function dailyFxFedSpeakerTitle(title: string): string {
  if (/^Fed\s+.+\s+Speech$/i.test(title.trim())) {
    return title.trim();
  }
  const titledName = title.match(/\b(?:Vice Chair(?:\s+for\s+[^:,-]+)?|Governor|Chair|President)\s+([^:,-]+)/i)?.[1];
  const directName = title.match(/\b([A-Z][A-Za-z.'-]+)(?:\s+Speech|\s+Testimony|\s+Remarks|\s+Discussion|\s+Conversation)\b/)?.[1];
  const name = titledName ?? directName;
  const lastName = name
    ?.split(/\s+/)
    .map((part) => part.replace(/[^A-Za-z.'-]/g, ""))
    .filter((part) => part && !/^[A-Z]\.?$/.test(part))
    .at(-1);
  return lastName ? `Fed ${lastName} Speech` : title;
}

function isFedSpeechEvent(title: string): boolean {
  return /\b(Speech|Testimony|Discussion|Conversation|Remarks)\b/i.test(title) && /\b(Chair|Governor|Vice Chair|Federal Reserve|Fed)\b/i.test(title);
}

function isTreasuryCouponAuction(securityType: string, securityTerm: string): boolean {
  if (!/^(Note|Bond|TIPS)$/i.test(securityType)) {
    return false;
  }
  return /\b(3|5|7|9|10|19|20|29|30)-Year\b/i.test(securityTerm);
}

function parseIcsEvents(text: string): Record<string, string>[] {
  return unfoldIcs(text)
    .split("BEGIN:VEVENT")
    .slice(1)
    .map((block) => block.split("END:VEVENT")[0] ?? "")
    .map((block) => {
      const record: Record<string, string> = {};
      for (const line of block.split(/\r?\n/)) {
        const match = line.match(/^([A-Z]+)(?:;[^:]+)?:([\s\S]*)$/);
        if (match) {
          record[match[1]] = decodeIcsValue(match[2]);
        }
      }
      return record;
    });
}

function unfoldIcs(text: string): string {
  return text.replace(/\r?\n[ \t]/g, "");
}

function decodeIcsValue(value: string): string {
  return value.replace(/\\,/g, ",").replace(/\\n/g, " ").replace(/\\\\/g, "\\").trim();
}

function parseIcsDateTime(value: string): { date: string; sortMinute: number | null; timeLabel: string } | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?/);
  if (!match) {
    return null;
  }
  const hour = match[4] ? Number.parseInt(match[4], 10) : null;
  const minute = match[5] ? Number.parseInt(match[5], 10) : 0;
  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    sortMinute: hour == null ? null : hour * 60 + minute,
    timeLabel: hour == null ? "All day" : formatTimeLabel(hour, minute),
  };
}

function htmlRows(html: string): string[] {
  return [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
}

function htmlCells(row: string): string[] {
  return [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cleanText(cell[1])).filter(Boolean);
}

function cleanText(value: string): string {
  return decodeHtml(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function normalizeTimeLabel(value: string): string | null {
  const text = value.replace(/\./g, "").replace(/\s+/g, " ").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    return null;
  }
  return `${Number.parseInt(match[1], 10)}:${match[2]} ${match[3].toUpperCase()}`;
}

function parseTimeMinute(label: string): number | null {
  const match = label.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    return null;
  }
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function formatTimeLabel(hour: number, minute: number): string {
  const meridiem = hour >= 12 ? "PM" : "AM";
  const normalizedHour = hour % 12 || 12;
  return `${normalizedHour}:${pad(minute)} ${meridiem}`;
}

function parseMonthDayDate(value: string, year: number): string | null {
  const match = value.match(/\b([A-Z][a-z]+)\s+(\d{1,2})\b/);
  if (!match) {
    return null;
  }
  const month = MONTHS[match[1].toLowerCase()];
  return month ? isoDate(year, month, Number.parseInt(match[2], 10)) : null;
}

function parseFullDate(value: string): string | null {
  const match = value.match(/\b([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})\b/);
  if (!match) {
    return null;
  }
  const month = MONTHS[match[1].toLowerCase()];
  return month ? isoDate(Number.parseInt(match[3], 10), month, Number.parseInt(match[2], 10)) : null;
}

function resolveYearForMonth(dateText: string, startYear: number, startMonth: number): number {
  const monthName = dateText.match(/\b([A-Z][a-z]+)\b/)?.[1].toLowerCase();
  const month = monthName ? MONTHS[monthName] : null;
  if (!month) {
    return startYear;
  }
  if (startMonth >= 10 && month <= 2) {
    return startYear + 1;
  }
  if (startMonth <= 2 && month >= 10) {
    return startYear - 1;
  }
  return startYear;
}

function lastDayFromRange(value: string): number | null {
  const numbers = value.match(/\d{1,2}/g);
  if (!numbers?.length) {
    return null;
  }
  return Number.parseInt(numbers[numbers.length - 1], 10);
}

function fedCalendarMonthUrls(year: number, month: number): string[] {
  const slug = FED_MONTH_URL_SLUGS[month - 1];
  return [`https://www.federalreserve.gov/newsevents/${year}-${slug}.htm`, `https://www.federalreserve.gov/newsevents/${year}-${pad(month)}.htm`];
}

function yearsInRange(start: string, endExclusive: string): number[] {
  const result: number[] = [];
  const seen = new Set<number>();
  for (const date of eachDate(start, endExclusive)) {
    const year = Number.parseInt(date.slice(0, 4), 10);
    if (!seen.has(year)) {
      seen.add(year);
      result.push(year);
    }
  }
  return result;
}

function monthsInRange(start: string, endExclusive: string): { month: number; year: number }[] {
  const result: { month: number; year: number }[] = [];
  const seen = new Set<string>();
  for (const date of eachDate(start, endExclusive)) {
    const year = Number.parseInt(date.slice(0, 4), 10);
    const month = Number.parseInt(date.slice(5, 7), 10);
    const key = `${year}-${month}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ month, year });
    }
  }
  return result;
}

function nyFedEmpireReleaseDays(text: string, year: number): Map<number, number> {
  const section = yearSection(text, year);
  const releaseDays = new Map<number, number>();
  const adjacentPattern = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2})\b/gi;
  for (const match of section.matchAll(adjacentPattern)) {
    const month = MONTH_ABBREVIATIONS[match[1].toLowerCase()];
    if (month) {
      releaseDays.set(month, Number.parseInt(match[2], 10));
    }
  }

  const tokens = [...section.matchAll(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|\d{1,2})\b/gi)].map((match) => match[0]);
  for (let index = 0; index + 7 < tokens.length; index += 1) {
    const monthTokens = tokens.slice(index, index + 4);
    if (!monthTokens.every((token) => MONTH_ABBREVIATIONS[token.toLowerCase()])) {
      continue;
    }
    const dayTokens = tokens.slice(index + 4, index + 8);
    if (!dayTokens.every((token) => /^\d{1,2}$/.test(token))) {
      continue;
    }
    monthTokens.forEach((token, offset) => {
      releaseDays.set(MONTH_ABBREVIATIONS[token.toLowerCase()], Number.parseInt(dayTokens[offset], 10));
    });
  }

  if (/Empire State Manufacturing Survey/i.test(text)) {
    for (let month = 1; month <= 12; month += 1) {
      if (!releaseDays.has(month)) {
        releaseDays.set(month, Number.parseInt(nextBusinessDay(isoDate(year, month, 15)).slice(8, 10), 10));
      }
    }
  }
  return releaseDays;
}

function yearSection(text: string, year: number): string {
  const start = text.indexOf(String(year));
  if (start < 0) {
    return "";
  }
  const nextYear = text.indexOf(String(year + 1), start + 4);
  return text.slice(start, nextYear < 0 ? start + 1_200 : nextYear);
}

function nahbHmiEvent(date: string): UsMacroRawEvent {
  return {
    date,
    detail: "NAHB/Wells Fargo HMI release dates",
    source: "NAHB",
    sortMinute: parseTimeMinute("10:00 AM"),
    timeLabel: "10:00 AM",
    title: "NAHB Housing Market Index",
    url: NAHB_HMI_RELEASE_DATES_URL,
  };
}

function parseFlexibleFullDate(value: string): string | null {
  const monthNames = Object.keys(MONTHS).join("|");
  const normalized = value
    .replace(/\bSept\./gi, "September")
    .replace(/\bJan\./gi, "January")
    .replace(/\bFeb\./gi, "February")
    .replace(/\bMar\./gi, "March")
    .replace(/\bApr\./gi, "April")
    .replace(/\bJun\./gi, "June")
    .replace(/\bJul\./gi, "July")
    .replace(/\bAug\./gi, "August")
    .replace(/\bSep\./gi, "September")
    .replace(/\bOct\./gi, "October")
    .replace(/\bNov\./gi, "November")
    .replace(/\bDec\./gi, "December")
    .replace(new RegExp(`\\b(${monthNames}),\\s+(\\d{1,2})`, "i"), "$1 $2");
  return parseFullDate(normalized);
}

function businessDaysInMonth(year: number, month: number): string[] {
  const days: string[] = [];
  const date = new Date(Date.UTC(year, month - 1, 1, 12));
  while (date.getUTCMonth() === month - 1) {
    const iso = date.toISOString().slice(0, 10);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) {
      days.push(iso);
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days;
}

function eachDate(start: string, endExclusive: string): string[] {
  const result: string[] = [];
  for (let date = start; date < endExclusive; date = addDays(date, 1)) {
    result.push(date);
  }
  return result;
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function nextBusinessDay(date: string): string {
  let result = date;
  while (utcDay(result) === 0 || utcDay(result) === 6) {
    result = addDays(result, 1);
  }
  return result;
}

function weekStartMonday(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  const day = value.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return addDays(date, -daysSinceMonday);
}

function utcDay(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function isWithinRange(date: string, start: string, endExclusive: string): boolean {
  return date >= start && date < endExclusive;
}

function isMondayFederalHoliday(date: string): boolean {
  if (utcDay(date) !== 1) {
    return false;
  }
  const month = Number.parseInt(date.slice(5, 7), 10);
  const day = Number.parseInt(date.slice(8, 10), 10);
  if (
    (month === 1 && isNthWeekdayOfMonth(date, 1, 3)) ||
    (month === 2 && isNthWeekdayOfMonth(date, 1, 3)) ||
    (month === 5 && isLastWeekdayOfMonth(date, 1)) ||
    (month === 9 && isNthWeekdayOfMonth(date, 1, 1)) ||
    (month === 10 && isNthWeekdayOfMonth(date, 1, 2))
  ) {
    return true;
  }
  return isFixedDateFederalHoliday(month, day) || isFixedDateFederalHoliday(Number.parseInt(addDays(date, -1).slice(5, 7), 10), Number.parseInt(addDays(date, -1).slice(8, 10), 10));
}

function isFixedDateFederalHoliday(month: number, day: number): boolean {
  return (
    (month === 1 && day === 1) ||
    (month === 6 && day === 19) ||
    (month === 7 && day === 4) ||
    (month === 11 && day === 11) ||
    (month === 12 && day === 25)
  );
}

function isNthWeekdayOfMonth(date: string, weekday: number, nth: number): boolean {
  return utcDay(date) === weekday && Math.floor((Number.parseInt(date.slice(8, 10), 10) - 1) / 7) + 1 === nth;
}

function isLastWeekdayOfMonth(date: string, weekday: number): boolean {
  return utcDay(date) === weekday && addDays(date, 7).slice(5, 7) !== date.slice(5, 7);
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function uniqueRawEvents(events: UsMacroRawEvent[]): UsMacroRawEvent[] {
  const seen = new Set<string>();
  const result: UsMacroRawEvent[] = [];
  for (const event of events) {
    const key = `${event.source}|${event.date}|${event.timeLabel}|${event.title}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(event);
  }
  return result;
}

function uniqueCalendarEvents(events: MorningCalendarEvent[]): MorningCalendarEvent[] {
  const seen = new Set<string>();
  const result: MorningCalendarEvent[] = [];
  for (const event of events) {
    const key = `${event.date}|${event.timeLabel}|${event.title}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(event);
  }
  return result;
}

function sortCalendarEvents(events: MorningCalendarEvent[]): MorningCalendarEvent[] {
  return [...events].sort((a, b) => {
    const aMinute = a.sortMinute ?? 9_999;
    const bMinute = b.sortMinute ?? 9_999;
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (aMinute !== bMinute) return aMinute - bMinute;
    return a.title.localeCompare(b.title);
  });
}

function countBySource(events: MorningCalendarEvent[]): Partial<Record<MorningCalendarSource, number>> {
  return events.reduce<Partial<Record<MorningCalendarSource, number>>>((counts, event) => {
    counts[event.source] = (counts[event.source] ?? 0) + 1;
    return counts;
  }, {});
}

function countUnratedBySource(events: UsMacroUnratedEvent[]): Partial<Record<UsMacroSource, number>> {
  return events.reduce<Partial<Record<UsMacroSource, number>>>((counts, event) => {
    counts[event.source] = (counts[event.source] ?? 0) + 1;
    return counts;
  }, {});
}

function isUsMacroSource(source: MorningCalendarSource): source is UsMacroSource {
  return source !== "RollCall";
}
