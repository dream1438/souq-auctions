import type { Metadata } from "next";
import { Lalezar, Readex_Pro } from "next/font/google";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { getDictionary, hasLocale, locales } from "./dictionaries";
import "../globals.css";

const lalezar = Lalezar({ weight: "400", subsets: ["arabic", "latin"], variable: "--font-lalezar", display: "swap" });
const readex = Readex_Pro({ subsets: ["arabic", "latin"], variable: "--font-readex", display: "swap" });

export async function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return {
    title: { default: dict.site.name, template: `%s | ${dict.site.name}` },
    description: dict.site.tagline,
  };
}

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary();

  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className={`h-full ${lalezar.variable} ${readex.variable}`}>
      <body className="flex min-h-full flex-col">
        <Header dict={dict} locale={lang} />
        {/* Pages read the visitor's session and live data. loading.tsx gives each one a Suspense boundary to stream behind. */}
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line py-6 text-center text-sm text-ink-muted">
          © {dict.site.name}. {dict.footer.rights}
        </footer>
      </body>
    </html>
  );
}
