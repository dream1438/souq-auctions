import Link from "next/link";
import { notFound } from "next/navigation";
import { placeBidAction, requestDepositAction, staffListingAction } from "@/app/actions/market";
import { ActionForm, AutoRefresh, Countdown } from "@/components/forms";
import { money } from "@/components/market";
import { getViewer } from "@/lib/auth";
import { asAnon } from "@/lib/db";
import { fill, formatDateTime } from "@/lib/format";
import { getListing } from "@/lib/listings";
import { settleListing } from "@/lib/market";
import { listingImageUrl } from "@/lib/storage";
import { type Dictionary, getDictionary, getLocale } from "../../dictionaries";

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const [dict, locale, { id }] = [await getDictionary(), await getLocale(), await params];
  const viewer = await getViewer();
  const viewerId = viewer?.user.id ?? null;

  let listing = await getListing(viewerId, id);
  if (!listing) notFound();
  // If the timer ran out, close the auction now instead of waiting for the scheduled job.
  if ((listing.status === "active" && listing.is_over) || listing.status === "reserved") {
    await settleListing(id);
    listing = (await getListing(viewerId, id)) ?? listing;
  }

  const hours = await asAnon((db) => db.one<{ hours: number }>("select setting_int('win_confirmation_hours', 12)::int as hours"));
  const isAuction = listing.format === "auction";
  const live = listing.status === "active" && !listing.is_over;
  const isSeller = viewerId === listing.seller_id;
  const verified = viewer?.profile?.verification_status === "approved";
  const price = isAuction ? (listing.current_price ?? listing.start_price) : listing.buy_now_price;
  const canBuyNow =
    live && listing.buy_now_price !== null && (!isAuction || listing.bid_count === 0 || (listing.has_reserve && !listing.reserve_met));
  const depositOk = !listing.requires_deposit || listing.mine?.deposit_status === "held";
  const images = listing.images.map((path) => listingImageUrl(path)).filter((url): url is string => Boolean(url));
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/listings/${id}`)}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {isAuction && live && <AutoRefresh endsAt={listing.ends_at ? new Date(listing.ends_at).toISOString() : null} />}
      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div>
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto rounded-md">
            {images.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt={listing.title} className="aspect-[4/3] w-full flex-none snap-center rounded-md border border-line object-cover sm:w-[85%]" />
            ))}
          </div>
          <h1 className="mt-5 text-2xl font-bold">
            <bdi>{listing.title}</bdi>
          </h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="badge badge-muted">{dict.listing.format[listing.format]}</span>
            <span className="badge badge-muted">
              {dict.listing.conditionLabel}: {dict.listing.condition[listing.condition as keyof Dictionary["listing"]["condition"]]}
            </span>
            <span className="badge badge-muted">{listing.city}</span>
            {listing.status !== "active" && (
              <span className="badge badge-warn">{dict.listing.status[listing.status as keyof Dictionary["listing"]["status"]]}</span>
            )}
          </div>

          <section className="mt-6">
            <h2 className="text-lg font-semibold">{dict.listing.description}</h2>
            <p className="mt-2 whitespace-pre-line text-ink" dir="auto">{listing.description}</p>
          </section>

          {listing.seller && (
            <section className="card mt-6 p-4">
              <h2 className="text-sm font-semibold text-ink-muted">{dict.listing.seller}</h2>
              <p className="mt-1 flex flex-wrap items-center gap-2">
                <span className="font-semibold">{listing.seller.display_name}</span>
                {listing.seller.is_verified && <span className="badge badge-solid">{dict.listing.verified}</span>}
                <span className="text-sm text-ink-muted">
                  {fill(dict.listing.parcels, { n: listing.seller.parcels_accepted })} ·{" "}
                  {fill(dict.listing.memberSince, { year: new Date(listing.seller.created_at).getFullYear() })}
                </span>
              </p>
            </section>
          )}

          {isAuction && (
            <section className="mt-6">
              <h2 className="text-lg font-semibold">{dict.listing.bidHistory}</h2>
              {listing.bids.length === 0 ? (
                <p className="mt-2 text-ink-muted">{dict.listing.noBids}</p>
              ) : (
                <table className="table mt-2">
                  <tbody>
                    {listing.bids.map((bid) => (
                      <tr key={bid.id}>
                        <td>{bid.is_mine ? <strong>{dict.listing.you}</strong> : <span dir="ltr">{bid.bidder_alias}</span>}</td>
                        <td className="price">{money(bid.amount, locale, dict)}</td>
                        <td className="text-sm text-ink-muted">
                          {formatDateTime(bid.created_at, locale)}
                          {bid.is_automatic && ` · ${dict.listing.automatic}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <div className="panel flex flex-col gap-3">
            <p className="text-sm text-ink-muted">
              {isAuction ? (listing.bid_count > 0 ? dict.listing.currentBid : dict.listing.startingBid) : dict.listing.price}
            </p>
            <p className="price text-4xl">{money(price, locale, dict)}</p>
            {isAuction && (
              <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                <span>{listing.bid_count > 0 ? fill(dict.listing.bids, { n: listing.bid_count }) : dict.listing.noBids}</span>
                {listing.ends_at && <Countdown endsAt={new Date(listing.ends_at).toISOString()} endedLabel={dict.listing.ended} />}
                {listing.has_reserve && (
                  <span className={`badge ${listing.reserve_met ? "badge-ok" : "badge-muted"}`}>
                    {listing.reserve_met ? dict.listing.reserveMet : dict.listing.reserveNotMet}
                  </span>
                )}
              </p>
            )}
            {!isAuction && live && <p className="text-sm text-ink-muted">{fill(dict.listing.quantityLeft, { n: listing.quantity - listing.quantity_sold })}</p>}
            <p className="text-sm text-ink-muted">
              {Number(listing.shipping_cost) > 0 ? fill(dict.listing.deliveryCost, { price: money(listing.shipping_cost, locale, dict) }) : dict.listing.freeDelivery} ·{" "}
              {dict.listing.cod}
            </p>

            {listing.status === "reserved" && <p className="notice notice-warn">{dict.listing.wonBy}</p>}
            {listing.status === "ended" && <p className="notice notice-warn">{dict.listing.noSale}</p>}
            {isSeller && <p className="notice notice-warn">{dict.listing.yours}</p>}

            {live && !isSeller && listing.mine?.max_amount != null && (
              <p className={`badge self-start ${listing.mine.winning ? "badge-ok" : "badge-bad"}`}>
                {listing.mine.winning ? dict.bid.winning : dict.bid.outbid}
              </p>
            )}

            {live && !isSeller && !viewer && (
              <Link href={signInHref} className="btn btn-primary">
                {dict.bid.signIn}
              </Link>
            )}
            {live && !isSeller && viewer && !verified && (
              <Link href={`/${locale}/account/verify`} className="btn btn-primary">
                {dict.bid.verify}
              </Link>
            )}

            {live && !isSeller && verified && listing.requires_deposit && !depositOk && (
              <div className="flex flex-col gap-2">
                <p className="notice notice-warn">{fill(dict.listing.depositInfo, { amount: money(listing.deposit_amount, locale, dict) })}</p>
                {listing.mine?.deposit_status === "pending" ? (
                  <p className="text-sm text-ink-muted">{fill(dict.bid.depositPending, { amount: money(listing.deposit_amount, locale, dict) })}</p>
                ) : (
                  <ActionForm action={requestDepositAction} submitLabel={dict.bid.depositRequest} pendingLabel={dict.common.working} submitClass="btn btn-secondary" hidden={{ locale, listing_id: id }} />
                )}
              </div>
            )}

            {live && !isSeller && verified && isAuction && depositOk && (
              <ActionForm
                action={placeBidAction}
                submitLabel={listing.mine?.winning ? dict.bid.raise : dict.bid.place}
                pendingLabel={dict.common.working}
                hidden={{ locale, listing_id: id }}
              >
                <div className="field">
                  <label htmlFor="amount">{dict.bid.max}</label>
                  <input id="amount" name="amount" className="input" inputMode="decimal" dir="ltr" required autoComplete="off" />
                  <p className="hint">
                    {fill(dict.bid.minimum, { amount: money(listing.min_bid, locale, dict) })} {dict.bid.maxHint}
                  </p>
                </div>
              </ActionForm>
            )}

            {canBuyNow && !isSeller && verified && depositOk && (
              <Link href={`/${locale}/checkout/${id}`} className="btn btn-buy">
                {fill(dict.listing.buyNowFor, { price: money(listing.buy_now_price, locale, dict) })}
              </Link>
            )}
          </div>

          <div className="card p-4">
            <h2 className="font-semibold text-nile">{dict.listing.guaranteeTitle}</h2>
            <p className="mt-1 text-sm text-ink-muted">{fill(dict.listing.guaranteeText, { hours: hours?.hours ?? 12 })}</p>
          </div>

          {viewer?.isStaff && (listing.status === "active" || listing.status === "scheduled") && (
            <div className="card p-4">
              <ActionForm action={staffListingAction} submitLabel={dict.admin.takeDown} pendingLabel={dict.common.working} submitClass="btn btn-danger btn-sm" hidden={{ locale, listing_id: id }}>
                <div className="field">
                  <label htmlFor="reason">{dict.admin.takeDownReason}</label>
                  <input id="reason" name="reason" className="input" required maxLength={200} />
                </div>
              </ActionForm>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
