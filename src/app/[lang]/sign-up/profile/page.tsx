import { redirect } from "next/navigation";
import { completeProfileAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/forms";
import { ProfileFields } from "@/components/ProfileFields";
import { getViewer } from "@/lib/auth";
import { getDictionary, getLocale } from "../../dictionaries";

/** Shown when an account exists but its profile was never saved. */
export default async function CompleteProfilePage() {
  const [dict, locale] = [await getDictionary(), await getLocale()];
  const viewer = await getViewer();
  if (!viewer) redirect(`/${locale}/sign-in`);
  if (viewer.profile) redirect(`/${locale}/account`);

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="display text-3xl">{dict.auth.profileTitle}</h1>
      <div className="card mt-6 p-5">
        <ActionForm action={completeProfileAction} submitLabel={dict.common.save} pendingLabel={dict.common.working} hidden={{ locale }}>
          <ProfileFields dict={dict} />
        </ActionForm>
      </div>
    </div>
  );
}
