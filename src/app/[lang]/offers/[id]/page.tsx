import { redirect } from "next/navigation";
import { acceptOfferAction, declineOfferAction } from "@/app/actions/market";
import { ActionForm } from "@/components/forms";
import { AddressFields, money } from "@/components/market";
import { requireViewer } from "@/lib/auth";
import { fill, formatDateTime } from "@/lib/format";
import { getGovernorates } from "@/lib/listings";
import { getOpenOffer, savedAddresses } from "@/lib/orders";
import { getDictionary, getLocale } from "../../dictionaries";

/** Backup winner: the first winner did not confirm, so the next bidder is offered the item. */
export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const [dict, locale, { id }] = [await getDictionary(), await getLocale(), await params];
  const viewer = await requireViewer(locale, `/${locale}/offers/${id}`);
  const offer = await getOpenOffer(viewer.user.id, id);
  if (!offer) redirect(`/${locale}/account/orders`);
  const [saved, governorates] = await Promise.all([savedAddresses(viewer.user.id), getGovernorates()]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="display text-3xl">{dict.order.offerTitle}</h1>
      <div className="card mt-6 p-5">
        <h2 className="font-semibold">{offer.title}</h2>
        <p className="notice notice-ok mt-3">
          {fill(dict.order.offerText, { amount: money(offer.amount, locale, dict), time: formatDateTime(offer.expires_at, locale) })}
        </p>
      </div>
      <div className="card mt-6 p-5">
        <ActionForm action={acceptOfferAction} submitLabel={dict.order.accept} pendingLabel={dict.common.working} submitClass="btn btn-buy" hidden={{ locale, offer_id: id }}>
          <AddressFields dict={dict} locale={locale} saved={saved} governorates={governorates} />
        </ActionForm>
      </div>
      <div className="mt-4">
        <ActionForm action={declineOfferAction} submitLabel={dict.order.decline} pendingLabel={dict.common.working} submitClass="btn btn-ghost" hidden={{ locale, offer_id: id }} />
      </div>
    </div>
  );
}
