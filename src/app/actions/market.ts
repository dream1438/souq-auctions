"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { asLocale } from "@/app/[lang]/dictionaries";
import { guarded, text } from "@/lib/action";
import { getViewer, type SignedInViewer } from "@/lib/auth";
import { asUser, isUuid } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { FormState } from "@/lib/form";
import { fill, normalizeEgyptPhone, parseMoney, parseMoneyAllowZero } from "@/lib/format";
import * as market from "@/lib/market";
import { filesFrom, saveImage } from "@/lib/storage";

async function signedIn(): Promise<SignedInViewer> {
  const viewer = await getViewer();
  if (!viewer) throw new AppError("not_signed_in");
  if (!viewer.profile) throw new AppError("profile_not_found");
  return viewer as SignedInViewer;
}

const actorOf = (viewer: SignedInViewer) => ({ id: viewer.user.id, isStaff: viewer.isStaff });

// ---------------------------------------------------------------------------
// Selling
// ---------------------------------------------------------------------------
const CONDITIONS = ["new", "like_new", "good", "fair", "for_parts"];
const DURATIONS = [1, 3, 5, 7, 10];
const DEPOSIT_FLOOR = 1_000_000; // EGP 10,000 in piastres

export async function createListingAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async () => {
    const viewer = await signedIn();
    if (viewer.profile.verification_status !== "approved") throw new AppError("identity_not_verified");

    const title = text(formData, "title");
    const description = text(formData, "description").slice(0, 5000);
    const condition = text(formData, "condition");
    const isAuction = text(formData, "format") !== "fixed";
    const categoryId = Number(text(formData, "category_id"));
    const governorateId = Number(text(formData, "governorate_id"));
    const city = text(formData, "city").slice(0, 60);
    if (title.length < 3 || title.length > 120) throw new AppError("title_length");
    if (!CONDITIONS.includes(condition) || !Number.isInteger(categoryId) || !Number.isInteger(governorateId) || !city) {
      throw new AppError("missing_fields");
    }

    const buyNowPrice = text(formData, "buy_now_price") ? parseMoney(text(formData, "buy_now_price")) : null;
    if (text(formData, "buy_now_price") && buyNowPrice === null) throw new AppError("bad_price");
    let startPrice: number | null = null;
    let reservePrice: number | null = null;
    let days: number | null = null;
    let quantity = 1;
    if (isAuction) {
      startPrice = parseMoney(text(formData, "start_price"));
      if (startPrice === null) throw new AppError("bad_price");
      if (buyNowPrice !== null && buyNowPrice <= startPrice) throw new AppError("buy_now_too_low");
      if (text(formData, "reserve_price")) {
        reservePrice = parseMoney(text(formData, "reserve_price"));
        if (reservePrice === null) throw new AppError("bad_price");
        if (reservePrice < startPrice || (buyNowPrice !== null && reservePrice > buyNowPrice)) throw new AppError("reserve_too_low");
      }
      days = Number(text(formData, "days"));
      if (!DURATIONS.includes(days)) throw new AppError("missing_fields");
    } else {
      if (buyNowPrice === null) throw new AppError("bad_price");
      quantity = Number(text(formData, "quantity") || "1");
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new AppError("bad_quantity");
    }

    const deliveryCost = parseMoneyAllowZero(text(formData, "delivery_cost")) ?? 0;
    const wantsDeposit = formData.get("requires_deposit") === "on";
    let depositAmount: number | null = null;
    if (wantsDeposit) {
      if ((startPrice ?? buyNowPrice ?? 0) < DEPOSIT_FLOOR) throw new AppError("deposit_not_allowed");
      depositAmount = parseMoney(text(formData, "deposit_amount"));
      if (depositAmount === null) throw new AppError("bad_price");
    }

    const photos = filesFrom(formData, "photos").slice(0, 6);
    if (photos.length === 0) throw new AppError("image_required");
    const paths: string[] = [];
    for (const photo of photos) paths.push(await saveImage("listing-images", viewer.user.id, photo));

    // Runs as the seller, so the database's own rules (verified sellers only, price checks) apply.
    const listingId = await asUser(viewer.user.id, async (db) => {
      const created = await db.one<{ id: string }>(
        `insert into listings (seller_id, category_id, title, description, condition, format, status, start_price, buy_now_price,
                               ends_at, quantity, governorate_id, city, requires_deposit, deposit_amount)
         values ($1, $2, $3, $4, $5::listing_condition, $6::listing_format, 'active', $7, $8,
                 case when $9::int is null then null else now() + make_interval(days => $9::int) end,
                 $10, $11, $12, $13, $14)
         returning id`,
        [
          viewer.user.id,
          categoryId,
          title,
          description,
          condition,
          isAuction ? "auction" : "fixed_price",
          startPrice,
          buyNowPrice,
          days,
          quantity,
          governorateId,
          city,
          wantsDeposit,
          depositAmount,
        ],
      );
      if (!created) throw new AppError("generic");
      if (reservePrice !== null) {
        await db.query("insert into listing_private (listing_id, reserve_price) values ($1, $2)", [created.id, reservePrice]);
      }
      await db.query("insert into listing_shipping_options (listing_id, courier, cost) values ($1, 'bosta', $2)", [created.id, deliveryCost]);
      for (const [index, storagePath] of paths.entries()) {
        await db.query("insert into listing_images (listing_id, storage_path, sort_order) values ($1, $2, $3)", [created.id, storagePath, index]);
      }
      return created.id;
    });
    redirect(`/${locale}/listings/${listingId}`);
  });
}

// ---------------------------------------------------------------------------
// Bidding and buying
// ---------------------------------------------------------------------------
export async function placeBidAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async (dict) => {
    const viewer = await signedIn();
    const amount = parseMoney(text(formData, "amount"));
    if (amount === null) throw new AppError("bad_price");
    const result = await market.placeBid(viewer.user.id, text(formData, "listing_id"), amount);
    refresh();
    return result.is_leading ? { ok: dict.bid.placedLeading } : { error: dict.bid.placedOutbid };
  });
}

export async function requestDepositAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async () => {
    const viewer = await signedIn();
    await market.requestDeposit(viewer.user.id, text(formData, "listing_id"));
    refresh();
  });
}

/** Uses the chosen saved address, or saves the new one typed into the form. */
async function addressFrom(viewer: SignedInViewer, formData: FormData): Promise<string> {
  const chosen = text(formData, "address_id");
  if (isUuid(chosen)) return chosen;
  const recipient = text(formData, "recipient_name").slice(0, 80);
  const phone = normalizeEgyptPhone(text(formData, "address_phone"));
  const governorateId = Number(text(formData, "governorate_id"));
  const city = text(formData, "city").slice(0, 60);
  const street = text(formData, "street_address").slice(0, 200);
  if (!recipient || !city || !street || !Number.isInteger(governorateId)) throw new AppError("missing_fields");
  if (!phone) throw new AppError("bad_phone");
  const saved = await asUser(viewer.user.id, (db) =>
    db.one<{ id: string }>(
      `insert into addresses (user_id, recipient_name, phone, governorate_id, governorate, city, street_address, notes, is_default)
       select $1, $2, $3, g.id, g.name_en, $5, $6, nullif($7, ''), not exists (select 1 from addresses a where a.user_id = $1)
       from governorates g where g.id = $4
       returning id`,
      [viewer.user.id, recipient, phone, governorateId, city, street, text(formData, "notes").slice(0, 200)],
    ),
  );
  if (!saved) throw new AppError("missing_fields");
  return saved.id;
}

export async function buyNowAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async () => {
    const viewer = await signedIn();
    const quantity = Number(text(formData, "quantity") || "1");
    if (!Number.isInteger(quantity) || quantity < 1) throw new AppError("bad_quantity");
    const addressId = await addressFrom(viewer, formData);
    const orderId = await market.buyNow(viewer.user.id, text(formData, "listing_id"), addressId, quantity);
    redirect(`/${locale}/orders/${orderId}`);
  });
}

export async function confirmOrderAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async () => {
    const viewer = await signedIn();
    const orderId = text(formData, "order_id");
    const addressId = await addressFrom(viewer, formData);
    await market.confirmOrder(viewer.user.id, orderId, addressId);
    redirect(`/${locale}/orders/${orderId}`);
  });
}

export async function acceptOfferAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async () => {
    const viewer = await signedIn();
    const addressId = await addressFrom(viewer, formData);
    const orderId = await market.acceptOffer(viewer.user.id, text(formData, "offer_id"), addressId);
    redirect(`/${locale}/orders/${orderId}`);
  });
}

export async function declineOfferAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async () => {
    const viewer = await signedIn();
    await market.declineOffer(viewer.user.id, text(formData, "offer_id"));
    redirect(`/${locale}/account/orders`);
  });
}

export async function markShippedAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async () => {
    const viewer = await signedIn();
    await market.markShipped(actorOf(viewer), text(formData, "order_id"), text(formData, "tracking_number"));
    refresh();
  });
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
export async function staffOrderAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async () => {
    const actor = actorOf(await signedIn());
    const orderId = text(formData, "order_id");
    const step = text(formData, "step");
    if (step === "shipped") await market.markShipped(actor, orderId, text(formData, "tracking_number"));
    else if (step === "delivered") await market.staffMarkDelivered(actor, orderId);
    else if (step === "refused") await market.staffMarkRefused(actor, orderId);
    else if (step === "completed") await market.staffComplete(actor, orderId);
    else if (step === "cancelled") await market.staffCancel(actor, orderId, text(formData, "reason"));
    else throw new AppError("not_allowed");
    refresh();
  });
}

export async function staffListingAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async () => {
    await market.staffTakeDownListing(actorOf(await signedIn()), text(formData, "listing_id"), text(formData, "reason"));
    refresh();
  });
}

export async function staffDepositAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async () => {
    const to = text(formData, "to");
    if (to !== "held" && to !== "released" && to !== "forfeited") throw new AppError("not_allowed");
    await market.staffSetDeposit(actorOf(await signedIn()), text(formData, "deposit_id"), to, text(formData, "reference"));
    refresh();
  });
}

export async function staffUnblockAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async () => {
    const viewer = await signedIn();
    const reason = text(formData, "reason");
    if (!reason) throw new AppError("reason_required");
    // The database function checks that the caller is an admin and writes the block log.
    await asUser(viewer.user.id, (db) => db.query("select unblock_user($1, $2)", [text(formData, "user_id"), reason]));
    refresh();
  });
}

export async function staffRunJobsAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async (dict) => {
    const viewer = await signedIn();
    if (!viewer.isStaff) throw new AppError("not_allowed");
    const report = await market.runJobs();
    refresh();
    return { ok: fill(dict.admin.jobsDone, report) };
  });
}
