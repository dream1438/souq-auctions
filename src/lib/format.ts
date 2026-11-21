/** Formatting helpers that are safe on both the server and the browser. */

const numberLocale = (locale: string) => (locale === "ar" ? "ar-EG-u-nu-latn" : "en-EG");

/** Money is stored in minor units (piastres). 125050 becomes "1,250.50 EGP". */
export function formatMoney(minor: number | string | null | undefined, locale: string, currencyLabel: string): string {
  if (minor === null || minor === undefined) return "";
  const value = Number(minor) / 100;
  const text = new Intl.NumberFormat(numberLocale(locale), {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${text} ${currencyLabel}`;
}

/** Reads what a person typed ("1,250.5", "١٢٥٠") into minor units, or null when it is not a price. */
export function parseMoney(input: unknown): number | null {
  if (typeof input !== "string") return null;
  const latin = input
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[٬,\s]/g, "")
    .replace("٫", ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(latin)) return null;
  const minor = Math.round(Number(latin) * 100);
  return minor > 0 ? minor : null;
}

/** Same as parseMoney but also accepts 0 and an empty box (null). */
export function parseMoneyAllowZero(input: unknown): number | null {
  if (typeof input !== "string" || input.trim() === "") return null;
  if (/^[0٠]+([.٫][0٠]{1,2})?$/.test(input.trim())) return 0;
  return parseMoney(input);
}

export function formatDateTime(value: Date | string | null | undefined, locale: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(numberLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  }).format(new Date(value));
}

export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(numberLocale(locale)).format(value);
}

/** Fills {name} placeholders in a dictionary string. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => (key in values ? String(values[key]) : ""));
}

/** Egyptian mobile numbers, stored as +201XXXXXXXXX. */
export function normalizeEgyptPhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[^\d]/g, "");
  const local = digits.startsWith("20") ? digits.slice(2) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^1[0125]\d{8}$/.test(local) ? `+20${local}` : null;
}

export const whatsappLink = (phone: string, text: string) =>
  `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(text)}`;
