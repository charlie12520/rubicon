import { describe, expect, it } from "vitest";
import { formatLiveUpdateDisplayText } from "./liveUpdateDisplay";

describe("live update display text", () => {
  it("turns shouted wire headlines into readable sentence case", () => {
    expect(
      formatLiveUpdateDisplayText(
        "FDA: WARNS PUBLIC AGAINST USING NON-PRESCRIPTION SKIN BRIGHTENING PRODUCTS DUE TO ELEVATED LEVELS OF MERCURY AND/OR HYDROQUINONE",
      ),
    ).toBe(
      "FDA: Warns public against using non-prescription skin brightening products due to elevated levels of mercury and/or hydroquinone",
    );
  });

  it("keeps normal mixed-case updates unchanged", () => {
    expect(formatLiveUpdateDisplayText("Fed speaker: policy remains restrictive.")).toBe(
      "Fed speaker: policy remains restrictive.",
    );
  });

  it("keeps important acronyms while normalizing names", () => {
    expect(formatLiveUpdateDisplayText("TRUMP (TRUTH SOCIAL): I HAD A HIGHLY FRUITFUL DISCUSSION WITH NATO")).toBe(
      "Trump (Truth Social): I had a highly fruitful discussion with NATO",
    );
  });

  it("keeps common wire-service proper nouns readable", () => {
    expect(
      formatLiveUpdateDisplayText(
        "THE US IS PRESSING FOR A GENUINE AND SWEEPING TRUCE WITH HEZBOLLAH - AL HADATH, CITING AN ISRAELI AUTHORITY.",
      ),
    ).toBe("The US is pressing for a genuine and sweeping truce with Hezbollah - Al Hadath, citing an Israeli authority.");
    expect(formatLiveUpdateDisplayText("OIL FUTURES TRIM ADVANCES AFTER TRUMP REMARKS; BRENT UP 4.5%, WTI UP 5.2%")).toBe(
      "Oil futures trim advances after Trump remarks; Brent up 4.5%, WTI up 5.2%",
    );
  });
});
