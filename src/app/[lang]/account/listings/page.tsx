import Link from "next/link";
import { ListingGrid } from "@/components/market";
import { requireViewer } from "@/lib/auth";
import { asUser } from "@/lib/db";
import type { ListingCard } from "@/lib/listings";
import { getDictionary, getLocale } from "../../dictionaries";

export default async function MyListingsPage() {
  const [dict, locale] = [await getDictionary(), await getLocale()];
  const viewer = await requireViewer(locale, `/${locale}/account/listings`);
  const rows = await asUser(viewer.user.id, (db) =>
    db.query<ListingCard>(
      `select l.id, l.title, l.format, l.condition, l.city, l.status, l.start_price, l.buy_now_price, l.current_price, l.bid_count,
              l.ends_at, l.requires_deposit,
              (select i.storage_path from listing_images i where i.listing_id = l.id order by i.sort_order limit 1) as cover
       from listings_public l where l.seller_id = $1 order by l.created_at desc limit 100`,
      [viewer.user.id],
    ),
  );
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="display text-3xl">{dict.account.myListings}</h1>
        <Link href={`/${locale}/sell`} className="btn btn-primary btn-sm ms-auto">
          {dict.sell.title}
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="mt-6 text-ink-muted">{dict.account.noListings}</p>
      ) : (
        <div className="mt-6">
          <ListingGrid rows={rows} dict={dict} locale={locale} />
        </div>
      )}
    </div>
  );
}
