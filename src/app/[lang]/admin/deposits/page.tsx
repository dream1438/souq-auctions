import Link from "next/link";
import { staffDepositAction } from "@/app/actions/market";
import { ActionForm } from "@/components/forms";
import { money } from "@/components/market";
import { requireViewer } from "@/lib/auth";
import { asService } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getDictionary, getLocale, type Dictionary } from "../../dictionaries";

type Row = {
  id: string;
  status: "pending" | "held" | "released" | "forfeited";
  amount: number;
  created_at: Date;
  listing_id: string;
  title: string;
  listing_status: string;
  user_name: string | null;
  user_phone: string | null;
};

const TONE = { pending: "badge-warn", held: "badge-ok", released: "badge-muted", forfeited: "badge-bad" } as const;

export default async function AdminDepositsPage() {
  const [dict, locale] = [await getDictionary(), await getLocale()];
  const viewer = await requireViewer(locale, `/${locale}/admin/deposits`);
  if (!viewer.isStaff) return null;
  const rows = await asService((db) =>
    db.query<Row>(
      `select d.id, d.status, d.amount, d.created_at, d.listing_id, l.title, l.status as listing_status,
              p.display_name as user_name, p.phone as user_phone
       from deposits d join listings l on l.id = d.listing_id join profiles p on p.id = d.user_id
       order by (d.status in ('pending', 'held')) desc, d.created_at desc limit 100`,
    ),
  );
  if (rows.length === 0) return <p className="text-ink-muted">{dict.admin.nothing}</p>;
  const button = (id: string, to: string, label: string, tone: string) => (
    <ActionForm action={staffDepositAction} submitLabel={label} pendingLabel={dict.common.working} submitClass={`btn btn-sm ${tone}`} className="flex flex-col gap-1" hidden={{ locale, deposit_id: id, to }} />
  );

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>{dict.admin.user}</th>
            <th>{dict.admin.listing}</th>
            <th>{dict.admin.amount}</th>
            <th>{dict.admin.status}</th>
            <th>{dict.admin.actions}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                {row.user_name}
                <span className="block text-xs text-ink-muted" dir="ltr">
                  {row.user_phone}
                </span>
              </td>
              <td>
                <Link href={`/${locale}/listings/${row.listing_id}`} className="font-semibold hover:text-hibiscus">
                  {row.title}
                </Link>
                <span className="block text-xs text-ink-muted">
                  {dict.listing.status[row.listing_status as keyof Dictionary["listing"]["status"]]} · {formatDateTime(row.created_at, locale)}
                </span>
              </td>
              <td className="price whitespace-nowrap">{money(row.amount, locale, dict)}</td>
              <td>
                <span className={`badge ${TONE[row.status]}`}>{row.status}</span>
              </td>
              <td>
                <div className="flex min-w-40 flex-col gap-2">
                  {row.status === "pending" && button(row.id, "held", dict.admin.depositReceived, "btn-buy")}
                  {row.status === "held" && button(row.id, "released", dict.admin.release, "btn-secondary")}
                  {row.status === "held" && button(row.id, "forfeited", dict.admin.forfeit, "btn-danger")}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
