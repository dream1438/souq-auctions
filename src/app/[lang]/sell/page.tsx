import Link from "next/link";
import { createListingAction } from "@/app/actions/market";
import { ActionForm, ImageInput } from "@/components/forms";
import { requireViewer } from "@/lib/auth";
import { asAnon } from "@/lib/db";
import { fill } from "@/lib/format";
import { getCategories, getGovernorates } from "@/lib/listings";
import { getDictionary, getLocale } from "../dictionaries";

export default async function SellPage() {
  const [dict, locale] = [await getDictionary(), await getLocale()];
  const viewer = await requireViewer(locale, `/${locale}/sell`);

  if (viewer.profile.verification_status !== "approved") {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <h1 className="display text-3xl">{dict.sell.title}</h1>
        <p className="notice notice-warn mt-6">{dict.sell.needVerify}</p>
        <Link href={`/${locale}/account/verify`} className="btn btn-primary mt-4">
          {dict.account.verifyNow}
        </Link>
      </div>
    );
  }

  const [categories, governorates, commission] = await Promise.all([
    getCategories(),
    getGovernorates(),
    asAnon((db) => db.one<{ bps: number }>("select setting_int('commission_bps', 800)::int as bps")),
  ]);
  const conditions = ["new", "like_new", "good", "fair", "for_parts"] as const;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="display text-3xl">{dict.sell.title}</h1>
      <p className="mt-2 text-ink-muted">{fill(dict.sell.fee, { percent: (commission?.bps ?? 800) / 100 })}</p>
      <div className="card mt-6 p-5">
        <ActionForm action={createListingAction} submitLabel={dict.sell.publish} pendingLabel={dict.common.working} hidden={{ locale }}>
          <div className="field">
            <label htmlFor="title">{dict.sell.titleLabel}</label>
            <input id="title" name="title" className="input" required minLength={3} maxLength={120} />
            <p className="hint">{dict.sell.titleHint}</p>
          </div>
          <div className="field">
            <label htmlFor="description">{dict.sell.description}</label>
            <textarea id="description" name="description" className="input" required maxLength={5000} />
            <p className="hint">{dict.sell.descriptionHint}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="category_id">{dict.sell.category}</label>
              <select id="category_id" name="category_id" className="input" required>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {locale === "ar" ? category.name_ar : category.name_en}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="condition">{dict.sell.condition}</label>
              <select id="condition" name="condition" className="input" required defaultValue="good">
                {conditions.map((condition) => (
                  <option key={condition} value={condition}>
                    {dict.listing.condition[condition]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <ImageInput name="photos" label={dict.sell.photos} hint={dict.sell.photosHint} multiple max={6} required />

          <fieldset className="flex flex-col gap-2">
            <legend className="label mb-1">{dict.sell.format}</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="format" value="auction" defaultChecked /> {dict.sell.auction}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="format" value="fixed" /> {dict.sell.fixed}
            </label>
          </fieldset>

          {/* Plain CSS shows the fields for the chosen way of selling, so the form also works without JavaScript. */}
          <div className="grid gap-4 sm:grid-cols-2 [form:has(input[value=fixed]:checked)_&]:hidden">
            <div className="field">
              <label htmlFor="start_price">{dict.sell.startPrice}</label>
              <input id="start_price" name="start_price" className="input" inputMode="decimal" dir="ltr" />
            </div>
            <div className="field">
              <label htmlFor="days">{dict.sell.duration}</label>
              <select id="days" name="days" className="input" defaultValue="7">
                {[1, 3, 5, 7, 10].map((days) => (
                  <option key={days} value={days}>
                    {fill(dict.sell.days, { n: days })}
                  </option>
                ))}
              </select>
            </div>
            <div className="field sm:col-span-2">
              <label htmlFor="reserve_price">
                {dict.sell.reservePrice} <span className="hint">({dict.common.optional})</span>
              </label>
              <input id="reserve_price" name="reserve_price" className="input" inputMode="decimal" dir="ltr" />
              <p className="hint">{dict.sell.reserveHint}</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="buy_now_price">{dict.sell.buyNowPrice}</label>
              <input id="buy_now_price" name="buy_now_price" className="input" inputMode="decimal" dir="ltr" />
              <p className="hint [form:has(input[value=fixed]:checked)_&]:hidden">{dict.sell.buyNowHint}</p>
            </div>
            <div className="field hidden [form:has(input[value=fixed]:checked)_&]:flex">
              <label htmlFor="quantity">{dict.sell.quantity}</label>
              <input id="quantity" name="quantity" type="number" min={1} max={100} defaultValue={1} className="input" dir="ltr" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="governorate_id">{dict.sell.governorate}</label>
              <select id="governorate_id" name="governorate_id" className="input" required>
                {governorates.map((g) => (
                  <option key={g.id} value={g.id}>
                    {locale === "ar" ? g.name_ar : g.name_en}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="city">{dict.sell.city}</label>
              <input id="city" name="city" className="input" required maxLength={60} defaultValue={viewer.profile.city ?? ""} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="delivery_cost">{dict.sell.deliveryCost}</label>
            <input id="delivery_cost" name="delivery_cost" className="input" inputMode="decimal" dir="ltr" defaultValue="0" />
            <p className="hint">{dict.sell.deliveryHint}</p>
          </div>

          <div className="rounded-md bg-surface-sunken p-4">
            <label className="flex items-start gap-2 font-semibold">
              <input type="checkbox" name="requires_deposit" className="mt-1" /> {dict.sell.deposit}
            </label>
            <p className="hint mt-1">{dict.sell.depositHint}</p>
            <div className="field mt-3">
              <label htmlFor="deposit_amount">{dict.sell.depositAmount}</label>
              <input id="deposit_amount" name="deposit_amount" className="input" inputMode="decimal" dir="ltr" />
            </div>
          </div>
        </ActionForm>
      </div>
    </div>
  );
}
