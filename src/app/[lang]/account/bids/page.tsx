import Link from "next/link";
import { money } from "@/components/market";
import { requireViewer } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { getDictionary, getLocale, type Dictionary } from "../../dictionaries";

type Row = { id: string; title: string; status: string; current_price: number | null; max_amount: number; winning: boolean; ends_at: Date | null };

export default async function MyBidsPage() {
  const [dict, locale] = [await getDictionary(), await getLocale()];
  const viewer = await requireViewer(locale, `/${locale}/account/bids`);
  const rows = await asUser(viewer.user.id, (db) =>
    db.query<Row>(
      `select l.id, l.title, l.status, l.current_price, a.max_amount, am_i_winning(l.id) as winning, l.ends_at
       from auto_bids a join listings_public l on l.id = a.listing_id
       where a.bidder_id = $1 order by a.updated_at desc limit 100`,
      [viewer.user.id],
    ),
  );
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="display text-3xl">{dict.account.myBids}</h1>
      {rows.length === 0 ? (
        <p className="mt-6 text-ink-muted">{dict.account.noBids}</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Link href={`/${locale}/listings/${row.id}`} className="card flex flex-wrap items-center gap-3 p-4 hover:border-hibiscus">
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 font-semibold">{row.title}</span>
                  <span className="mt-1 flex flex-wrap gap-2 text-sm text-ink-muted">
                    <span className={`badge ${row.winning ? "badge-ok" : "badge-bad"}`}>{row.winning ? dict.bid.winning : dict.bid.outbid}</span>
                    {row.status !== "active" && (
                      <span className="badge badge-muted">{dict.listing.status[row.status as keyof Dictionary["listing"]["status"]]}</span>
                    )}
                  </span>
                </span>
                <span className="text-end text-sm">
                  <span className="block text-ink-muted">{dict.listing.currentBid}</span>
                  <span className="price">{money(row.current_price, locale, dict)}</span>
                </span>
                <span className="text-end text-sm">
                  <span className="block text-ink-muted">{dict.bid.max}</span>
                  <span className="price">{money(row.max_amount, locale, dict)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
