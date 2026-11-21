import { staffUnblockAction } from "@/app/actions/market";
import { ActionForm } from "@/components/forms";
import { requireViewer } from "@/lib/auth";
import { asService } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getDictionary, getLocale } from "../../dictionaries";

type Row = {
  id: string;
  display_name: string;
  phone: string | null;
  city: string | null;
  verification_status: "unverified" | "pending" | "approved" | "rejected";
  strikes: number;
  parcels_accepted: number;
  parcels_refused: number;
  bidding_blocked_at: Date | null;
  created_at: Date;
  roles: string | null;
};

const TONE = { unverified: "badge-muted", pending: "badge-warn", approved: "badge-ok", rejected: "badge-bad" } as const;

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [dict, locale, { q = "" }] = [await getDictionary(), await getLocale(), await searchParams];
  const viewer = await requireViewer(locale, `/${locale}/admin/users`);
  if (!viewer.isStaff) return null;
  const term = q.trim().slice(0, 60);
  const rows = await asService((db) =>
    db.query<Row>(
      `select p.id, p.display_name, p.phone, p.city, p.verification_status, p.strikes, p.parcels_accepted, p.parcels_refused,
              p.bidding_blocked_at, p.created_at,
              (select string_agg(m.role::text, ', ') from staff_members m where m.user_id = p.id) as roles
       from profiles p
       where $1 = '' or position(lower($1) in lower(p.display_name)) > 0 or position($1 in coalesce(p.phone, '')) > 0
       order by (p.bidding_blocked_at is not null) desc, p.created_at desc limit 100`,
      [term],
    ),
  );

  return (
    <div>
      <form method="get" className="flex max-w-md gap-2">
        <input name="q" defaultValue={term} className="input" placeholder={dict.common.search} maxLength={60} aria-label={dict.common.search} />
        <button type="submit" className="btn btn-secondary">
          {dict.common.search}
        </button>
      </form>
      <div className="mt-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>{dict.admin.user}</th>
              <th>{dict.account.identity}</th>
              <th>{dict.account.trust}</th>
              <th>{dict.admin.roles}</th>
              <th>{dict.admin.actions}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <span className="font-semibold">{row.display_name}</span>
                  <span className="block text-xs text-ink-muted" dir="ltr">
                    {row.phone}
                  </span>
                  <span className="block text-xs text-ink-muted">
                    {row.city} · {formatDateTime(row.created_at, locale)}
                  </span>
                </td>
                <td>
                  <span className={`badge ${TONE[row.verification_status]}`}>{dict.account.status[row.verification_status]}</span>
                </td>
                <td className="text-sm">
                  {dict.account.parcelsAccepted}: {row.parcels_accepted}
                  <br />
                  {dict.account.parcelsRefused}: {row.parcels_refused}
                  <br />
                  {dict.account.strikes}: {row.strikes}
                  {row.bidding_blocked_at && <span className="badge badge-bad ms-2">{dict.admin.blockedUsers}</span>}
                </td>
                <td className="text-sm">{row.roles ?? dict.common.none}</td>
                <td>
                  {row.bidding_blocked_at && viewer.isAdmin && (
                    <ActionForm action={staffUnblockAction} submitLabel={dict.admin.unblock} pendingLabel={dict.common.working} submitClass="btn btn-sm btn-secondary" className="flex min-w-44 flex-col gap-1" hidden={{ locale, user_id: row.id }}>
                      <input name="reason" className="input" placeholder={dict.admin.reason} required maxLength={200} aria-label={dict.admin.reason} />
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
