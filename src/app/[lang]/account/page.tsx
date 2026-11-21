import Link from "next/link";
import { updateProfileAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/forms";
import { requireViewer } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { fill } from "@/lib/format";
import { getDictionary, getLocale } from "../dictionaries";

const tone = { unverified: "badge-muted", pending: "badge-warn", approved: "badge-ok", rejected: "badge-bad" } as const;

export default async function AccountPage() {
  const [dict, locale] = [await getDictionary(), await getLocale()];
  const viewer = await requireViewer(locale, `/${locale}/account`);
  const { profile } = viewer;
  const offers = await asUser(viewer.user.id, (db) =>
    db.one<{ count: number }>(
      "select count(*)::int as count from second_chance_offers where bidder_id = $1 and status = 'pending' and expires_at > now()",
      [viewer.user.id],
    ),
  );

  const links = [
    { href: `/${locale}/account/bids`, label: dict.account.myBids },
    { href: `/${locale}/account/orders`, label: dict.account.purchases },
    { href: `/${locale}/account/listings`, label: dict.account.myListings },
    { href: `/${locale}/account/sales`, label: dict.account.sales },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="display text-3xl">{dict.account.title}</h1>

      {profile.bidding_blocked_at && <p className="notice notice-bad mt-4">{fill(dict.account.blocked, { n: profile.parcels_refused })}</p>}
      {(offers?.count ?? 0) > 0 && (
        <p className="notice notice-ok mt-4">
          <Link href={`/${locale}/account/orders`} className="font-semibold underline">
            {dict.account.offers} ({offers?.count})
          </Link>
        </p>
      )}

      <nav className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="card p-4 text-center font-semibold hover:border-hibiscus">
            {link.label}
          </Link>
        ))}
      </nav>

      <section className="card mt-6 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{dict.account.identity}</h2>
          <span className={`badge ${tone[profile.verification_status]}`}>{dict.account.status[profile.verification_status]}</span>
        </div>
        {profile.verification_status === "approved" && <p className="mt-2 text-ink-muted">{dict.verify.approved}</p>}
        {profile.verification_status === "pending" && <p className="mt-2 text-ink-muted">{dict.verify.pending}</p>}
        {(profile.verification_status === "unverified" || profile.verification_status === "rejected") && (
          <>
            <p className="mt-2 text-ink-muted">{dict.account.verifyWhy}</p>
            <Link href={`/${locale}/account/verify`} className="btn btn-primary mt-4">
              {dict.account.verifyNow}
            </Link>
          </>
        )}
      </section>

      <section className="card mt-6 p-5">
        <h2 className="text-lg font-semibold">{dict.account.trust}</h2>
        <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
          {[
            [dict.account.parcelsAccepted, profile.parcels_accepted],
            [dict.account.parcelsRefused, profile.parcels_refused],
            [dict.account.strikes, profile.strikes],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md bg-surface-sunken p-3">
              <dd className="price text-2xl">{value}</dd>
              <dt className="text-sm text-ink-muted">{label}</dt>
            </div>
          ))}
        </dl>
      </section>

      <section className="card mt-6 p-5">
        <h2 className="text-lg font-semibold">{dict.account.profile}</h2>
        <p className="mt-1 text-sm text-ink-muted" dir="ltr">
          {viewer.user.email} · {profile.phone}
        </p>
        <div className="mt-4">
          <ActionForm action={updateProfileAction} submitLabel={dict.common.save} pendingLabel={dict.common.working} hidden={{ locale }}>
            <div className="field">
              <label htmlFor="display_name">{dict.auth.displayName}</label>
              <input id="display_name" name="display_name" className="input" required minLength={2} maxLength={60} defaultValue={profile.display_name} />
            </div>
            <div className="field">
              <label htmlFor="city">{dict.auth.city}</label>
              <input id="city" name="city" className="input" maxLength={60} defaultValue={profile.city ?? ""} />
            </div>
          </ActionForm>
        </div>
      </section>
    </div>
  );
}
