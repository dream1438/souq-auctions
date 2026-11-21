import Link from "next/link";
import { ListingGrid } from "@/components/market";
import { getViewer } from "@/lib/auth";
import { fill } from "@/lib/format";
import { getCategories, PAGE_SIZE, searchListings } from "@/lib/listings";
import { getDictionary, getLocale } from "../dictionaries";

type Search = { q?: string; category?: string; format?: string; sort?: string; page?: string };

export default async function BrowsePage({ searchParams }: { searchParams: Promise<Search> }) {
  const [dict, locale, params] = [await getDictionary(), await getLocale(), await searchParams];
  const viewer = await getViewer();
  const [categories, result] = await Promise.all([
    getCategories(),
    searchListings(viewer?.user.id ?? null, { ...params, page: Number(params.page ?? "1") || 1 }),
  ]);
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const pageLink = (page: number) => {
    const query = new URLSearchParams();
    for (const key of ["q", "category", "format", "sort"] as const) if (params[key]) query.set(key, params[key] as string);
    query.set("page", String(page));
    return `/${locale}/listings?${query}`;
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="display text-3xl">{dict.listing.browseTitle}</h1>
      <form method="get" className="card mt-4 grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto_auto_auto]">
        <input name="q" defaultValue={params.q ?? ""} placeholder={dict.listing.searchPlaceholder} className="input" maxLength={80} />
        <select name="category" defaultValue={params.category ?? ""} className="input" aria-label={dict.sell.category}>
          <option value="">{dict.listing.allCategories}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.slug}>
              {locale === "ar" ? category.name_ar : category.name_en}
            </option>
          ))}
        </select>
        <select name="format" defaultValue={params.format ?? ""} className="input" aria-label={dict.sell.format}>
          <option value="">{dict.listing.allFormats}</option>
          <option value="auction">{dict.listing.format.auction}</option>
          <option value="fixed_price">{dict.listing.format.fixed_price}</option>
        </select>
        <select name="sort" defaultValue={params.sort ?? "ending"} className="input" aria-label={dict.listing.sort.label}>
          <option value="ending">{dict.listing.sort.ending}</option>
          <option value="newest">{dict.listing.sort.newest}</option>
          <option value="priceLow">{dict.listing.sort.priceLow}</option>
          <option value="priceHigh">{dict.listing.sort.priceHigh}</option>
        </select>
        <button type="submit" className="btn btn-primary">
          {dict.common.search}
        </button>
      </form>

      <p className="mt-4 text-sm text-ink-muted">{fill(dict.listing.results, { n: result.total })}</p>
      {result.rows.length === 0 ? (
        <p className="mt-6 text-ink-muted">{dict.listing.empty}</p>
      ) : (
        <div className="mt-4">
          <ListingGrid rows={result.rows} dict={dict} locale={locale} />
        </div>
      )}

      {pages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-3">
          {result.page > 1 && (
            <Link href={pageLink(result.page - 1)} className="btn btn-secondary btn-sm">
              {dict.listing.prev}
            </Link>
          )}
          <span className="text-sm text-ink-muted">
            {result.page} / {pages}
          </span>
          {result.page < pages && (
            <Link href={pageLink(result.page + 1)} className="btn btn-secondary btn-sm">
              {dict.listing.next}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
