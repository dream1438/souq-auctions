import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "../env";
import type { AuthProvider, AuthResult } from "./types";

/** Supabase Auth, with the session kept in cookies. src/proxy.ts refreshes the tokens. */
async function client() {
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Components cannot write cookies. The proxy keeps the session fresh instead.
        }
      },
    },
  });
}

const codeFor = (message: string | undefined, fallback: string) => {
  const text = (message ?? "").toLowerCase();
  if (text.includes("already registered") || text.includes("already been registered")) return "email_taken";
  if (text.includes("invalid login")) return "bad_credentials";
  if (text.includes("not confirmed")) return "email_not_confirmed";
  if (text.includes("rate limit")) return "too_many_attempts";
  if (text.includes("password")) return "weak_password";
  return fallback;
};

export const supabaseAuth: AuthProvider = {
  async getUser() {
    const supabase = await client();
    // getUser() asks the Auth server, so the identity is verified and not just read from the cookie.
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  },

  async signUp(email, password): Promise<AuthResult> {
    const supabase = await client();
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error || !data.user) return { ok: false, code: codeFor(error?.message, "sign_up_failed") };
    // With "confirm email" on, Supabase answers an existing address with a user that has no identities.
    if (data.user.identities && data.user.identities.length === 0) return { ok: false, code: "email_taken" };
    return {
      ok: true,
      user: { id: data.user.id, email: data.user.email ?? email },
      needsEmailConfirmation: !data.session,
    };
  },

  async signIn(email, password): Promise<AuthResult> {
    const supabase = await client();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) return { ok: false, code: codeFor(error?.message, "bad_credentials") };
    return { ok: true, user: { id: data.user.id, email: data.user.email ?? email } };
  },

  async signOut() {
    const supabase = await client();
    await supabase.auth.signOut();
  },
};
