import { afterEach, describe, expect, it, vi } from "vitest";
import { canAttemptClipboardCopy, copyTextToClipboard } from "./clipboard";

describe("review clipboard export", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses async clipboard when the browser permits it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyTextToClipboard("review markdown")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("review markdown");
  });

  it("falls back to legacy copy when async clipboard is blocked", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("blocked"));
    const execCommand = vi.fn().mockReturnValue(true);
    const { document, getTextarea } = fakeDocument(execCommand);

    vi.stubGlobal("document", document);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyTextToClipboard("review markdown")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(getTextarea()?.removed).toBe(true);
  });

  it("reports copy as unavailable when no clipboard path exists", async () => {
    vi.stubGlobal("navigator", {});

    expect(canAttemptClipboardCopy()).toBe(false);
    await expect(copyTextToClipboard("review markdown")).resolves.toBe(false);
  });
});

type FakeTextarea = {
  removed: boolean;
  select: ReturnType<typeof vi.fn>;
  setAttribute: ReturnType<typeof vi.fn>;
  setSelectionRange: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  remove: () => void;
  style: Record<string, string>;
  value: string;
};

function fakeDocument(execCommand: ReturnType<typeof vi.fn>): { document: Document; getTextarea: () => FakeTextarea | undefined } {
  let textarea: FakeTextarea | undefined;
  const body = {
    appendChild: vi.fn((node: HTMLTextAreaElement) => node),
  };
  const document = {
    body,
    createElement: vi.fn(() => {
      textarea = {
        focus: vi.fn(),
        remove: () => {
          if (textarea) {
            textarea.removed = true;
          }
        },
        removed: false,
        select: vi.fn(),
        setAttribute: vi.fn(),
        setSelectionRange: vi.fn(),
        style: {},
        value: "",
      };
      return textarea as unknown as HTMLTextAreaElement;
    }),
    execCommand,
  } as unknown as Document;

  return { document, getTextarea: () => textarea };
}
