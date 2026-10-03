export type ExpenseShortcut = {
  id: string;
  title: string;
  category: string;
  payer: "self" | "customer";
  // Zero leaves the amount for the user to enter when opening the expense form.
  amountKopecks: number;
};

type ExpenseCategory = { id: string; name: string };

const DEFAULT_SHORTCUTS: ExpenseShortcut[] = [
  { id: "fuel-customer", title: "Топливо заказчика", category: "fuel", payer: "customer", amountKopecks: 0 },
  { id: "fuel-self", title: "Моё топливо", category: "fuel", payer: "self", amountKopecks: 0 },
  { id: "repair-self", title: "Ремонт", category: "repair", payer: "self", amountKopecks: 0 },
];

function readShortcut(value: unknown, categoryIds: Set<string>): ExpenseShortcut | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id.trim()) return null;
  if (typeof item.title !== "string" || !item.title.trim() || item.title.trim().length > 40) return null;
  if (typeof item.category !== "string" || !categoryIds.has(item.category)) return null;
  if (item.payer !== "self" && item.payer !== "customer") return null;
  if (typeof item.amountKopecks !== "number" || !Number.isSafeInteger(item.amountKopecks) || item.amountKopecks < 0) return null;
  return {
    id: item.id.trim(),
    title: item.title.trim(),
    category: item.category,
    payer: item.payer,
    amountKopecks: item.amountKopecks,
  };
}

export function normalizeExpenseShortcuts(value: unknown, categories: ExpenseCategory[]): ExpenseShortcut[] {
  const categoryIds = new Set(categories.map((category) => category.id));
  const candidates = value === undefined ? DEFAULT_SHORTCUTS : value;
  if (!Array.isArray(candidates)) return [];
  const seenIds = new Set<string>();
  const shortcuts: ExpenseShortcut[] = [];
  for (const candidate of candidates) {
    const shortcut = readShortcut(candidate, categoryIds);
    if (!shortcut || seenIds.has(shortcut.id)) continue;
    if (shortcut.category !== "fuel" && shortcut.payer === "customer") shortcut.payer = "self";
    seenIds.add(shortcut.id);
    shortcuts.push(shortcut);
    if (shortcuts.length === 8) break;
  }
  return shortcuts;
}

export function validateExpenseShortcuts(value: unknown, categories: ExpenseCategory[]): ExpenseShortcut[] {
  if (!Array.isArray(value)) throw new Error("Быстрые кнопки расходов должны быть списком.");
  if (value.length > 8) throw new Error("Можно сохранить не более 8 быстрых кнопок расходов.");
  const categoryIds = new Set(categories.map((category) => category.id));
  const seenIds = new Set<string>();
  return value.map((candidate, index) => {
    const shortcut = readShortcut(candidate, categoryIds);
    if (!shortcut) {
      throw new Error(`Проверьте быструю кнопку № ${index + 1}: название до 40 символов, существующую категорию, плательщика и неотрицательную сумму в копейках.`);
    }
    if (shortcut.category !== "fuel" && shortcut.payer === "customer") {
      throw new Error("Заказчик может оплачивать только топливо. Для другой категории выберите «За мой счёт».");
    }
    if (seenIds.has(shortcut.id)) throw new Error("У быстрых кнопок расходов должны быть разные идентификаторы.");
    seenIds.add(shortcut.id);
    return shortcut;
  });
}
