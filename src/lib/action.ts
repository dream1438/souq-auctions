import "server-only";
import { unstable_rethrow } from "next/navigation";
import { getDictionaryFor, type Dictionary } from "@/app/[lang]/dictionaries";
import { AppError, toAppError } from "./errors";
import { fill, formatMoney } from "./format";
import type { FormState } from "./form";

export function errorText(dict: Dictionary, error: AppError, locale: string): string {
  const table = dict.errors as Record<string, string>;
  const template = table[error.code] ?? dict.errors.generic;
  const amount = error.detail && /^\d+$/.test(error.detail) ? formatMoney(error.detail, locale, dict.common.egp) : (error.detail ?? "");
  return fill(template, { amount });
}

/**
 * Runs the body of a Server Action and turns expected failures (validation,
 * database rules such as "bid_too_low") into a translated message for the form.
 */
export async function guarded(
  locale: string,
  body: (dict: Dictionary) => Promise<FormState | void>,
): Promise<FormState> {
  const dict = await getDictionaryFor(locale);
  try {
    return (await body(dict)) ?? null;
  } catch (error) {
    unstable_rethrow(error);
    const known = toAppError(error);
    if (!known) {
      console.error("[action]", error);
      return { error: dict.errors.generic };
    }
    return { error: errorText(dict, known, locale) };
  }
}

export const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** Only follow "next" links that stay on this site. */
export const safeNext = (value: string, fallback: string) =>
  value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : fallback;
