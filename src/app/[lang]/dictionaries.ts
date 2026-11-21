import { lang } from "next/root-params";
import { notFound } from "next/navigation";

const dictionaries = {
  ar: () => import("./dictionaries/ar.json").then((module) => module.default),
  en: () => import("./dictionaries/en.json").then((module) => module.default),
};

export type Locale = keyof typeof dictionaries;
export type Dictionary = Awaited<ReturnType<(typeof dictionaries)["en"]>>;

export const locales = Object.keys(dictionaries) as Locale[];

export const hasLocale = (locale: string): locale is Locale => locale in dictionaries;

export const getLocale = async (): Promise<Locale> => {
  const locale = await lang();
  if (!hasLocale(locale)) notFound();
  return locale;
};

/** For Server Components: reads the language from the URL. */
export const getDictionary = async (): Promise<Dictionary> => dictionaries[await getLocale()]();

/** For Server Actions and Route Handlers, which cannot read the URL language themselves. */
export const getDictionaryFor = async (locale: string): Promise<Dictionary> =>
  dictionaries[hasLocale(locale) ? locale : "ar"]();

export const asLocale = (value: unknown): Locale => (typeof value === "string" && hasLocale(value) ? value : "ar");
