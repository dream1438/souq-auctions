"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function LanguageSwitch({
  current,
  label,
}: {
  current: "ar" | "en";
  label: string;
}) {
  const pathname = usePathname();
  const other = current === "ar" ? "en" : "ar";
  const rest = pathname.replace(/^\/(ar|en)(?=\/|$)/, "");

  return (
    <Link
      href={`/${other}${rest}`}
      hrefLang={other}
      lang={other}
      onClick={() => {
        document.cookie = `locale=${other}; path=/; max-age=31536000; samesite=lax`;
      }}
      className="rounded-full border border-line px-3 py-1.5 text-sm hover:bg-surface"
    >
      {label}
    </Link>
  );
}
