import Link from "next/link";
import type { Dictionary, Locale } from "@/app/[lang]/dictionaries";
import { formatDateTime } from "@/lib/format";
import type { OrderRow } from "@/lib/orders";
import { listingImageUrl } from "@/lib/storage";
import { money, OrderStatusBadge } from "./market";

export function OrderList({ rows, dict, locale }: { rows: OrderRow[]; dict: Dictionary; locale: Locale }) {
  if (rows.length === 0) return <p className="mt-6 text-ink-muted">{dict.order.empty}</p>;
  return (
    <ul className="mt-6 flex flex-col gap-3">
      {rows.map((order) => {
        const cover = listingImageUrl(order.cover);
        return (
          <li key={order.id}>
            <Link href={`/${locale}/orders/${order.id}`} className="card flex items-center gap-4 p-3 hover:border-hibiscus">
              <span className="h-16 w-20 flex-none overflow-hidden rounded-md bg-surface-sunken">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {cover && <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 font-semibold">{order.title}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                  <OrderStatusBadge status={order.status} dict={dict} />
                  <span>{dict.order.kind[order.kind]}</span>
                  <span>{formatDateTime(order.created_at, locale)}</span>
                </span>
              </span>
              <span className="price whitespace-nowrap">{money(order.total_amount, locale, dict)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
