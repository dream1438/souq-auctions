import Link from "next/link";
import { money } from "@/components/market";
import { OrderList } from "@/components/OrderList";
import { requireViewer } from "@/lib/auth";
import { fill, formatDateTime } from "@/lib/format";
import { runJobs } from "@/lib/market";
import { openOffersOf, ordersOf } from "@/lib/orders";
import { getDictionary, getLocale } from "../../dictionaries";

export default async function PurchasesPage() {
  const [dict, locale] = [await getDictionary(), await getLocale()];
  const viewer = await requireViewer(locale, `/${locale}/account/orders`);
  // Make sure wins that just ended, and offers that just opened, show up right away.
  await runJobs().catch((error) => console.error("[jobs]", error));
  const [orders, offers] = await Promise.all([ordersOf(viewer.user.id, "buyer"), openOffersOf(viewer.user.id)]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="display text-3xl">{dict.order.purchasesTitle}</h1>
      {offers.map((offer) => (
        <div key={offer.id} className="notice notice-ok mt-4 flex flex-wrap items-center gap-3">
          <span className="flex-1">
            <strong>{offer.title}</strong>
            <br />
            {fill(dict.order.offerText, { amount: money(offer.amount, locale, dict), time: formatDateTime(offer.expires_at, locale) })}
          </span>
          <Link href={`/${locale}/offers/${offer.id}`} className="btn btn-buy btn-sm">
            {dict.common.view}
          </Link>
        </div>
      ))}
      <OrderList rows={orders} dict={dict} locale={locale} />
    </div>
  );
}
