import Link from "next/link";
import { submitIdentityAction } from "@/app/actions/identity";
import { ActionForm, ImageInput } from "@/components/forms";
import { requireViewer } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { fill } from "@/lib/format";
import { getDictionary, getLocale } from "../../dictionaries";

export default async function VerifyPage() {
  const [dict, locale] = [await getDictionary(), await getLocale()];
  const viewer = await requireViewer(locale, `/${locale}/account/verify`);
  const status = viewer.profile.verification_status;
  const last = await asUser(viewer.user.id, (db) =>
    db.one<{ rejection_reason: string | null }>(
      "select rejection_reason from identity_verifications where user_id = $1 order by created_at desc limit 1",
      [viewer.user.id],
    ),
  );

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="display text-3xl">{dict.verify.title}</h1>

      {status === "approved" && <p className="notice notice-ok mt-6">{dict.verify.approved}</p>}
      {status === "pending" && <p className="notice notice-warn mt-6">{dict.verify.pending}</p>}
      {(status === "approved" || status === "pending") && (
        <Link href={`/${locale}/account`} className="btn btn-secondary mt-4">
          {dict.nav.account}
        </Link>
      )}

      {(status === "unverified" || status === "rejected") && (
        <>
          <p className="mt-3 text-ink-muted">{dict.verify.intro}</p>
          {status === "rejected" && (
            <p className="notice notice-bad mt-4">{fill(dict.verify.rejected, { reason: last?.rejection_reason ?? "" })}</p>
          )}
          <div className="card mt-6 p-5">
            <ActionForm action={submitIdentityAction} submitLabel={dict.verify.submit} pendingLabel={dict.common.working} hidden={{ locale }}>
              <div className="field">
                <label htmlFor="document_type">{dict.verify.docType}</label>
                <select id="document_type" name="document_type" className="input" defaultValue="national_id">
                  <option value="national_id">{dict.verify.national_id}</option>
                  <option value="passport">{dict.verify.passport}</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="document_number">{dict.verify.number}</label>
                <input id="document_number" name="document_number" className="input" required dir="ltr" inputMode="numeric" autoComplete="off" maxLength={20} />
                <p className="hint">{dict.verify.numberHint}</p>
              </div>
              <ImageInput name="front" label={dict.verify.front} required />
              <ImageInput name="back" label={dict.verify.back} />
              <ImageInput name="selfie" label={`${dict.verify.selfie} (${dict.common.optional})`} />
              <p className="hint">{dict.verify.privacy}</p>
            </ActionForm>
          </div>
        </>
      )}
    </div>
  );
}
