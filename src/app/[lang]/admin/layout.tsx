import Link from "next/link";
import type { ReactNode } from "react";
import { requireViewer } from "@/lib/auth";
import { getDictionary, getLocale } from "../dictionaries";

/** Everything under /admin is for staff. The database enforces the same rule on every query. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const [dict, locale] = [await getDictionary(), await getLocale()];
  const viewer = await requireViewer(locale, `/${locale}/admin`);
  if (!viewer.isStaff) {
    return <p className="mx-auto max-w-3xl px-4 py-10 text-ink-muted">{dict.admin.noAccess}</p>;
  }

  const tabs = [
    { href: `/${locale}/admin`, label: dict.admin.overview },
    { href: `/${locale}/admin/verifications`, label: dict.admin.verifications },
    { href: `/${locale}/admin/orders`, label: dict.admin.orders },
    { href: `/${locale}/admin/listings`, label: dict.admin.listings },
    { href: `/${locale}/admin/deposits`, label: dict.admin.deposits },
    { href: `/${locale}/admin/users`, label: dict.admin.users },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="display text-3xl">{dict.admin.title}</h1>
      <nav className="mt-4 flex flex-wrap gap-2 border-b border-line pb-3">
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href} className="btn btn-secondary btn-sm">
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="mt-6">{children}</div>
    </div>
  );
}
