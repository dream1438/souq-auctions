import Link from "next/link";
import type { Dictionary, Locale } from "@/app/[lang]/dictionaries";
import { fill, formatMoney } from "@/lib/format";
import type { Governorate, ListingCard } from "@/lib/listings";
import { listingImageUrl } from "@/lib/storage";
import { Countdown } from "./forms";

export const money = (minor: number | string | null | undefined, locale: string, dict: Dictionary) =>
  formatMoney(minor, locale, dict.common.egp);

export function ListingGrid({ rows, dict, locale }: { rows: ListingCard[]; dict: Dictionary; locale: Locale }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {rows.map((row) => (
        <ListingTile key={row.id} row={row} dict={dict} locale={locale} />
      ))}
    </div>
  );
}

export function ListingTile({ row, dict, locale }: { row: ListingCard; dict: Dictionary; locale: Locale }) {
  const cover = listingImageUrl(row.cover);
  const isAuction = row.format === "auction";
  const price = isAuction ? (row.current_price ?? row.start_price) : row.buy_now_price;
  return (
    <Link href={`/${locale}/listings/${row.id}`} className="card flex flex-col overflow-hidden hover:border-hibiscus">
      <div className="relative aspect-[4/3] bg-surface-sunken">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {cover && <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />}
        {isAuction && row.ends_at && row.status === "active" && (
          <span className="absolute bottom-2 start-2">
            <Countdown endsAt={new Date(row.ends_at).toISOString()} endedLabel={dict.listing.ended} />
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold">{row.title}</h3>
        <p className="mt-auto pt-1 text-xs text-ink-muted">
          {isAuction ? (row.bid_count > 0 ? dict.listing.currentBid : dict.listing.startingBid) : dict.listing.price}
        </p>
        <p className="price text-lg">{money(price, locale, dict)}</p>
        <p className="flex flex-wrap gap-x-2 text-xs text-ink-muted">
          <span>{isAuction ? fill(dict.listing.bids, { n: row.bid_count }) : dict.listing.format.fixed_price}</span>
          <span>{row.city}</span>
        </p>
        {row.status !== "active" && (
          <span className="badge badge-muted self-start">{dict.listing.status[row.status as keyof Dictionary["listing"]["status"]]}</span>
        )}
      </div>
    </Link>
  );
}

export type SavedAddress = { id: string; recipient_name: string; phone: string; city: string; street_address: string };

/** Delivery address: pick a saved one or type a new one. Works without JavaScript. */
export function AddressFields({
  dict,
  locale,
  saved,
  governorates,
}: {
  dict: Dictionary;
  locale: Locale;
  saved: SavedAddress[];
  governorates: Governorate[];
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="label mb-2">{dict.order.chooseAddress}</legend>
      {saved.map((address, index) => (
        <label key={address.id} className="card flex items-start gap-3 p-3 text-sm">
          <input type="radio" name="address_id" value={address.id} defaultChecked={index === 0} className="mt-1" />
          <span>
            <span className="font-semibold">{address.recipient_name}</span> · <span dir="ltr">{address.phone}</span>
            <br />
            <bdi>
              {address.street_address}, {address.city}
            </bdi>
          </span>
        </label>
      ))}
      <label className="flex items-center gap-3 text-sm font-semibold">
        <input type="radio" name="address_id" value="new" defaultChecked={saved.length === 0} />
        {dict.order.newAddress}
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="recipient_name">{dict.order.recipient}</label>
          <input id="recipient_name" name="recipient_name" className="input" maxLength={80} autoComplete="name" />
        </div>
        <div className="field">
          <label htmlFor="address_phone">{dict.order.phone}</label>
          <input id="address_phone" name="address_phone" className="input" dir="ltr" inputMode="tel" autoComplete="tel" placeholder="01012345678" />
        </div>
        <div className="field">
          <label htmlFor="governorate_id">{dict.order.governorate}</label>
          <select id="governorate_id" name="governorate_id" className="input" defaultValue="">
            <option value="" disabled>
              —
            </option>
            {governorates.map((g) => (
              <option key={g.id} value={g.id}>
                {locale === "ar" ? g.name_ar : g.name_en}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="city">{dict.order.city}</label>
          <input id="city" name="city" className="input" maxLength={60} />
        </div>
        <div className="field sm:col-span-2">
          <label htmlFor="street_address">{dict.order.street}</label>
          <input id="street_address" name="street_address" className="input" maxLength={200} autoComplete="street-address" />
        </div>
        <div className="field sm:col-span-2">
          <label htmlFor="notes">
            {dict.order.notes} <span className="hint">({dict.common.optional})</span>
          </label>
          <input id="notes" name="notes" className="input" maxLength={200} />
        </div>
      </div>
    </fieldset>
  );
}

const ORDER_TONE: Record<string, string> = {
  pending: "badge-warn",
  confirmed: "badge-ok",
  shipped: "badge-hot",
  delivered: "badge-ok",
  completed: "badge-solid",
  returned: "badge-bad",
  cancelled: "badge-muted",
};

export function OrderStatusBadge({ status, dict }: { status: string; dict: Dictionary }) {
  return (
    <span className={`badge ${ORDER_TONE[status] ?? "badge-muted"}`}>
      {dict.order.status[status as keyof Dictionary["order"]["status"]] ?? status}
    </span>
  );
}
