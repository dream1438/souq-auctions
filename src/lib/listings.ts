import "server-only";
import { asAnon, asVisitor, isUuid } from "./db";

/**
 * Read side of the marketplace. Listings are always read through the
 * listings_public view (never the listings table), under the visitor's own
 * database role, so drafts and hidden fields such as the reserve stay private.
 */

export type Category = { id: number; slug: string; name_ar: string; name_en: string; parent_id: number | null };
export type Governorate = { id: number; name_ar: string; name_en: string };

export const getCategories = () =>
  asAnon((db) => db.query<Category>("select id, slug, name_ar, name_en, parent_id from categories order by sort_order, id"));

export const getGovernorates = () =>
  asAnon((db) => db.query<Governorate>("select id, name_ar, name_en from governorates where country = 'EG' order by name_en"));

export type ListingCard = {
  id: string;
  title: string;
  format: "auction" | "fixed_price" | "classified";
  condition: string;
  city: string;
  status: string;
  start_price: number | null;
  buy_now_price: number | null;
  current_price: number | null;
  bid_count: number;
  ends_at: Date | null;
  requires_deposit: boolean;
  cover: string | null;
};

const CARD_COLUMNS = `l.id, l.title, l.format, l.condition, l.city, l.status, l.start_price, l.buy_now_price, l.current_price,
  l.bid_count, l.ends_at, l.requires_deposit,
  (select i.storage_path from listing_images i where i.listing_id = l.id order by i.sort_order limit 1) as cover`;

const SORTS: Record<string, string> = {
  ending: "l.ends_at asc nulls last, l.created_at desc",
  newest: "l.created_at desc",
  priceLow: "coalesce(l.current_price, l.start_price, l.buy_now_price) asc",
  priceHigh: "coalesce(l.current_price, l.start_price, l.buy_now_price) desc",
};

export type ListingSearch = { q?: string; category?: string; format?: string; sort?: string; page?: number };
export const PAGE_SIZE = 24;

export async function searchListings(viewerId: string | null, search: ListingSearch) {
  const q = (search.q ?? "").trim().slice(0, 80);
  const format = search.format === "auction" || search.format === "fixed_price" ? search.format : "";
  const order = SORTS[search.sort ?? ""] ?? SORTS.ending;
  const page = Math.max(1, Math.min(500, Math.floor(search.page ?? 1)));
  const where = `l.status = 'active' and l.starts_at <= now() and (l.ends_at is null or l.ends_at > now())
    and ($1 = '' or l.search_vector @@ websearch_to_tsquery('arabic', $1) or l.search_vector @@ websearch_to_tsquery('english', $1)
         or position(lower($1) in lower(l.title)) > 0)
    and ($2 = '' or l.category_id in (select c.id from categories c
                                     where c.slug = $2 or c.parent_id = (select p.id from categories p where p.slug = $2)))
    and ($3 = '' or l.format::text = $3)`;
  const params = [q, (search.category ?? "").slice(0, 60), format];
  return asVisitor(viewerId, async (db) => {
    const rows = await db.query<ListingCard>(
      `select ${CARD_COLUMNS} from listings_public l where ${where} order by ${order} limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
      params,
    );
    const total = await db.one<{ count: number }>(`select count(*)::int as count from listings_public l where ${where}`, params);
    return { rows, total: total?.count ?? 0, page };
  });
}

export const latestListings = (limit: number) =>
  asAnon((db) =>
    db.query<ListingCard>(
      `select ${CARD_COLUMNS} from listings_public l
       where l.status = 'active' and l.starts_at <= now() and (l.ends_at is null or l.ends_at > now())
       order by l.created_at desc limit $1`,
      [limit],
    ),
  );

export type ListingDetail = ListingCard & {
  seller_id: string;
  category_id: number;
  description: string;
  currency: string;
  quantity: number;
  quantity_sold: number;
  deposit_amount: number | null;
  has_reserve: boolean;
  reserve_met: boolean;
  governorate_id: number | null;
  created_at: Date;
  is_over: boolean;
  min_bid: number | null;
  shipping_cost: number | null;
  images: string[];
  seller: { display_name: string; is_verified: boolean; parcels_accepted: number; created_at: Date } | null;
  bids: { id: number; amount: number; is_automatic: boolean; created_at: Date; bidder_alias: string; is_mine: boolean }[];
  mine: { winning: boolean; max_amount: number | null; deposit_status: string | null } | null;
};

export async function getListing(viewerId: string | null, id: string): Promise<ListingDetail | null> {
  if (!isUuid(id)) return null;
  return asVisitor(viewerId, async (db) => {
    const listing = await db.one<Omit<ListingDetail, "images" | "seller" | "bids" | "mine">>(
      `select ${CARD_COLUMNS}, l.seller_id, l.category_id, l.description, l.currency, l.quantity, l.quantity_sold, l.deposit_amount,
              l.has_reserve, l.reserve_met, l.governorate_id, l.created_at,
              (l.ends_at is not null and l.ends_at <= now()) as is_over,
              case when l.format = 'auction' then
                case when l.bid_count = 0 then l.start_price else l.current_price + bid_increment(l.current_price) end
              end as min_bid,
              (select min(o.cost) from listing_shipping_options o where o.listing_id = l.id and not o.is_local_pickup) as shipping_cost
       from listings_public l where l.id = $1`,
      [id],
    );
    if (!listing) return null;
    const images = await db.query<{ storage_path: string }>(
      "select storage_path from listing_images where listing_id = $1 order by sort_order",
      [id],
    );
    const seller = await db.one<NonNullable<ListingDetail["seller"]>>(
      "select display_name, is_verified, parcels_accepted, created_at from public_profiles where id = $1",
      [listing.seller_id],
    );
    const bids = await db.query<ListingDetail["bids"][number]>(
      "select id, amount, is_automatic, created_at, bidder_alias, is_mine from bid_history where listing_id = $1 order by amount desc, id desc limit 30",
      [id],
    );
    const mine = viewerId
      ? await db.one<NonNullable<ListingDetail["mine"]>>(
          `select am_i_winning($1) as winning,
                  (select max_amount from auto_bids where listing_id = $1 and bidder_id = $2) as max_amount,
                  (select status::text from deposits where listing_id = $1 and user_id = $2) as deposit_status`,
          [id, viewerId],
        )
      : null;
    return { ...listing, images: images.map((image) => image.storage_path), seller, bids, mine };
  });
}
