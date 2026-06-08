import { describe, expect, it } from "vitest";
import {
  BEA_RELEASE_SCHEDULE_URL,
  BLS_RELEASE_CALENDAR_URL,
  CENSUS_RELEASE_SCHEDULE_URL,
  DOL_CLAIMS_SCHEDULE_URL,
  EIA_WPSR_SCHEDULE_URL,
  FED_FOMC_CALENDAR_URL,
  parseBeaReleaseSchedule,
  parseBlsIcsCalendar,
  parseCensusReleaseSchedule,
  parseDolClaimsExceptions,
  parseEiaWpsrExceptions,
  parseFedBoardCalendar,
  parseFedFomcCalendar,
  parseTreasuryAuctions,
  readUsMacroCalendar,
  generateDolClaimsEvents,
  generateEiaWpsrEvents,
  generateIsmCalendarEvents,
  normalizeUsMacroEvents,
} from "./morningMacroCalendar.ts";

describe("US macro calendar", () => {
  it("parses and rates BLS ICS releases", () => {
    const raw = parseBlsIcsCalendar(
      `
BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;TZID=US-Eastern:20260605T083000
SUMMARY:Employment Situation
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=US-Eastern:20260606T100000
SUMMARY:State Job Openings and Labor Turnover
END:VEVENT
END:VCALENDAR
      `,
      "2026-06-05",
      "2026-06-06",
    );
    const rated = normalizeUsMacroEvents(raw);

    expect(raw.map((event) => event.title)).toEqual(["Employment Situation"]);
    expect(rated.items.map((event) => `${event.title}:${event.impact}`)).toEqual([
      "Average Hourly Earnings MoM:medium",
      "Average Hourly Earnings YoY:medium",
      "Non Farm Payrolls:high",
      "Participation Rate:medium",
      "Unemployment Rate:high",
    ]);
    expect(rated.items[0]).toMatchObject({
      coverage: "Employment Situation",
      source: "BLS",
      timeLabel: "8:30 AM",
    });
  });

  it("parses and rates BEA release rows", () => {
    const raw = parseBeaReleaseSchedule(
      `
      <tr class="scheduled-releases-type-press">
        <td class="scheduled-date"><div class="release-date">June 25</div><small>8:30 AM</small></td>
        <td></td>
        <td class="release-title">Personal Income and Outlays, May 2026</td>
      </tr>
      `,
      "2026-06-24",
      "2026-06-26",
    );
    const rated = normalizeUsMacroEvents(raw);

    expect(rated.items).toHaveLength(1);
    expect(rated.items[0]).toMatchObject({ impact: "high", source: "BEA", title: "Personal Income and Outlays" });
  });

  it("parses Census rows and hides unrated rows", () => {
    const raw = parseCensusReleaseSchedule(
      `
      <tr><td><a href="/retail">Advance Monthly Sales for Retail and Food Services</a></td><td>June 17, 2026</td><td>8:30 AM</td><td>May 2026</td></tr>
      <tr><td>Business Formation Statistics</td><td>June 17, 2026</td><td>10:00 AM</td><td>May 2026</td></tr>
      `,
      "2026-06-17",
      "2026-06-18",
    );
    const rated = normalizeUsMacroEvents(raw);

    expect(rated.items.map((event) => event.title)).toEqual(["Retail Sales"]);
    expect(rated.unrated.map((event) => event.title)).toEqual(["Business Formation Statistics"]);
  });

  it("uses DOL holiday exceptions instead of the default Thursday claims release", () => {
    const exceptions = parseDolClaimsExceptions("Wednesday, November 25, 2026 8:30 AM EST Thanksgiving");
    const raw = generateDolClaimsEvents("2026-11-23", "2026-11-27", exceptions);
    const rated = normalizeUsMacroEvents(raw);

    expect(rated.items.map((event) => `${event.date} ${event.timeLabel}`)).toEqual(["2026-11-25 8:30 AM"]);
  });

  it("parses Fed FOMC decisions, press conferences, minutes, and speaker rows", () => {
    const fomc = parseFedFomcCalendar(
      `
      <h4><a id="42828">2026 FOMC Meetings</a></h4></div>
      <div class="fomc-meeting__month"><strong>June</strong></div>
      <div class="fomc-meeting__date">16-17*</div>
      <div>Press Conference<br><strong>Minutes:</strong><br> (Released July 8, 2026)</div>
      `,
      "2026-06-17",
      "2026-07-09",
    );
    const board = parseFedBoardCalendar(
      `
      <div class="col-xs-2"><p>12:00 p.m.</p></div>
      <div class="col-xs-7">
        <p>Speech - Governor Michael S. Barr</p>
        <p class='calendar__title'><em>Supervision and Regulation</em></p>
      </div>
      <div class="col-xs-3"><p>18</p></div>
      `,
      2026,
      6,
      "2026-06-17",
      "2026-06-19",
      "https://www.federalreserve.gov/newsevents/2026-june.htm",
    );
    const rated = normalizeUsMacroEvents([...fomc, ...board]);

    expect(rated.items.map((event) => event.title)).toEqual([
      "FOMC Rate Decision",
      "FOMC Press Conference",
      "Fed Barr Speech",
      "FOMC Minutes",
    ]);
    expect(rated.items.map((event) => event.impact)).toEqual(["high", "high", "medium", "high"]);
  });

  it("generates ISM first and third business day markers", () => {
    const rated = normalizeUsMacroEvents(generateIsmCalendarEvents("2026-06-01", "2026-06-04"));

    expect(rated.items.map((event) => `${event.date} ${event.title}`)).toEqual([
      "2026-06-01 ISM Manufacturing PMI",
      "2026-06-03 ISM Services PMI",
    ]);
  });

  it("maps manually supplied DailyFX-style row names to SPX macro ratings", () => {
    const rated = normalizeUsMacroEvents([
      raw("MBA", "MBA 30-Year Mortgage Rate", "7:00 AM"),
      raw("ADP", "ADP Employment Change", "8:15 AM"),
      raw("Fed", "Fed Barr Speech", "9:00 AM"),
      raw("ISM", "ISM Services PMI", "10:00 AM"),
      raw("Census", "Factory Orders MoM", "10:00 AM"),
      raw("EIA", "EIA Crude Oil Stocks Change", "10:30 AM"),
      raw("EIA", "EIA Gasoline Stocks Change", "10:30 AM"),
      raw("Fed", "Fed Goolsbee Speech", "11:00 AM"),
      raw("Fed", "Fed Logan Speech", "4:00 PM"),
      raw("DOL", "Initial Jobless Claims", "8:30 AM", "2026-06-04"),
      raw("Fed", "Fed Barkin Speech", "8:30 AM", "2026-06-04"),
      raw("Fed", "Fed Daly Speech", "1:10 PM", "2026-06-04"),
      raw("BLS", "Average Hourly Earnings YoY", "8:30 AM", "2026-06-05"),
      raw("BLS", "Participation Rate", "8:30 AM", "2026-06-05"),
      raw("BLS", "Unemployment Rate", "8:30 AM", "2026-06-05"),
      raw("BLS", "Average Hourly Earnings MoM", "8:30 AM", "2026-06-05"),
      raw("BLS", "Non Farm Payrolls", "8:30 AM", "2026-06-05"),
      raw("ADP", "ADP Employment Change Weekly", "8:15 AM", "2026-06-09"),
      raw("BEA", "Balance of Trade", "8:30 AM", "2026-06-09"),
      raw("BEA", "Imports", "8:30 AM", "2026-06-09"),
      raw("BEA", "Exports", "8:30 AM", "2026-06-09"),
      raw("NAR", "Existing Home Sales MoM", "10:00 AM", "2026-06-09"),
      raw("NAR", "Existing Home Sales", "10:00 AM", "2026-06-09"),
      raw("API", "API Crude Oil Stock Change", "4:30 PM", "2026-06-09"),
      raw("BLS", "Inflation Rate YoY", "8:30 AM", "2026-06-10"),
      raw("BLS", "Inflation Rate MoM", "8:30 AM", "2026-06-10"),
      raw("BLS", "Core Inflation Rate YoY", "8:30 AM", "2026-06-10"),
      raw("BLS", "CPI s.a", "8:30 AM", "2026-06-10"),
      raw("BLS", "Core Inflation Rate MoM", "8:30 AM", "2026-06-10"),
      raw("BLS", "CPI", "8:30 AM", "2026-06-10"),
      raw("Treasury", "Monthly Budget Statement", "2:00 PM", "2026-06-10"),
      raw("BLS", "Core PPI MoM", "8:30 AM", "2026-06-11"),
      raw("DOL", "Initial Jobless Claims", "8:30 AM", "2026-06-11"),
      raw("BLS", "PPI MoM", "8:30 AM", "2026-06-11"),
      raw("UMich", "Michigan Consumer Sentiment Prel", "10:00 AM", "2026-06-12"),
      raw("NYFed", "NY Empire State Manufacturing Index", "8:30 AM", "2026-06-15"),
      raw("Fed", "Industrial Production MoM", "9:15 AM", "2026-06-15"),
      raw("NAHB", "NAHB Housing Market Index", "10:00 AM", "2026-06-15"),
      raw("ADP", "ADP Employment Change Weekly", "8:15 AM", "2026-06-16"),
      raw("BLS", "Import Prices MoM", "8:30 AM", "2026-06-16"),
      raw("BLS", "Export Prices MoM", "8:30 AM", "2026-06-16"),
      raw("Census", "Housing Starts MoM", "8:30 AM", "2026-06-16"),
      raw("Census", "Housing Starts", "8:30 AM", "2026-06-16"),
      raw("Census", "Building Permits Prel", "8:30 AM", "2026-06-16"),
      raw("Census", "Building Permits MoM Prel", "8:30 AM", "2026-06-16"),
      raw("API", "API Crude Oil Stock Change", "4:30 PM", "2026-06-16"),
    ]);

    expect(rated.items.map((event) => `${event.title}:${event.impact}`)).toEqual([
      "MBA 30-Year Mortgage Rate:medium",
      "ADP Employment Change:medium",
      "Fed Barr Speech:medium",
      "Factory Orders MoM:medium",
      "ISM Services PMI:high",
      "EIA Crude Oil Stocks Change:medium",
      "EIA Gasoline Stocks Change:medium",
      "Fed Goolsbee Speech:medium",
      "Fed Logan Speech:medium",
      "Fed Barkin Speech:medium",
      "Initial Jobless Claims:medium",
      "Fed Daly Speech:medium",
      "Average Hourly Earnings MoM:medium",
      "Average Hourly Earnings YoY:medium",
      "Non Farm Payrolls:high",
      "Participation Rate:medium",
      "Unemployment Rate:high",
      "ADP Employment Change:medium",
      "Balance of Trade:medium",
      "Exports:medium",
      "Imports:medium",
      "Existing Home Sales:high",
      "Existing Home Sales MoM:medium",
      "API Crude Oil Stock Change:medium",
      "Core Inflation Rate MoM:high",
      "Core Inflation Rate YoY:high",
      "CPI:medium",
      "CPI s.a:medium",
      "Inflation Rate MoM:high",
      "Inflation Rate YoY:high",
      "Monthly Budget Statement:medium",
      "Core PPI MoM:medium",
      "Initial Jobless Claims:medium",
      "PPI MoM:high",
      "Michigan Consumer Sentiment Prel:high",
      "NY Empire State Manufacturing Index:medium",
      "Industrial Production MoM:medium",
      "NAHB Housing Market Index:medium",
      "ADP Employment Change:medium",
      "Building Permits MoM Prel:medium",
      "Building Permits Prel:high",
      "Export Prices MoM:medium",
      "Housing Starts:high",
      "Housing Starts MoM:medium",
      "Import Prices MoM:medium",
      "API Crude Oil Stock Change:medium",
    ]);
  });

  it("expands official aggregate releases into DailyFX-style subrows", () => {
    const rated = normalizeUsMacroEvents([
      raw("BLS", "Employment Situation", "8:30 AM", "2026-06-05"),
      raw("BEA", "U.S. International Trade in Goods and Services", "8:30 AM", "2026-06-09"),
      raw("Census", "International Trade in Goods and Services", "8:30 AM", "2026-06-09"),
      raw("BLS", "Consumer Price Index", "8:30 AM", "2026-06-10"),
      raw("EIA", "Weekly Petroleum Status Report", "10:30 AM", "2026-06-10"),
      raw("BLS", "Producer Price Index", "8:30 AM", "2026-06-11"),
      raw("BLS", "U.S. Import and Export Price Indexes", "8:30 AM", "2026-06-16"),
      raw("Census", "New Residential Construction", "8:30 AM", "2026-06-16"),
    ]);

    expect(rated.items.map((event) => `${event.date} ${event.title}:${event.impact}`)).toEqual([
      "2026-06-05 Average Hourly Earnings MoM:medium",
      "2026-06-05 Average Hourly Earnings YoY:medium",
      "2026-06-05 Non Farm Payrolls:high",
      "2026-06-05 Participation Rate:medium",
      "2026-06-05 Unemployment Rate:high",
      "2026-06-09 Balance of Trade:medium",
      "2026-06-09 Exports:medium",
      "2026-06-09 Imports:medium",
      "2026-06-10 Core Inflation Rate MoM:high",
      "2026-06-10 Core Inflation Rate YoY:high",
      "2026-06-10 CPI:medium",
      "2026-06-10 CPI s.a:medium",
      "2026-06-10 Inflation Rate MoM:high",
      "2026-06-10 Inflation Rate YoY:high",
      "2026-06-10 EIA Crude Oil Stocks Change:medium",
      "2026-06-10 EIA Gasoline Stocks Change:medium",
      "2026-06-11 Core PPI MoM:medium",
      "2026-06-11 PPI MoM:high",
      "2026-06-16 Building Permits MoM Prel:medium",
      "2026-06-16 Building Permits Prel:high",
      "2026-06-16 Export Prices MoM:medium",
      "2026-06-16 Housing Starts:high",
      "2026-06-16 Housing Starts MoM:medium",
      "2026-06-16 Import Prices MoM:medium",
    ]);
    expect(rated.items.filter((event) => event.title === "Balance of Trade")).toHaveLength(1);
    expect(rated.items.find((event) => event.title === "Non Farm Payrolls")?.coverage).toBe("Employment Situation");
  });

  it("parses Treasury coupon auctions and excludes bills", () => {
    const rated = normalizeUsMacroEvents(
      parseTreasuryAuctions(
        JSON.stringify([
          { auctionDate: "2026-06-10T00:00:00", closingTimeCompetitive: "01:00 PM", securityTerm: "10-Year", securityType: "Note" },
          { auctionDate: "2026-06-10T00:00:00", closingTimeCompetitive: "11:30 AM", securityTerm: "4-Week", securityType: "Bill" },
        ]),
        "2026-06-10",
        "2026-06-11",
      ),
    );

    expect(rated.items).toHaveLength(1);
    expect(rated.items[0]).toMatchObject({ impact: "medium", source: "Treasury", title: "10-Year Note Auction" });
  });

  it("uses EIA WPSR holiday exceptions instead of the default Wednesday release", () => {
    const exceptions = parseEiaWpsrExceptions("<tr><th>May 22, 2026</th><td>May 28, 2026</td><td>Thursday</td><td>12:00 p.m.</td><td>Memorial Day</td></tr>");
    const rated = normalizeUsMacroEvents(generateEiaWpsrEvents("2026-05-25", "2026-05-29", exceptions));

    expect(rated.items.map((event) => `${event.date} ${event.timeLabel} ${event.title}`)).toEqual([
      "2026-05-28 12:00 PM EIA Crude Oil Stocks Change",
      "2026-05-28 12:00 PM EIA Gasoline Stocks Change",
    ]);
  });

  it("adds generated ADP, MBA, and API release markers", async () => {
    const result = await readUsMacroCalendar(emptyMacroFetch, "2026-06-01", "2026-06-11");

    expect(
      result.items
        .filter((event) => ["ADP", "MBA", "API"].includes(event.source))
        .map((event) => `${event.date} ${event.timeLabel} ${event.source} ${event.title}${event.coverage ? ` (${event.coverage})` : ""}`),
    ).toEqual([
      "2026-06-02 8:15 AM ADP ADP Employment Change (ADP Employment Change Weekly)",
      "2026-06-02 4:30 PM API API Crude Oil Stock Change",
      "2026-06-03 7:00 AM MBA MBA 30-Year Mortgage Rate",
      "2026-06-03 8:15 AM ADP ADP Employment Change",
      "2026-06-09 8:15 AM ADP ADP Employment Change (ADP Employment Change Weekly)",
      "2026-06-09 4:30 PM API API Crude Oil Stock Change",
      "2026-06-10 7:00 AM MBA MBA 30-Year Mortgage Rate",
    ]);
  });

  it("moves API WSB markers to Wednesday after Monday federal holidays", async () => {
    const result = await readUsMacroCalendar(emptyMacroFetch, "2026-05-25", "2026-05-28");

    expect(result.items.filter((event) => event.source === "API").map((event) => `${event.date} ${event.timeLabel} ${event.title}`)).toEqual([
      "2026-05-27 4:30 PM API Crude Oil Stock Change",
    ]);
  });

  it("parses public NAR, NAHB, and NYFed schedule pages", async () => {
    const result = await readUsMacroCalendar(
      officialScheduleFetch({
        nar: `
          The National Association of REALTORS has announced its 2026 statistical news release schedule. All releases are distributed at 10 a.m. Eastern Time.
          JUNE
          Tue., June 9 May Existing-Home Sales
          Wed., June 17 May Pending Home Sales Index
          JULY
          Thu., July 9 June Existing-Home Sales
        `,
        nahb: `
          <h2>2026 HMI Schedule</h2>
          <p>Normal release time: 10:00 AM Eastern Time</p>
          <table>
            <tr><td>May 2026</td><td>May 18, 2026</td></tr>
            <tr><td>June 2026</td><td>June 15, 2026</td></tr>
          </table>
        `,
        nyFed: `
          <p>Released at or shortly after 8:30 a.m.</p>
          <p>2026 Empire State Manufacturing Survey release schedule</p>
          <p>JAN 15 FEB 17 MAR 16 APR 15 MAY 15 JUN 15 JUL 15 AUG 17 SEP 15 OCT 15 NOV 16 DEC 15</p>
        `,
      }),
      "2026-06-09",
      "2026-06-16",
    );

    expect(
      result.items
        .filter((event) => ["NAR", "NAHB", "NYFed"].includes(event.source))
        .map((event) => `${event.date} ${event.timeLabel} ${event.source} ${event.title}:${event.impact}`),
    ).toEqual([
      "2026-06-09 10:00 AM NAR Existing Home Sales:high",
      "2026-06-15 8:30 AM NYFed NY Empire State Manufacturing Index:medium",
      "2026-06-15 10:00 AM NAHB NAHB Housing Market Index:medium",
    ]);
  });

  it("uses the configured 2026 UMich preliminary sentiment release dates and warns for unsupported years", async () => {
    const june = await readUsMacroCalendar(emptyMacroFetch, "2026-06-12", "2026-06-27");
    const future = await readUsMacroCalendar(emptyMacroFetch, "2027-01-01", "2027-02-01");

    expect(june.items.filter((event) => event.source === "UMich").map((event) => `${event.date} ${event.timeLabel} ${event.title}`)).toEqual([
      "2026-06-12 10:00 AM Michigan Consumer Sentiment Prel",
    ]);
    expect(future.items.some((event) => event.source === "UMich")).toBe(false);
    expect(future.source.detail).toContain("UMich release schedule is configured through 2026");
  });

  it("keeps rated events when another official source fails", async () => {
    const fetchText = async (url: string): Promise<{ text: string }> => {
      if (url === BLS_RELEASE_CALENDAR_URL) {
        return {
          text: `
BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;TZID=US-Eastern:20260609T083000
SUMMARY:Consumer Price Index
END:VEVENT
END:VCALENDAR
          `,
        };
      }
      if ([BEA_RELEASE_SCHEDULE_URL, CENSUS_RELEASE_SCHEDULE_URL, DOL_CLAIMS_SCHEDULE_URL, FED_FOMC_CALENDAR_URL, EIA_WPSR_SCHEDULE_URL].includes(url)) {
        throw new Error("source down");
      }
      return { text: "" };
    };

    const result = await readUsMacroCalendar(fetchText, "2026-06-09", "2026-06-10");

    expect(result.items.filter((event) => event.source === "BLS").map((event) => event.title)).toEqual([
      "Core Inflation Rate MoM",
      "Core Inflation Rate YoY",
      "CPI",
      "CPI s.a",
      "Inflation Rate MoM",
      "Inflation Rate YoY",
    ]);
    expect(result.source.status).toBe("warning");
    expect(result.source.detail).toContain("BEA calendar failed");
  });
});

function raw(
  source: Parameters<typeof normalizeUsMacroEvents>[0][number]["source"],
  title: string,
  timeLabel: string,
  date = "2026-06-03",
): Parameters<typeof normalizeUsMacroEvents>[0][number] {
  return {
    date,
    source,
    sortMinute: testSortMinute(timeLabel),
    timeLabel,
    title,
    url: "https://example.test/calendar",
  };
}

function testSortMinute(label: string): number | null {
  const match = label.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    return null;
  }
  let hour = Number(match[1]);
  if (match[3].toUpperCase() === "PM" && hour !== 12) {
    hour += 12;
  }
  if (match[3].toUpperCase() === "AM" && hour === 12) {
    hour = 0;
  }
  return hour * 60 + Number(match[2]);
}

async function emptyMacroFetch(): Promise<{ text: string }> {
  return { text: "" };
}

function officialScheduleFetch(sources: { nahb: string; nar: string; nyFed: string }): (url: string) => Promise<{ text: string }> {
  return async (url: string) => {
    if (/nar\.realtor/i.test(url)) {
      return { text: sources.nar };
    }
    if (/nahb\.org/i.test(url)) {
      return { text: sources.nahb };
    }
    if (/newyorkfed\.org/i.test(url)) {
      return { text: sources.nyFed };
    }
    return { text: "" };
  };
}
