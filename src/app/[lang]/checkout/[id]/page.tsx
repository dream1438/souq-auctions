import { notFound, redirect } from "next/navigation";
import { buyNowAction } from "@/app/actions/market";
import { ActionForm } from "@/components/forms";
import { AddressFields, money } from "@/components/market";
import { requireViewer } from "@/lib/auth";
import { fill } from "@/lib/format";
import { getGovernorates, getListing } from "@/lib/listings";
import { savedAddresses } from "@/lib/orders";
import { getDictionary, getLocale } from "../../dictionaries";

/** Buy Now: choose the delivery address and place the order. Payment is cash on delivery. */
export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const [dict, locale, { id }] = [await getDictionary(), await getLocale(), await params];
  const viewer = await requireViewer(locale, `/${locale}/checkout/${id}`);
  if (viewer.profile.verification_status !== "approved") redirect(`/${locale}/account/verify`);
  const listing = await getListing(viewer.user.id, id);
  if (!listing) notFound();
  if (listing.status !== "active" || listing.buy_now_price === null || listing.seller_id === viewer.user.id) redirect(`/${locale}/listings/${id}`);

  const [saved, governorates] = await Promise.all([savedAddresses(viewer.user.id), getGovernorates()]);
  const left = listing.quantity - listing.quantity_sold;
  const total = Number(listing.buy_now_price) + Number(listing.shipping_cost ?? 0);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="display text-3xl">{dict.order.buyTitle}</h1>
      <div className="card mt-6 p-5">
        <h2 className="font-semibold">{listing.title}</h2>
        <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-ink-muted">{dict.order.itemPrice}</dt>
          <dd className="price text-end">{money(listing.buy_now_price, locale, dict)}</dd>
          <dt className="text-ink-muted">{dict.order.delivery}</dt>
          <dd className="price text-end">{Number(listing.shipping_cost) > 0 ? money(listing.shipping_cost, locale, dict) : dict.listing.freeDelivery}</dd>
          <dt className="font-semibold">{dict.order.total}</dt>
          <dd className="price text-end text-lg">{money(total, locale, dict)}</dd>
        </dl>
        <p className="notice notice-ok mt-4">{fill(dict.order.payOnDelivery, { amount: money(total, locale, dict) })}</p>
      </div>
      <div className="card mt-6 p-5">
        <ActionForm action={buyNowAction} submitLabel={dict.order.placeOrder} pendingLabel={dict.common.working} submitClass="btn btn-buy" hidden={{ locale, listing_id: id }}>
          {left > 1 && (
            <div className="field">
              <label htmlFor="quantity">{dict.order.quantity}</label>
              <input id="quantity" name="quantity" type="number" min={1} max={left} defaultValue={1} className="input" dir="ltr" />
            </div>
          )}
          <AddressFields dict={dict} locale={locale} saved={saved} governorates={governorates} />
        </ActionForm>
      </div>
    </div>
  );
}
