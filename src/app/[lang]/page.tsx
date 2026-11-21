import Link from "next/link";
import { getDictionary, getLocale } from "./dictionaries";

export default async function HomePage() {
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);

  const categories = [
    { slug: "phones", label: dict.categories.phones },
    { slug: "electronics", label: dict.categories.electronics },
    { slug: "home", label: dict.categories.home },
    { slug: "collectibles", label: dict.categories.collectibles },
  ];
  const steps = [
    { title: dict.how.step1Title, body: dict.how.step1Body },
    { title: dict.how.step2Title, body: dict.how.step2Body },
    { title: dict.how.step3Title, body: dict.how.step3Body },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-12 sm:py-20">
        <h1 className="max-w-2xl text-3xl font-bold leading-tight sm:text-5xl sm:leading-tight">
          {dict.hero.title}
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted">{dict.hero.subtitle}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={`/${locale}/listings`}
            className="rounded-lg bg-brand px-5 py-3 font-semibold text-white hover:opacity-90"
          >
            {dict.hero.browse}
          </Link>
          <Link
            href={`/${locale}/sell`}
            className="rounded-lg border border-line px-5 py-3 font-semibold hover:bg-surface"
          >
            {dict.hero.sell}
          </Link>
        </div>
      </section>

      <section className="py-8">
        <h2 className="text-xl font-bold">{dict.categories.title}</h2>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {categories.map((category) => (
            <li key={category.slug}>
              <Link
                href={`/${locale}/listings?category=${category.slug}`}
                className="block rounded-xl border border-line bg-surface px-4 py-6 text-center font-semibold hover:border-brand"
              >
                {category.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="py-8">
        <h2 className="text-xl font-bold">{dict.listings.title}</h2>
        <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-10 text-center text-muted">
          {dict.listings.empty}
        </p>
      </section>

      <section className="py-8 pb-16">
        <h2 className="text-xl font-bold">{dict.how.title}</h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="rounded-xl border border-line p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                {index + 1}
              </span>
              <h3 className="mt-3 font-semibold">{step.title}</h3>
              <p className="mt-1 text-sm text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
