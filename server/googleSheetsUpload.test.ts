import { describe, expect, it } from "vitest";
import { assertGoogleUploadConfig } from "./googleSheetsUpload.ts";

describe("Google daily pipeline upload config", () => {
  it("does not accept an API key as write-capable upload credentials", () => {
    expect(() =>
      assertGoogleUploadConfig({
        GOOGLE_SHEETS_API_KEY: "read-only-key",
      } as NodeJS.ProcessEnv),
    ).toThrow("requires write credentials");
  });

  it("accepts write credentials without a raw workbook Drive folder", () => {
    expect(
      assertGoogleUploadConfig({
        GOOGLE_SHEETS_ACCESS_TOKEN: "token",
      } as NodeJS.ProcessEnv),
    ).toEqual({
      credentialSources: ["GOOGLE_SHEETS_ACCESS_TOKEN"],
    });
  });

  it("ignores the retired raw workbook Drive folder setting", () => {
    expect(() =>
      assertGoogleUploadConfig({
        GOOGLE_SHEETS_ACCESS_TOKEN: "token",
        SPX_GOOGLE_RAW_UPLOAD_FOLDER_ID: "folder",
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
    expect(
      assertGoogleUploadConfig({
        GOOGLE_SHEETS_ACCESS_TOKEN: "token",
        SPX_GOOGLE_RAW_UPLOAD_FOLDER_ID: "folder",
      } as NodeJS.ProcessEnv),
    ).toEqual({
      credentialSources: ["GOOGLE_SHEETS_ACCESS_TOKEN"],
    });
  });
});
