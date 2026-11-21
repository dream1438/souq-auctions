import { NextResponse, type NextRequest } from "next/server";

const locales = ["ar", "en"];
const defaultLocale = "ar";

function pickLocale(request: NextRequest): string {
  const saved = request.cookies.get("locale")?.value;
  if (saved && locales.includes(saved)) return saved;
  const header = request.headers.get("accept-language") ?? "";
  const first = header.split(",")[0]?.trim().slice(0, 2).toLowerCase();
  return first === "en" ? "en" : defaultLocale;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasLocale = locales.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
  if (hasLocale) return;

  request.nextUrl.pathname = `/${pickLocale(request)}${pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
