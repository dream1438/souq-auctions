import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { asUser } from "../db";
import { authProviderName } from "../env";
import { devAuth } from "./dev";
import { supabaseAuth } from "./supabase";
import type { AuthProvider, SessionUser } from "./types";

export type { SessionUser } from "./types";

export const auth = (): AuthProvider => (authProviderName() === "supabase" ? supabaseAuth : devAuth);

export type Profile = {
  id: string;
  display_name: string;
  phone: string | null;
  city: string | null;
  preferred_locale: "ar" | "en";
  verification_status: "unverified" | "pending" | "approved" | "rejected";
  strikes: number;
  parcels_accepted: number;
  parcels_refused: number;
  bidding_blocked_at: string | null;
  created_at: string;
};

export type Viewer = {
  user: SessionUser;
  profile: Profile | null;
  roles: string[];
  isStaff: boolean;
  isAdmin: boolean;
};

/** The signed-in visitor with their profile and staff roles. One lookup per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  // Who is signed in is only known when a real request arrives, never at build time.
  await connection();
  const user = await auth().getUser();
  if (!user) return null;
  return asUser(user.id, async (db) => {
    const profile = await db.one<Profile>(
      `select id, display_name, phone, city, preferred_locale, verification_status, strikes,
              parcels_accepted, parcels_refused, bidding_blocked_at, created_at
       from profiles where id = $1`,
      [user.id],
    );
    const flags = await db.one<{ is_admin: boolean; is_staff: boolean }>(
      "select is_admin() as is_admin, is_staff() as is_staff",
    );
    const roles = flags?.is_staff
      ? (await db.query<{ role: string }>("select role::text as role from staff_members where user_id = $1", [user.id])).map(
          (r) => r.role,
        )
      : [];
    return { user, profile, roles, isStaff: Boolean(flags?.is_staff), isAdmin: Boolean(flags?.is_admin) };
  });
});

export type SignedInViewer = Viewer & { profile: Profile };

/** For pages that need a signed-in visitor. Sends everyone else to sign in and back. */
export async function requireViewer(locale: string, returnTo: string): Promise<SignedInViewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/${locale}/sign-in?next=${encodeURIComponent(returnTo)}`);
  if (!viewer.profile) redirect(`/${locale}/sign-up/profile`);
  return viewer as SignedInViewer;
}

export const canReviewIds = (viewer: Viewer) => viewer.isAdmin || viewer.roles.includes("kyc_reviewer");
