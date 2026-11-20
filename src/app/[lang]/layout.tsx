import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { getDictionary, hasLocale, locales } from "./dictionaries";
import "../globals.css";

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

export default async function RootLayout({
  children,
  params,
}: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary();

  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className="h-full">
      <body className="flex min-h-full flex-col">
        <Header dict={dict} locale={lang} />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line py-6 text-center text-sm text-muted">
          © {dict.site.name}. {dict.footer.rights}
        </footer>
      </body>
    </html>
  );
}
