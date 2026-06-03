export function canAttemptClipboardCopy(): boolean {
  if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
    return true;
  }

  if (typeof document === "undefined") {
    return false;
  }

  if (typeof document.queryCommandSupported === "function") {
    try {
      return document.queryCommandSupported("copy");
    } catch {
      return false;
    }
  }

  return typeof document.execCommand === "function";
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy in-page copy path for embedded browsers.
    }
  }

  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
