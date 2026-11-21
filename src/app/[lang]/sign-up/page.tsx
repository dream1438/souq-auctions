import Link from "next/link";
import { redirect } from "next/navigation";
import { signUpAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/forms";
import { ProfileFields } from "@/components/ProfileFields";
import { getViewer } from "@/lib/auth";
import { authProviderName } from "@/lib/env";
import { getDictionary, getLocale } from "../dictionaries";

export default async function SignUpPage() {
  const [dict, locale] = [await getDictionary(), await getLocale()];
  if (await getViewer()) redirect(`/${locale}/account`);

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="display text-3xl">{dict.auth.signUpTitle}</h1>
      {authProviderName() === "dev" && <p className="notice notice-warn mt-4">{dict.auth.devNotice}</p>}
      <div className="card mt-6 p-5">
        <ActionForm action={signUpAction} submitLabel={dict.auth.createAccount} pendingLabel={dict.common.working} hidden={{ locale }}>
          <div className="field">
            <label htmlFor="email">{dict.auth.email}</label>
            <input id="email" name="email" type="email" className="input" required dir="ltr" autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">{dict.auth.password}</label>
            <input id="password" name="password" type="password" className="input" required minLength={8} dir="ltr" autoComplete="new-password" />
            <p className="hint">{dict.auth.passwordHint}</p>
          </div>
          <ProfileFields dict={dict} />
        </ActionForm>
      </div>
      <p className="mt-4 text-sm text-ink-muted">
        {dict.auth.haveAccount}{" "}
        <Link href={`/${locale}/sign-in`} className="font-semibold text-hibiscus">
          {dict.nav.signIn}
        </Link>
      </p>
    </div>
  );
}
