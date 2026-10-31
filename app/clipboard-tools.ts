export type ClipboardEnvironment = {
  native?: { copyTextChecked?: (text: string) => boolean; copyText?: (text: string) => void };
  clipboard?: { writeText: (text: string) => Promise<void> };
  document?: Document;
};

/** Use the same plain text in the preview, browser clipboard and Android bridge. */
export function plainClipboardText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[\u00a0\u202f]/g, " ").replace(/\u0000/g, "");
}

/** Exact decimal amount for a bank amount field, with no grouping or currency sign. */
export function bankAmountText(kopecks: number): string {
  if (!Number.isSafeInteger(kopecks) || kopecks <= 0) throw new Error("Проверьте сумму счёта");
  return `${Math.trunc(kopecks / 100)},${String(kopecks % 100).padStart(2, "0")}`;
}

function copyWithSelection(text: string, doc: Document): boolean {
  const parent = doc.querySelector('[role="dialog"][data-state="open"]') ?? doc.body;
  if (!parent) return false;
  const previousFocus = doc.activeElement as HTMLElement | null;
  const selection = doc.getSelection();
  const savedRanges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const textarea = doc.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.setAttribute("aria-label", "Копирование текста");
  Object.assign(textarea.style, { position: "fixed", top: "0", left: "0", width: "1px", height: "1px", opacity: "0", fontSize: "16px" });
  parent.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return doc.execCommand("copy");
  } finally {
    textarea.remove();
    previousFocus?.focus?.({ preventScroll: true });
    if (selection && savedRanges.length) {
      selection.removeAllRanges();
      for (const range of savedRanges) selection.addRange(range);
    }
  }
}

export async function copyPlainText(text: string, environment: ClipboardEnvironment): Promise<"verified" | "legacy"> {
  const value = plainClipboardText(text);
  if (!value.trim()) throw new Error("Нет текста для копирования");
  if (environment.native?.copyTextChecked) {
    if (environment.native.copyTextChecked(value) !== true) throw new Error("Не удалось записать текст в буфер обмена");
    return "verified";
  }
  if (environment.clipboard) {
    try {
      await environment.clipboard.writeText(value);
      return "verified";
    } catch { /* The selection fallback also works inside an open modal. */ }
  }
  if (environment.document) {
    try { if (copyWithSelection(value, environment.document)) return "verified"; }
    catch { /* Old Android versions can still provide the original bridge. */ }
  }
  if (environment.native?.copyText) {
    await environment.native.copyText(value);
    return "legacy";
  }
  throw new Error("Не удалось скопировать текст. Выделите его и скопируйте вручную");
}
