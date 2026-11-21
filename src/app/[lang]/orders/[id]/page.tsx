import Link from "next/link";
import { notFound } from "next/navigation";
import { confirmOrderAction, markShippedAction } from "@/app/actions/market";
import { ActionForm } from "@/components/forms";
import { AddressFields, money, OrderStatusBadge } from "@/components/market";
import { requireViewer } from "@/lib/auth";
import { fill, formatDateTime } from "@/lib/format";
import { getGovernorates, getListing } from "@/lib/listings";
import { settleListing } from "@/lib/market";
import { getOrder, savedAddresses } from "@/lib/orders";
import { type Dictionary, getDictionary, getLocale } from "../../dictionaries";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const [dict, locale, { id }] = [await getDictionary(), await getLocale(), await params];
  const viewer = await requireViewer(locale, `/${locale}/orders/${id}`);
  let found = await getOrder(viewer, id);
  if (!found) notFound();
  // A win that was not confirmed in time is cancelled here, without waiting for the scheduled job.
  if (found.order.status === "pending" && found.order.confirm_by && new Date(found.order.confirm_by) < new Date()) {
    await settleListing(found.order.listing_id);
    found = (await getOrder(viewer, id)) ?? found;
  }
  const { order, events } = found;
  const isBuyer = order.buyer_id === viewer.user.id;
  const isSeller = order.seller_id === viewer.user.id;
  const needsConfirm = isBuyer && order.status === "pending";
  const payout = Number(order.amount) - Number(order.commission_amount) - Number(order.commission_vat_amount);
  const deadline = formatDateTime(order.confirm_by, locale);

  const [saved, governorates, listing] = needsConfirm
    ? await Promise.all([savedAddresses(viewer.user.id), getGovernorates(), getListing(viewer.user.id, order.listing_id)])
    : [[], [], null];
  // Until the buyer confirms, the delivery cost is not on the order yet, so show what it will be.
  const delivery = needsConfirm ? Number(listing?.shipping_cost ?? 0) : Number(order.shipping_amount);
  const total = needsConfirm ? Number(order.amount) + delivery : Number(order.total_amount);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="display text-3xl">{dict.order.title}</h1>
        <OrderStatusBadge status={order.status} dict={dict} />
        <span className="badge badge-muted">{dict.order.kind[order.kind]}</span>
      </div>

      <div className="card mt-6 p-5">
        <Link href={`/${locale}/listings/${order.listing_id}`} className="font-semibold hover:text-hibiscus">
          {order.title}
        </Link>
        <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-ink-muted">{dict.order.itemPrice}</dt>
          <dd className="price text-end">{money(order.amount, locale, dict)}</dd>
          <dt className="text-ink-muted">{dict.order.delivery}</dt>
          <dd className="price text-end">{delivery ? money(delivery, locale, dict) : dict.listing.freeDelivery}</dd>
          <dt className="font-semibold">{dict.order.total}</dt>
          <dd className="price text-end text-lg">{money(total, locale, dict)}</dd>
          {(isSeller || viewer.isStaff) && (
            <>
              <dt className="text-ink-muted">{dict.order.commission}</dt>
              <dd className="price text-end">− {money(Number(order.commission_amount) + Number(order.commission_vat_amount), locale, dict)}</dd>
              <dt className="font-semibold">{dict.order.payout}</dt>
              <dd className="price text-end">{money(payout, locale, dict)}</dd>
            </>
          )}
        </dl>
        <p className="mt-3 text-sm text-ink-muted">
          {dict.order.buyer}: {order.buyer_name} · {dict.order.seller}: {order.seller_name}
        </p>
      </div>

      {needsConfirm && (
        <div className="card mt-6 p-5">
          <h2 className="text-lg font-semibold">{dict.order.confirmTitle}</h2>
          <p className="notice notice-warn mt-2">{fill(dict.order.confirmText, { time: deadline })}</p>
          <p className="mt-2 text-sm text-ink-muted">{fill(dict.order.payOnDelivery, { amount: money(total, locale, dict) })}</p>
          <div className="mt-4">
            <ActionForm action={confirmOrderAction} submitLabel={dict.order.confirmButton} pendingLabel={dict.common.working} submitClass="btn btn-buy" hidden={{ locale, order_id: id }}>
              <AddressFields dict={dict} locale={locale} saved={saved} governorates={governorates} />
            </ActionForm>
          </div>
        </div>
      )}

      {isSeller && order.status === "pending" && <p className="notice notice-warn mt-6">{fill(dict.order.waitingBuyer, { time: deadline })}</p>}
      {isBuyer && order.status === "confirmed" && <p className="notice notice-ok mt-6">{dict.order.confirmed}</p>}
      {order.status === "cancelled" && (
        <p className="notice notice-bad mt-6">
          {order.cancelled_reason === "not_confirmed_in_time" ? dict.order.expiredNote : order.cancelled_reason}
        </p>
      )}

      {order.shipping_address && (isSeller || isBuyer || viewer.isStaff) && (
        <div className="card mt-6 p-5">
          <h2 className="font-semibold">{dict.order.shipTo}</h2>
          <p className="mt-1 text-sm">
            {order.shipping_name} · <span dir="ltr">{order.shipping_phone}</span>
            <br />
            <bdi>
              {order.shipping_address}, {order.shipping_city}
            </bdi>
          </p>
          {order.tracking_number && (
            <p className="mt-2 text-sm text-ink-muted">
              {dict.order.tracking}: <span dir="ltr">{order.tracking_number}</span>
            </p>
          )}
        </div>
      )}

      {(isSeller || viewer.isStaff) && order.status === "confirmed" && (
        <div className="card mt-6 p-5">
          <ActionForm action={markShippedAction} submitLabel={dict.order.markShipped} pendingLabel={dict.common.working} hidden={{ locale, order_id: id }}>
            <div className="field">
              <label htmlFor="tracking_number">
                {dict.order.tracking} <span className="hint">({dict.common.optional})</span>
              </label>
              <input id="tracking_number" name="tracking_number" className="input" dir="ltr" maxLength={60} />
            </div>
          </ActionForm>
        </div>
      )}

      <section className="mt-6">
        <h2 className="font-semibold">{dict.order.history}</h2>
        <ol className="mt-2 flex flex-col gap-1 text-sm">
          {events.map((event, index) => (
            <li key={index} className="flex flex-wrap gap-2">
              <span className="text-ink-muted">{formatDateTime(event.created_at, locale)}</span>
              <span>{event.note === "created" ? dict.order.created : (dict.order.status[event.status as keyof Dictionary["order"]["status"]] ?? event.status)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
