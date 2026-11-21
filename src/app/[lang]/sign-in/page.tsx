import Link from "next/link";
import { redirect } from "next/navigation";
import { signInAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/forms";
import { safeNext } from "@/lib/action";
import { getViewer } from "@/lib/auth";
import { getDictionary, getLocale } from "../dictionaries";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [dict, locale] = [await getDictionary(), await getLocale()];
  const next = safeNext((await searchParams).next ?? "", `/${locale}/account`);
  if (await getViewer()) redirect(next);

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="display text-3xl">{dict.auth.signInTitle}</h1>
      <div className="card mt-6 p-5">
        <ActionForm action={signInAction} submitLabel={dict.nav.signIn} pendingLabel={dict.common.working} hidden={{ locale, next }}>
          <div className="field">
            <label htmlFor="email">{dict.auth.email}</label>
            <input id="email" name="email" type="email" className="input" required dir="ltr" autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">{dict.auth.password}</label>
            <input id="password" name="password" type="password" className="input" required dir="ltr" autoComplete="current-password" />
          </div>
        </ActionForm>
      </div>
      <p className="mt-4 text-sm text-ink-muted">
        {dict.auth.noAccount}{" "}
        <Link href={`/${locale}/sign-up`} className="font-semibold text-hibiscus">
          {dict.nav.signUp}
        </Link>
      </p>
    </div>
  );
}
