import Link from "next/link";
import { staffListingAction } from "@/app/actions/market";
import { ActionForm } from "@/components/forms";
import { money } from "@/components/market";
import { requireViewer } from "@/lib/auth";
import { asService } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getDictionary, getLocale, type Dictionary } from "../../dictionaries";

type Row = {
  id: string;
  title: string;
  status: string;
  format: string;
  price: number | null;
  bid_count: number;
  created_at: Date;
  seller_name: string | null;
};

export default async function AdminListingsPage() {
  const [dict, locale] = [await getDictionary(), await getLocale()];
  const viewer = await requireViewer(locale, `/${locale}/admin/listings`);
  if (!viewer.isStaff) return null;
  const rows = await asService((db) =>
    db.query<Row>(
      `select l.id, l.title, l.status, l.format, coalesce(l.current_price, l.start_price, l.buy_now_price) as price, l.bid_count,
              l.created_at, p.display_name as seller_name
       from listings l join profiles p on p.id = l.seller_id
       order by (l.status = 'active') desc, l.created_at desc limit 100`,
    ),
  );
  if (rows.length === 0) return <p className="text-ink-muted">{dict.admin.nothing}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>{dict.admin.listing}</th>
            <th>{dict.order.seller}</th>
            <th>{dict.admin.amount}</th>
            <th>{dict.admin.status}</th>
            <th>{dict.admin.actions}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={`/${locale}/listings/${row.id}`} className="font-semibold hover:text-hibiscus">
                  {row.title}
                </Link>
                <span className="block text-xs text-ink-muted">
                  {dict.listing.format[row.format as keyof Dictionary["listing"]["format"]]} · {formatDateTime(row.created_at, locale)}
                </span>
              </td>
              <td>{row.seller_name}</td>
              <td className="price whitespace-nowrap">{money(row.price, locale, dict)}</td>
              <td>
                <span className="badge badge-muted">{dict.listing.status[row.status as keyof Dictionary["listing"]["status"]]}</span>
              </td>
              <td>
                {row.status === "active" && (
                  <ActionForm action={staffListingAction} submitLabel={dict.admin.takeDown} pendingLabel={dict.common.working} submitClass="btn btn-sm btn-danger" className="flex min-w-44 flex-col gap-1" hidden={{ locale, listing_id: row.id }}>
                    <input name="reason" className="input" placeholder={dict.admin.takeDownReason} required maxLength={200} aria-label={dict.admin.takeDownReason} />
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
