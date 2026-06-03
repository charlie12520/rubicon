import { describe, expect, it } from "vitest";
import { asArray, asRecord, firstNumber, firstString, toNullableNumber, toNullablePositiveNumber } from "./normalize.ts";

describe("shared normalization helpers", () => {
  it("normalizes records, arrays, strings, and numbers consistently", () => {
    expect(asRecord({ ok: true })).toEqual({ ok: true });
    expect(asRecord(["nope"])).toEqual({});
    expect(asArray(["a"])).toEqual(["a"]);
    expect(asArray("a")).toEqual([]);
    expect(firstString("", undefined, 42, "fallback")).toBe("42");
    expect(firstNumber(undefined, "12.5", 99)).toBe(12.5);
    expect(firstNumber("nope")).toBe(0);
  });

  it("parses nullable financial numbers", () => {
    expect(toNullableNumber("($1,234.50)")).toBe(-1234.5);
    expect(toNullableNumber("$1,234.50")).toBe(1234.5);
    expect(toNullableNumber("-")).toBeNull();
    expect(toNullablePositiveNumber("0")).toBeNull();
    expect(toNullablePositiveNumber("12.3")).toBe(12.3);
  });
});
