import Link from "next/link";
import { staffRunJobsAction } from "@/app/actions/market";
import { ActionForm } from "@/components/forms";
import { requireViewer } from "@/lib/auth";
import { asService } from "@/lib/db";
import { getDictionary, getLocale } from "../dictionaries";

export default async function AdminOverviewPage() {
  const [dict, locale] = [await getDictionary(), await getLocale()];
  const viewer = await requireViewer(locale, `/${locale}/admin`);
  if (!viewer.isStaff) return null;

  // Staff counters across all members, read with the service role after the staff check above.
  const counts = await asService((db) =>
    db.one<Record<string, number>>(
      `select
         (select count(*)::int from identity_verifications where status = 'pending') as ids,
         (select count(*)::int from listings where status = 'active') as live,
         (select count(*)::int from orders where status in ('confirmed', 'shipped', 'delivered')) as open_orders,
         (select count(*)::int from orders where status = 'pending') as unconfirmed,
         (select count(*)::int from deposits where status = 'pending') as deposits,
         (select count(*)::int from profiles where bidding_blocked_at is not null) as blocked`,
    ),
  );
  const tiles = [
    { label: dict.admin.pendingIds, value: counts?.ids, href: "verifications" },
    { label: dict.admin.unconfirmed, value: counts?.unconfirmed, href: "orders" },
    { label: dict.admin.openOrders, value: counts?.open_orders, href: "orders" },
    { label: dict.admin.pendingDeposits, value: counts?.deposits, href: "deposits" },
    { label: dict.admin.liveListings, value: counts?.live, href: "listings" },
    { label: dict.admin.blockedUsers, value: counts?.blocked, href: "users" },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <Link key={tile.label} href={`/${locale}/admin/${tile.href}`} className="card p-4 hover:border-hibiscus">
            <span className="price block text-3xl">{tile.value ?? 0}</span>
            <span className="text-sm text-ink-muted">{tile.label}</span>
          </Link>
        ))}
      </div>
      <div className="mt-6 max-w-sm">
        <ActionForm action={staffRunJobsAction} submitLabel={dict.admin.runJobs} pendingLabel={dict.common.working} submitClass="btn btn-secondary" hidden={{ locale }} />
      </div>
    </div>
  );
}
