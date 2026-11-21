import Link from "next/link";
import { staffOrderAction } from "@/app/actions/market";
import { ActionForm } from "@/components/forms";
import { money, OrderStatusBadge } from "@/components/market";
import { requireViewer } from "@/lib/auth";
import { asService } from "@/lib/db";
import { env } from "@/lib/env";
import { fill, formatDateTime, whatsappLink } from "@/lib/format";
import { getDictionary, getLocale } from "../../dictionaries";

type Row = {
  id: string;
  status: string;
  kind: string;
  total_amount: number;
  amount: number;
  confirm_by: Date | null;
  created_at: Date;
  tracking_number: string | null;
  title: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  buyer_strikes: number;
  seller_name: string | null;
  seller_phone: string | null;
};

export default async function AdminOrdersPage() {
  const [dict, locale] = [await getDictionary(), await getLocale()];
  const viewer = await requireViewer(locale, `/${locale}/admin/orders`);
  if (!viewer.isStaff) return null;
  const rows = await asService((db) =>
    db.query<Row>(
      `select o.id, o.status, o.kind, o.total_amount, o.amount, o.confirm_by, o.created_at, o.tracking_number,
              coalesce(o.item_snapshot ->> 'title', l.title) as title,
              b.display_name as buyer_name, b.phone as buyer_phone, b.strikes as buyer_strikes,
              s.display_name as seller_name, s.phone as seller_phone
       from orders o join listings l on l.id = o.listing_id
       join profiles b on b.id = o.buyer_id join profiles s on s.id = o.seller_id
       order by (o.status in ('pending', 'confirmed', 'shipped', 'delivered')) desc, o.created_at desc limit 100`,
    ),
  );
  if (rows.length === 0) return <p className="text-ink-muted">{dict.admin.nothing}</p>;
  const step = (orderId: string, name: string, label: string, tone: string) => (
    <ActionForm action={staffOrderAction} submitLabel={label} pendingLabel={dict.common.working} submitClass={`btn btn-sm ${tone}`} className="flex flex-col gap-1" hidden={{ locale, order_id: orderId, step: name }} />
  );

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>{dict.admin.order}</th>
            <th>{dict.order.buyer}</th>
            <th>{dict.order.seller}</th>
            <th>{dict.admin.amount}</th>
            <th>{dict.admin.status}</th>
            <th>{dict.admin.actions}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const orderUrl = `${env.siteUrl}/${locale}/orders/${row.id}`;
            return (
              <tr key={row.id}>
                <td>
                  <Link href={`/${locale}/orders/${row.id}`} className="font-semibold hover:text-hibiscus">
                    {row.title}
                  </Link>
                  <span className="block text-xs text-ink-muted">
                    {dict.order.kind[row.kind as keyof typeof dict.order.kind]} · {formatDateTime(row.created_at, locale)}
                  </span>
                </td>
                <td>
                  {row.buyer_name}
                  <span className="block text-xs text-ink-muted" dir="ltr">
                    {row.buyer_phone}
                  </span>
                  {row.buyer_strikes > 0 && (
                    <span className="badge badge-bad">
                      {dict.account.strikes}: {row.buyer_strikes}
                    </span>
                  )}
                  {row.status === "pending" && row.buyer_phone && (
                    <a
                      className="block text-xs font-semibold text-nile underline"
                      target="_blank"
                      rel="noreferrer"
                      href={whatsappLink(row.buyer_phone, `${dict.site.name}: ${fill(dict.order.confirmText, { time: formatDateTime(row.confirm_by, locale) })} ${orderUrl}`)}
                    >
                      {dict.order.whatsapp}
                    </a>
                  )}
                </td>
                <td>
                  {row.seller_name}
                  <span className="block text-xs text-ink-muted" dir="ltr">
                    {row.seller_phone}
                  </span>
                </td>
                <td className="price whitespace-nowrap">{money(row.total_amount ?? row.amount, locale, dict)}</td>
                <td>
                  <OrderStatusBadge status={row.status} dict={dict} />
                  {row.status === "pending" && <span className="block text-xs text-ink-muted">{formatDateTime(row.confirm_by, locale)}</span>}
                  {row.tracking_number && (
                    <span className="block text-xs text-ink-muted" dir="ltr">
                      {row.tracking_number}
                    </span>
                  )}
                </td>
                <td>
                  <div className="flex min-w-44 flex-col gap-2">
                    {row.status === "confirmed" && step(row.id, "shipped", dict.order.markShipped, "btn-secondary")}
                    {row.status === "shipped" && step(row.id, "delivered", dict.admin.delivered, "btn-buy")}
                    {row.status === "shipped" && step(row.id, "refused", dict.admin.refused, "btn-danger")}
                    {row.status === "delivered" && step(row.id, "completed", dict.admin.complete, "btn-buy")}
                    {(row.status === "pending" || row.status === "confirmed") && (
                      <ActionForm action={staffOrderAction} submitLabel={dict.order.cancel} pendingLabel={dict.common.working} submitClass="btn btn-sm btn-ghost" className="flex flex-col gap-1" hidden={{ locale, order_id: row.id, step: "cancelled" }}>
                        <input name="reason" className="input" placeholder={dict.order.cancelReason} required maxLength={200} aria-label={dict.order.cancelReason} />
                      </ActionForm>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
