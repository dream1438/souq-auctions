import { reviewIdentityAction } from "@/app/actions/identity";
import { ActionForm } from "@/components/forms";
import { canReviewIds, requireViewer } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { identityDocumentUrl } from "@/lib/storage";
import { getDictionary, getLocale } from "../../dictionaries";

type Row = {
  id: string;
  user_id: string;
  document_type: "national_id" | "passport";
  front_image_path: string;
  back_image_path: string | null;
  selfie_image_path: string | null;
  created_at: Date;
  display_name: string | null;
  phone: string | null;
  city: string | null;
};

export default async function VerificationsPage() {
  const [dict, locale] = [await getDictionary(), await getLocale()];
  const viewer = await requireViewer(locale, `/${locale}/admin/verifications`);
  if (!canReviewIds(viewer)) return <p className="text-ink-muted">{dict.errors.kyc_reviewer_only}</p>;

  // Row level security lets reviewers read every pending submission.
  const rows = await asUser(viewer.user.id, (db) =>
    db.query<Row>(
      `select v.id, v.user_id, v.document_type, v.front_image_path, v.back_image_path, v.selfie_image_path, v.created_at,
              p.display_name, p.phone, p.city
       from identity_verifications v left join profiles p on p.id = v.user_id
       where v.status = 'pending' order by v.created_at limit 50`,
    ),
  );

  if (rows.length === 0) return <p className="text-ink-muted">{dict.admin.nothing}</p>;

  return (
    <div className="flex flex-col gap-6">
      {rows.map((row) => {
        const images = [
          [dict.admin.front, identityDocumentUrl(row.front_image_path)],
          [dict.admin.back, identityDocumentUrl(row.back_image_path)],
          [dict.admin.selfie, identityDocumentUrl(row.selfie_image_path)],
        ].filter((entry): entry is [string, string] => Boolean(entry[1]));
        return (
          <article key={row.id} className="card p-5">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 className="text-lg font-semibold">{row.display_name ?? row.user_id}</h2>
              <span className="text-sm text-ink-muted" dir="ltr">
                {row.phone}
              </span>
              <span className="text-sm text-ink-muted">{row.city}</span>
              <span className="badge badge-muted">{dict.verify[row.document_type]}</span>
              <span className="text-sm text-ink-muted">
                {dict.admin.submitted}: {formatDateTime(row.created_at, locale)}
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {images.map(([label, url]) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={label} className="aspect-[4/3] w-full rounded-md border border-line object-cover" />
                  <span className="mt-1 block text-sm text-ink-muted">{label}</span>
                </a>
              ))}
            </div>
            {row.user_id === viewer.user.id ? (
              <p className="notice notice-warn mt-4">{dict.errors.cannot_review_own_submission}</p>
            ) : (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <ActionForm
                  action={reviewIdentityAction}
                  submitLabel={dict.admin.approve}
                  pendingLabel={dict.common.working}
                  submitClass="btn btn-buy"
                  hidden={{ locale, id: row.id, decision: "approve" }}
                />
                <ActionForm
                  action={reviewIdentityAction}
                  submitLabel={dict.admin.reject}
                  pendingLabel={dict.common.working}
                  submitClass="btn btn-danger"
                  hidden={{ locale, id: row.id, decision: "reject" }}
                >
                  <div className="field">
                    <label htmlFor={`reason-${row.id}`}>{dict.admin.reason}</label>
                    <input id={`reason-${row.id}`} name="reason" className="input" required maxLength={200} />
                  </div>
                </ActionForm>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
