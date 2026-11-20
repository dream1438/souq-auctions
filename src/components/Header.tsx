import Link from "next/link";
import { Suspense } from "react";
import type { Dictionary, Locale } from "@/app/[lang]/dictionaries";
import { LanguageSwitch } from "./LanguageSwitch";

export function Header({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  return (
    <header className="border-b border-line bg-background">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href={`/${locale}`} className="text-lg font-bold text-brand">
          {dict.site.name}
        </Link>
        <nav className="ms-auto flex items-center gap-2 text-sm sm:gap-4">
          <Link href={`/${locale}/listings`} className="hover:text-brand">
            {dict.nav.browse}
          </Link>
          <Link href={`/${locale}/sell`} className="hover:text-brand">
            {dict.nav.sell}
          </Link>
          <Link href={`/${locale}/sign-in`} className="hover:text-brand">
            {dict.nav.signIn}
          </Link>
          <Suspense>
            <LanguageSwitch current={locale} label={dict.nav.switchLanguage} />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}
