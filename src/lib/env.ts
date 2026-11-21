import "server-only";

/** Server-side configuration, read once from environment variables. */
export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  databaseCaCert: process.env.DATABASE_CA_CERT ?? "",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  authSecret: process.env.AUTH_SECRET ?? "",
  idHmacKey: process.env.ID_HMAC_KEY ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
  whatsappSupportNumber: process.env.WHATSAPP_SUPPORT_NUMBER ?? "",
  /** Public address of the site, used in links the team sends on WhatsApp. No trailing slash. */
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, ""),
};

const hasSupabase = () => Boolean(env.supabaseUrl && env.supabaseAnonKey);

/**
 * "supabase" is the real sign-in. "dev" is a local stand-in for development
 * only: it keeps passwords in the local database stub and is refused in
 * production unless ALLOW_DEV_AUTH=1 is set on purpose.
 */
export function authProviderName(): "supabase" | "dev" {
  const wanted = process.env.AUTH_PROVIDER ?? (hasSupabase() ? "supabase" : "dev");
  if (wanted === "supabase") {
    if (!hasSupabase()) throw new Error("AUTH_PROVIDER=supabase needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
    return "supabase";
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH !== "1") {
    throw new Error("The development sign-in cannot run in production. Set the Supabase keys.");
  }
  return "dev";
}

export function storageProviderName(): "supabase" | "local" {
  const wanted = process.env.STORAGE_PROVIDER ?? (env.supabaseUrl && env.supabaseServiceKey ? "supabase" : "local");
  return wanted === "supabase" ? "supabase" : "local";
}

export function requireSecret(name: "authSecret" | "idHmacKey"): string {
  const value = env[name];
  if (value.length < 32) {
    const variable = name === "authSecret" ? "AUTH_SECRET" : "ID_HMAC_KEY";
    throw new Error(`${variable} must be set to a random string of at least 32 characters`);
  }
  return value;
}
