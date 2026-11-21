import "server-only";
import type { Viewer } from "./auth";
import { asService, asUser, isUuid, type Db } from "./db";

export type OrderRow = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  kind: "auction" | "buy_now" | "second_chance" | "swap";
  status: "pending" | "confirmed" | "shipped" | "delivered" | "completed" | "returned" | "cancelled";
  amount: number;
  quantity: number;
  shipping_amount: number;
  total_amount: number;
  commission_amount: number;
  commission_vat_amount: number;
  confirm_by: Date | null;
  shipping_name: string | null;
  shipping_phone: string | null;
  shipping_address: string | null;
  shipping_city: string | null;
  tracking_number: string | null;
  cancelled_reason: string | null;
  created_at: Date;
  title: string;
  cover: string | null;
  buyer_name: string | null;
  seller_name: string | null;
};

const ORDER_SELECT = `
  select o.id, o.listing_id, o.buyer_id, o.seller_id, o.kind, o.status, o.amount, o.quantity, o.shipping_amount, o.total_amount,
         o.commission_amount, o.commission_vat_amount, o.confirm_by, o.shipping_name, o.shipping_phone, o.shipping_address,
         o.shipping_city, o.tracking_number, o.cancelled_reason, o.created_at,
         coalesce(o.item_snapshot ->> 'title', l.title) as title,
         (select i.storage_path from listing_images i where i.listing_id = o.listing_id order by i.sort_order limit 1) as cover,
         b.display_name as buyer_name, s.display_name as seller_name
  from orders o
  left join listings_public l on l.id = o.listing_id
  left join public_profiles b on b.id = o.buyer_id
  left join public_profiles s on s.id = o.seller_id`;

export type OrderEvent = { status: string; note: string | null; created_at: Date };

/** One order, for its buyer, its seller, or staff. Anyone else gets null. */
export async function getOrder(viewer: Viewer, id: string): Promise<{ order: OrderRow; events: OrderEvent[] } | null> {
  if (!isUuid(id)) return null;
  const read = async (db: Db) => {
    const order = await db.one<OrderRow>(`${ORDER_SELECT} where o.id = $1`, [id]);
    if (!order) return null;
    const events = await db.query<OrderEvent>("select status::text as status, note, created_at from order_events where order_id = $1 order by id", [id]);
    return { order, events };
  };
  // Row level security shows a member only their own orders. Staff outside the admin role read through the service role.
  const own = await asUser(viewer.user.id, read);
  if (own || !viewer.isStaff) return own;
  return asService(read);
}

export const ordersOf = (userId: string, side: "buyer" | "seller") =>
  asUser(userId, (db) =>
    db.query<OrderRow>(`${ORDER_SELECT} where ${side === "buyer" ? "o.buyer_id" : "o.seller_id"} = $1 order by o.created_at desc limit 100`, [userId]),
  );

export type OfferRow = { id: string; listing_id: string; amount: number; expires_at: Date; title: string; cover: string | null };

const OFFER_SELECT = `
  select s.id, s.listing_id, s.amount, s.expires_at, l.title,
         (select i.storage_path from listing_images i where i.listing_id = s.listing_id order by i.sort_order limit 1) as cover
  from second_chance_offers s join listings_public l on l.id = s.listing_id
  where s.bidder_id = $1 and s.status = 'pending' and s.expires_at > now()`;

export const openOffersOf = (userId: string) => asUser(userId, (db) => db.query<OfferRow>(`${OFFER_SELECT} order by s.expires_at`, [userId]));

export const getOpenOffer = (userId: string, offerId: string) =>
  isUuid(offerId) ? asUser(userId, (db) => db.one<OfferRow>(`${OFFER_SELECT} and s.id = $2`, [userId, offerId])) : Promise.resolve(null);

export const savedAddresses = (userId: string) =>
  asUser(userId, (db) =>
    db.query<{ id: string; recipient_name: string; phone: string; city: string; street_address: string }>(
      "select id, recipient_name, phone, city, street_address from addresses where user_id = $1 order by is_default desc, created_at desc limit 10",
      [userId],
    ),
  );
