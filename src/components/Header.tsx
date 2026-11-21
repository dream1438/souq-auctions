import Link from "next/link";
import { Suspense } from "react";
import type { Dictionary, Locale } from "@/app/[lang]/dictionaries";
import { signOutAction } from "@/app/actions/auth";
import { getViewer } from "@/lib/auth";
import { LanguageSwitch } from "./LanguageSwitch";

async function UserNav({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const viewer = await getViewer();
  if (!viewer) {
    return (
      <>
        <Link href={`/${locale}/sign-in`} className="hover:text-hibiscus">
          {dict.nav.signIn}
        </Link>
        <Link href={`/${locale}/sign-up`} className="btn btn-primary btn-sm">
          {dict.nav.signUp}
        </Link>
      </>
    );
  }
  return (
    <>
      {viewer.isStaff && (
        <Link href={`/${locale}/admin`} className="hover:text-hibiscus">
          {dict.nav.admin}
        </Link>
      )}
      <Link href={`/${locale}/account`} className="hover:text-hibiscus">
        {viewer.profile?.display_name ?? dict.nav.account}
      </Link>
      <form action={signOutAction}>
        <input type="hidden" name="locale" value={locale} />
        <button type="submit" className="text-ink-muted hover:text-hibiscus">
          {dict.nav.signOut}
        </button>
      </form>
    </>
  );
}

export function Header({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  return (
    <header className="border-b border-line bg-surface-raised">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href={`/${locale}`} className="display text-2xl text-hibiscus">
          {dict.site.name}
        </Link>
        <nav className="ms-auto flex flex-wrap items-center gap-3 text-sm sm:gap-4">
          <Link href={`/${locale}/listings`} className="hover:text-hibiscus">
            {dict.nav.browse}
          </Link>
          <Link href={`/${locale}/sell`} className="hover:text-hibiscus">
            {dict.nav.sell}
          </Link>
          <Suspense fallback={<span className="h-9 w-24 animate-pulse rounded-md bg-surface-sunken" />}>
            <UserNav dict={dict} locale={locale} />
          </Suspense>
          <Suspense>
            <LanguageSwitch current={locale} label={dict.nav.switchLanguage} />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}
