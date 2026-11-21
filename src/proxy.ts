import { createServerClient } from "@supabase/ssr";
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

/**
 * Supabase sign-in keeps short-lived tokens in cookies. Pages cannot write
 * cookies while rendering, so the tokens are refreshed here, before the page runs.
 */
async function refreshSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const signedIn = request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-"));
  if (!url || !key || process.env.AUTH_PROVIDER === "dev" || !signedIn) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasLocale = locales.some((locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`));
  if (hasLocale) return refreshSession(request);

  request.nextUrl.pathname = `/${pickLocale(request)}${pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
