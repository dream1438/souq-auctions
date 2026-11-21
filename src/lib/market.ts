import "server-only";
import { asService, asUser, isUuid, type Db } from "./db";
import { AppError } from "./errors";

/**
 * The marketplace workflows that move an order or an auction from one state
 * to the next. Bidding and Buy Now run as the visitor, inside the database
 * functions place_bid and buy_now. Everything else here runs with the service
 * role, so each function checks who is asking before it changes anything.
 */

type Actor = { id: string; isStaff: boolean };

// ---------------------------------------------------------------------------
// Notifications. Messages are queued in the notifications table. Until a
// WhatsApp sender is connected, the team sends them by hand from the admin
// pages, and people also see the same information inside their account.
// ---------------------------------------------------------------------------
async function notify(db: Db, userId: string, type: string, payload: Record<string, unknown>, dedupeKey: string) {
  await db.query(
    `insert into notifications (user_id, type, channel, template, payload, dedupe_key)
     select $1, $2,
            case when coalesce((select granted from consents c
                                where c.user_id = $1 and c.kind = 'whatsapp_transactional'
                                order by c.created_at desc limit 1), false)
                 then 'whatsapp' else 'in_app' end::notification_channel,
            $2, $3::jsonb, $4
     on conflict (dedupe_key) do nothing`,
    [userId, type, JSON.stringify(payload), dedupeKey],
  );
}

async function audit(db: Db, actorId: string, action: string, entityType: string, entityId: string, details: Record<string, unknown>) {
  await db.query("insert into audit_log (actor_id, action, entity_type, entity_id, details) values ($1, $2, $3, $4, $5::jsonb)", [
    actorId,
    action,
    entityType,
    entityId,
    JSON.stringify(details),
  ]);
}

// ---------------------------------------------------------------------------
// Bidding and Buy Now
// ---------------------------------------------------------------------------
export type BidResult = { current_price: number; bid_count: number; ends_at: Date; reserve_met: boolean; is_leading: boolean };

export async function placeBid(userId: string, listingId: string, maxAmount: number): Promise<BidResult> {
  if (!isUuid(listingId)) throw new AppError("listing_not_found");
  const before = await asService((db) =>
    db.one<{ highest_bidder_id: string | null; title: string }>("select highest_bidder_id, title from listings where id = $1", [listingId]),
  );
  // place_bid checks identity, blocks, deposits, increments and the anti-sniping extension.
  const result = await asUser(userId, (db) => db.one<BidResult>("select * from place_bid($1, $2)", [listingId, maxAmount]));
  if (!result) throw new AppError("generic");
  if (result.is_leading && before?.highest_bidder_id && before.highest_bidder_id !== userId) {
    const previous = before.highest_bidder_id;
    await asService((db) =>
      notify(db, previous, "outbid", { listing_id: listingId, title: before.title, current_price: result.current_price }, `outbid:${listingId}:${result.bid_count}`),
    );
  }
  return result;
}

export async function buyNow(userId: string, listingId: string, addressId: string, quantity: number): Promise<string> {
  if (!isUuid(listingId)) throw new AppError("listing_not_found");
  if (!isUuid(addressId)) throw new AppError("address_not_found");
  const order = await asUser(userId, (db) =>
    db.one<{ id: string; seller_id: string }>("select id, seller_id from buy_now($1, $2, 'cod', $3)", [listingId, addressId, quantity]),
  );
  if (!order) throw new AppError("generic");
  // The buyer has just chosen the address and placed the order, so it needs no second confirmation.
  await asService(async (db) => {
    await db.query("update orders set status = 'confirmed' where id = $1 and status = 'pending'", [order.id]);
    await notify(db, order.seller_id, "order_confirmed", { order_id: order.id }, `order_confirmed:${order.id}`);
  });
  return order.id;
}

// ---------------------------------------------------------------------------
// Closing auctions and the Bid Guarantee
// ---------------------------------------------------------------------------

/** Closes one auction if its time is up. Returns the new order id when there is a winner. */
export async function closeAuction(listingId: string): Promise<string | null> {
  if (!isUuid(listingId)) return null;
  return asService(async (db) => {
    const closed = await db.one<{ order_id: string | null }>("select close_auction($1) as order_id", [listingId]);
    if (!closed?.order_id) return null;
    const order = await db.one<{ buyer_id: string; seller_id: string; amount: number; confirm_by: Date }>(
      "select buyer_id, seller_id, amount, confirm_by from orders where id = $1",
      [closed.order_id],
    );
    if (order) {
      const payload = { order_id: closed.order_id, listing_id: listingId, amount: order.amount, confirm_by: order.confirm_by };
      await notify(db, order.buyer_id, "auction_won", payload, `auction_won:${closed.order_id}`);
      await notify(db, order.seller_id, "auction_sold", payload, `auction_sold:${closed.order_id}`);
    }
    return closed.order_id;
  });
}

/**
 * Backup winner. Offers the item to the next highest verified bidder at their
 * own maximum bid. When nobody is left, the listing ends without a sale.
 */
async function offerToNextBidder(db: Db, listingId: string): Promise<boolean> {
  const next = await db.one<{ bidder_id: string; max_amount: number }>(
    `select a.bidder_id, a.max_amount
     from auto_bids a
     join profiles p on p.id = a.bidder_id
     left join listing_private lp on lp.listing_id = a.listing_id
     where a.listing_id = $1
       and p.verification_status = 'approved' and p.bidding_blocked_at is null
       and not exists (select 1 from orders o where o.listing_id = a.listing_id and o.buyer_id = a.bidder_id)
       and not exists (select 1 from second_chance_offers s where s.listing_id = a.listing_id and s.bidder_id = a.bidder_id)
       and (lp.reserve_price is null or a.max_amount >= lp.reserve_price)
     order by a.max_amount desc, a.updated_at asc
     limit 1`,
    [listingId],
  );
  if (!next) {
    const ended = await db.one<{ seller_id: string }>(
      "update listings set status = 'ended' where id = $1 and status = 'reserved' returning seller_id",
      [listingId],
    );
    if (ended) await notify(db, ended.seller_id, "auction_no_sale", { listing_id: listingId }, `auction_no_sale:${listingId}`);
    return false;
  }
  const offer = await db.one<{ id: string; expires_at: Date }>(
    `insert into second_chance_offers (listing_id, bidder_id, amount, expires_at)
     values ($1, $2, $3, now() + make_interval(hours => setting_int('second_chance_hours', 12)::int))
     returning id, expires_at`,
    [listingId, next.bidder_id, next.max_amount],
  );
  if (offer) {
    await notify(
      db,
      next.bidder_id,
      "second_chance",
      { offer_id: offer.id, listing_id: listingId, amount: next.max_amount, expires_at: offer.expires_at },
      `second_chance:${offer.id}`,
    );
  }
  return true;
}

async function restoreStock(db: Db, listingId: string, quantity: number) {
  await db.query(
    `update listings
     set quantity_sold = greatest(quantity_sold - $2, 0),
         status = case when status = 'sold' and (ends_at is null or ends_at > now()) then 'active'::listing_status else status end
     where id = $1`,
    [listingId, quantity],
  );
}

/** Cancels one order whose confirmation window has passed and moves the item on. */
async function expireOrder(orderId: string): Promise<boolean> {
  return asService(async (db) => {
    const order = await db.one<{ id: string; listing_id: string; buyer_id: string; kind: string; quantity: number }>(
      "select id, listing_id, buyer_id, kind, quantity from orders where id = $1 and status = 'pending' and confirm_by < now() for update",
      [orderId],
    );
    if (!order) return false;
    await db.query("update orders set status = 'cancelled', cancelled_reason = 'not_confirmed_in_time' where id = $1", [order.id]);
    await db.query("select record_trust_event($1, 'win_unconfirmed', $2, null)", [order.buyer_id, order.id]);
    if (order.kind === "buy_now") await restoreStock(db, order.listing_id, order.quantity);
    else await offerToNextBidder(db, order.listing_id);
    return true;
  });
}

async function expireOffer(offerId: string): Promise<boolean> {
  return asService(async (db) => {
    const offer = await db.one<{ listing_id: string }>(
      "update second_chance_offers set status = 'expired', responded_at = now() where id = $1 and status = 'pending' and expires_at < now() returning listing_id",
      [offerId],
    );
    if (!offer) return false;
    await offerToNextBidder(db, offer.listing_id);
    return true;
  });
}

export type JobReport = { closed: number; expired: number; offers: number };

/**
 * The housekeeping the marketplace needs every minute or so: close auctions
 * whose time is up, cancel wins nobody confirmed, and expire backup offers.
 * Safe to run at any time and from several places at once; every step
 * re-checks its row under a lock.
 */
export async function runJobs(): Promise<JobReport> {
  const due = await asService(async (db) => ({
    auctions: await db.query<{ id: string }>(
      "select id from listings where format = 'auction' and status = 'active' and ends_at <= now() order by ends_at limit 200",
    ),
    orders: await db.query<{ id: string }>("select id from orders where status = 'pending' and confirm_by < now() order by confirm_by limit 200"),
    offers: await db.query<{ id: string }>(
      "select id from second_chance_offers where status = 'pending' and expires_at < now() order by expires_at limit 200",
    ),
  }));
  const report: JobReport = { closed: 0, expired: 0, offers: 0 };
  for (const { id } of due.auctions) {
    // One failure must not stop the rest of the batch.
    await closeAuction(id).then(() => (report.closed += 1), (error) => console.error("[jobs] close_auction", id, error));
  }
  for (const { id } of due.orders) if (await expireOrder(id)) report.expired += 1;
  for (const { id } of due.offers) if (await expireOffer(id)) report.offers += 1;
  return report;
}

/** Brings one listing up to date when someone opens it, so nothing waits for the scheduled job. */
export async function settleListing(listingId: string): Promise<void> {
  await closeAuction(listingId);
  const stale = await asService(async (db) => ({
    orders: await db.query<{ id: string }>("select id from orders where listing_id = $1 and status = 'pending' and confirm_by < now()", [listingId]),
    offers: await db.query<{ id: string }>(
      "select id from second_chance_offers where listing_id = $1 and status = 'pending' and expires_at < now()",
      [listingId],
    ),
  }));
  for (const { id } of stale.orders) await expireOrder(id);
  for (const { id } of stale.offers) await expireOffer(id);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
type AddressRow = { recipient_name: string; phone: string; street_address: string; city: string; governorate_id: number | null };

async function addressOf(db: Db, userId: string, addressId: string): Promise<AddressRow> {
  if (!isUuid(addressId)) throw new AppError("address_not_found");
  const address = await db.one<AddressRow>(
    "select recipient_name, phone, street_address, city, governorate_id from addresses where id = $1 and user_id = $2",
    [addressId, userId],
  );
  if (!address) throw new AppError("address_not_found");
  return address;
}

const shippingCostSql = "coalesce((select min(cost) from listing_shipping_options where listing_id = $1 and not is_local_pickup), 0)";

/** The winner confirms an auction win and tells us where to deliver it. */
export async function confirmOrder(userId: string, orderId: string, addressId: string): Promise<void> {
  if (!isUuid(orderId)) throw new AppError("order_not_found");
  await asService(async (db) => {
    const order = await db.one<{ id: string; listing_id: string; seller_id: string; confirm_by: Date | null; expired: boolean }>(
      "select id, listing_id, seller_id, confirm_by, (confirm_by < now()) as expired from orders where id = $1 and buyer_id = $2 and status = 'pending' for update",
      [orderId, userId],
    );
    if (!order) throw new AppError("order_not_found");
    if (order.expired) throw new AppError("confirmation_expired");
    const address = await addressOf(db, userId, addressId);
    await db.query(
      `update orders
       set shipping_name = $2, shipping_phone = $3, shipping_address = $4, shipping_city = $5, shipping_governorate_id = $6,
           shipping_amount = ${shippingCostSql.replace("$1", "$7")}, status = 'confirmed'
       where id = $1`,
      [order.id, address.recipient_name, address.phone, address.street_address, address.city, address.governorate_id, order.listing_id],
    );
    await db.query("update listings set status = 'sold' where id = $1 and status = 'reserved'", [order.listing_id]);
    await notify(db, order.seller_id, "order_confirmed", { order_id: order.id }, `order_confirmed:${order.id}`);
  });
}

/** The backup winner accepts the offer. This creates a confirmed order at the offered amount. */
export async function acceptOffer(userId: string, offerId: string, addressId: string): Promise<string> {
  if (!isUuid(offerId)) throw new AppError("offer_not_available");
  return asService(async (db) => {
    const offer = await db.one<{ id: string; listing_id: string; amount: number }>(
      "select id, listing_id, amount from second_chance_offers where id = $1 and bidder_id = $2 and status = 'pending' and expires_at > now() for update",
      [offerId, userId],
    );
    if (!offer) throw new AppError("offer_not_available");
    const address = await addressOf(db, userId, addressId);
    const listing = await db.one<{ seller_id: string; category_id: number; currency: string; status: string }>(
      "select seller_id, category_id, currency, status from listings where id = $1 for update",
      [offer.listing_id],
    );
    if (!listing || listing.status !== "reserved") throw new AppError("offer_not_available");
    await db.query("update second_chance_offers set status = 'accepted', responded_at = now() where id = $1", [offer.id]);
    const order = await db.one<{ id: string }>(
      `insert into orders (listing_id, buyer_id, seller_id, kind, amount, quantity, unit_price, shipping_amount,
                           commission_bps, commission_amount, commission_vat_amount, currency, payment_method, status,
                           shipping_name, shipping_phone, shipping_address, shipping_city, shipping_governorate_id, item_snapshot)
       select $1::uuid, $2::uuid, $3::uuid, 'second_chance', $4::bigint, 1, $4::bigint, ${shippingCostSql},
              coalesce(f.rate_bps, 800), coalesce(f.fee, 0), (coalesce(f.fee, 0) * setting_int('vat_bps', 1400) + 5000) / 10000,
              $5::char(3), 'cod', 'pending', $6, $7, $8, $9, $10, listing_snapshot($1::uuid)
       from (select 1) one left join lateral commission_for($11::smallint, $5::char(3), $4::bigint) f on true
       returning id`,
      [
        offer.listing_id,
        userId,
        listing.seller_id,
        offer.amount,
        listing.currency,
        address.recipient_name,
        address.phone,
        address.street_address,
        address.city,
        address.governorate_id,
        listing.category_id,
      ],
    );
    if (!order) throw new AppError("generic");
    await db.query("update orders set status = 'confirmed' where id = $1", [order.id]);
    await db.query("update listings set status = 'sold' where id = $1", [offer.listing_id]);
    await notify(db, listing.seller_id, "order_confirmed", { order_id: order.id }, `order_confirmed:${order.id}`);
    return order.id;
  });
}

export async function declineOffer(userId: string, offerId: string): Promise<void> {
  if (!isUuid(offerId)) throw new AppError("offer_not_available");
  await asService(async (db) => {
    const offer = await db.one<{ listing_id: string }>(
      "update second_chance_offers set status = 'declined', responded_at = now() where id = $1 and bidder_id = $2 and status = 'pending' returning listing_id",
      [offerId, userId],
    );
    if (!offer) throw new AppError("offer_not_available");
    await offerToNextBidder(db, offer.listing_id);
  });
}

/** The seller (or staff) hands the parcel to the courier. */
export async function markShipped(actor: Actor, orderId: string, trackingNumber: string): Promise<void> {
  if (!isUuid(orderId)) throw new AppError("order_not_found");
  await asService(async (db) => {
    const order = await db.one<{ id: string; buyer_id: string; seller_id: string; total_amount: number }>(
      "select id, buyer_id, seller_id, total_amount from orders where id = $1 and status = 'confirmed' for update",
      [orderId],
    );
    if (!order) throw new AppError("order_transition_not_allowed");
    if (order.seller_id !== actor.id && !actor.isStaff) throw new AppError("not_allowed");
    const tracking = trackingNumber.trim().slice(0, 60) || null;
    await db.query("update orders set status = 'shipped', tracking_number = $2 where id = $1", [order.id, tracking]);
    await db.query(
      "insert into shipments (order_id, courier, tracking_number, status, cod_amount, shipped_at) values ($1, 'bosta', $2, 'in_transit', $3, now())",
      [order.id, tracking, order.total_amount],
    );
    await notify(db, order.buyer_id, "order_shipped", { order_id: order.id, tracking_number: tracking }, `order_shipped:${order.id}`);
    // Staff stepping in for the seller is worth a trace; the seller's own action is already in the order history.
    if (order.seller_id !== actor.id) await audit(db, actor.id, "order_shipped", "order", order.id, {});
  });
}

// ---------------------------------------------------------------------------
// Staff actions
// ---------------------------------------------------------------------------
const staffOnly = (actor: Actor) => {
  if (!actor.isStaff) throw new AppError("not_allowed");
};

/** The parcel was delivered and the courier collected the cash. */
export async function staffMarkDelivered(actor: Actor, orderId: string): Promise<void> {
  staffOnly(actor);
  if (!isUuid(orderId)) throw new AppError("order_not_found");
  await asService(async (db) => {
    const order = await db.one<{
      id: string;
      buyer_id: string;
      seller_id: string;
      currency: string;
      amount: number;
      shipping_amount: number;
      total_amount: number;
      commission_amount: number;
      commission_vat_amount: number;
    }>(
      `select id, buyer_id, seller_id, currency, amount, shipping_amount, total_amount, commission_amount, commission_vat_amount
       from orders where id = $1 and status = 'shipped' for update`,
      [orderId],
    );
    if (!order) throw new AppError("order_transition_not_allowed");
    await db.query("update orders set status = 'delivered', payment_status = 'paid' where id = $1", [order.id]);
    await db.query(
      "update shipments set status = 'delivered', delivered_at = now(), cod_collected_amount = cod_amount where order_id = $1 and direction = 'to_buyer'",
      [order.id],
    );
    await db.query("select record_trust_event($1, 'parcel_accepted', $2, null)", [order.buyer_id, order.id]);

    // Double-entry record of the sale. The courier now owes us the cash it collected.
    // Delivery money paid by the buyer is parked in "suspense" until the courier invoice is reconciled.
    const sellerShare = Number(order.amount) - Number(order.commission_amount) - Number(order.commission_vat_amount);
    const lines: Record<string, unknown>[] = [
      { kind: "courier_cod_receivable", amount: Number(order.total_amount) },
      { kind: "seller_pending", user_id: order.seller_id, amount: -sellerShare },
    ];
    if (Number(order.commission_amount) > 0) lines.push({ kind: "commission_revenue", amount: -Number(order.commission_amount) });
    if (Number(order.commission_vat_amount) > 0) lines.push({ kind: "vat_payable", amount: -Number(order.commission_vat_amount) });
    if (Number(order.shipping_amount) > 0) lines.push({ kind: "suspense", amount: -Number(order.shipping_amount) });
    await db.query("select post_journal('cod_sale_delivered', $1, $2, $3::jsonb, $4, 'COD sale delivered')", [
      `order-${order.id}-delivered`,
      order.currency,
      JSON.stringify(lines),
      order.id,
    ]);
    await audit(db, actor.id, "order_delivered", "order", order.id, {});
  });
}

/** The buyer refused the parcel at the door. This is the strike in the Bid Guarantee. */
export async function staffMarkRefused(actor: Actor, orderId: string): Promise<void> {
  staffOnly(actor);
  if (!isUuid(orderId)) throw new AppError("order_not_found");
  await asService(async (db) => {
    const order = await db.one<{ id: string; buyer_id: string }>(
      "select id, buyer_id from orders where id = $1 and status = 'shipped' for update",
      [orderId],
    );
    if (!order) throw new AppError("order_transition_not_allowed");
    await db.query("update orders set status = 'returned', cancelled_reason = 'parcel_refused' where id = $1", [order.id]);
    await db.query("update shipments set status = 'refused' where order_id = $1 and direction = 'to_buyer'", [order.id]);
    await db.query("select record_trust_event($1, 'parcel_refused', $2, null)", [order.buyer_id, order.id]);
    await audit(db, actor.id, "order_refused", "order", order.id, {});
  });
}

export async function staffComplete(actor: Actor, orderId: string): Promise<void> {
  staffOnly(actor);
  if (!isUuid(orderId)) throw new AppError("order_not_found");
  await asService(async (db) => {
    const done = await db.one("update orders set status = 'completed' where id = $1 and status = 'delivered' returning id", [orderId]);
    if (!done) throw new AppError("order_transition_not_allowed");
    await audit(db, actor.id, "order_completed", "order", orderId, {});
  });
}

export async function staffCancel(actor: Actor, orderId: string, reason: string): Promise<void> {
  staffOnly(actor);
  if (!isUuid(orderId)) throw new AppError("order_not_found");
  if (!reason.trim()) throw new AppError("reason_required");
  await asService(async (db) => {
    const order = await db.one<{ id: string; listing_id: string; kind: string; quantity: number }>(
      "select id, listing_id, kind, quantity from orders where id = $1 and status in ('pending', 'confirmed') for update",
      [orderId],
    );
    if (!order) throw new AppError("order_transition_not_allowed");
    await db.query("update orders set status = 'cancelled', cancelled_reason = $2 where id = $1", [order.id, reason.trim().slice(0, 200)]);
    if (order.kind === "buy_now") await restoreStock(db, order.listing_id, order.quantity);
    else await db.query("update listings set status = 'ended' where id = $1 and status in ('reserved', 'sold')", [order.listing_id]);
    await audit(db, actor.id, "order_cancelled", "order", order.id, { reason });
  });
}

export async function staffTakeDownListing(actor: Actor, listingId: string, reason: string): Promise<void> {
  staffOnly(actor);
  if (!isUuid(listingId)) throw new AppError("listing_not_found");
  if (!reason.trim()) throw new AppError("reason_required");
  await asService(async (db) => {
    const listing = await db.one<{ seller_id: string }>(
      "update listings set status = 'cancelled' where id = $1 and status in ('active', 'scheduled', 'draft') returning seller_id",
      [listingId],
    );
    if (!listing) throw new AppError("listing_not_found");
    await notify(db, listing.seller_id, "listing_removed", { listing_id: listingId, reason }, `listing_removed:${listingId}`);
    await audit(db, actor.id, "listing_removed", "listing", listingId, { reason });
  });
}

// ---------------------------------------------------------------------------
// Deposits (optional, on items of EGP 10,000 or more)
// ---------------------------------------------------------------------------

/** A bidder asks to pay the deposit. Staff confirm it once the transfer arrives. */
export async function requestDeposit(userId: string, listingId: string): Promise<void> {
  if (!isUuid(listingId)) throw new AppError("listing_not_found");
  await asService(async (db) => {
    const listing = await db.one<{ deposit_amount: number | null; currency: string; seller_id: string }>(
      "select deposit_amount, currency, seller_id from listings where id = $1 and status = 'active' and requires_deposit",
      [listingId],
    );
    if (!listing?.deposit_amount || listing.seller_id === userId) throw new AppError("not_allowed");
    const verified = await db.one("select 1 as ok from profiles where id = $1 and verification_status = 'approved'", [userId]);
    if (!verified) throw new AppError("identity_not_verified");
    await db.query(
      "insert into deposits (listing_id, user_id, amount, currency) values ($1, $2, $3, $4) on conflict (listing_id, user_id) do nothing",
      [listingId, userId, listing.deposit_amount, listing.currency],
    );
  });
}

export async function staffSetDeposit(actor: Actor, depositId: string, to: "held" | "released" | "forfeited", reference: string): Promise<void> {
  staffOnly(actor);
  if (!isUuid(depositId)) throw new AppError("not_allowed");
  await asService(async (db) => {
    const from = to === "held" ? "pending" : "held";
    const changed = await db.one<{ user_id: string; listing_id: string }>(
      `update deposits
       set status = $2::deposit_status,
           payment_reference = coalesce(nullif($4, ''), payment_reference),
           resolved_at = case when $2 in ('released', 'forfeited') then now() else resolved_at end
       where id = $1 and status = $3::deposit_status
       returning user_id, listing_id`,
      [depositId, to, from, reference.trim().slice(0, 80)],
    );
    if (!changed) throw new AppError("not_allowed");
    await notify(db, changed.user_id, `deposit_${to}`, { listing_id: changed.listing_id }, `deposit_${to}:${depositId}`);
    await audit(db, actor.id, `deposit_${to}`, "deposit", depositId, { reference });
  });
}
