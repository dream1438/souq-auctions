"use server";

import { redirect } from "next/navigation";
import { asLocale } from "@/app/[lang]/dictionaries";
import { guarded, safeNext, text } from "@/lib/action";
import { auth } from "@/lib/auth";
import { asUser, type Db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { FormState } from "@/lib/form";
import { normalizeEgyptPhone } from "@/lib/format";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type ProfileInput = { displayName: string; phone: string; city: string; whatsapp: boolean };

function readProfile(formData: FormData): ProfileInput {
  const displayName = text(formData, "display_name");
  const phone = normalizeEgyptPhone(text(formData, "phone"));
  if (displayName.length < 2 || displayName.length > 60) throw new AppError("missing_fields");
  if (!phone) throw new AppError("bad_phone");
  if (formData.get("terms") !== "on") throw new AppError("terms_required");
  return { displayName, phone, city: text(formData, "city"), whatsapp: formData.get("whatsapp") === "on" };
}

async function createProfile(db: Db, userId: string, input: ProfileInput, locale: string) {
  await db.query("insert into profiles (id, display_name, phone, city, preferred_locale) values ($1, $2, $3, nullif($4, ''), $5)", [
    userId,
    input.displayName,
    input.phone,
    input.city,
    locale,
  ]);
  // Keep a record of what the person agreed to, and when.
  await db.query(
    `insert into consents (user_id, kind, granted, document_version)
     values ($1, 'terms', true, '2026-11'), ($1, 'privacy', true, '2026-11'), ($1, 'whatsapp_transactional', $2, null)`,
    [userId, input.whatsapp],
  );
}

export async function signUpAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async (dict) => {
    const email = text(formData, "email").toLowerCase();
    const password = String(formData.get("password") ?? "");
    if (!EMAIL.test(email)) throw new AppError("bad_email");
    if (password.length < 8 || password.length > 200) throw new AppError("weak_password");
    const profile = readProfile(formData);

    const result = await auth().signUp(email, password);
    if (!result.ok) throw new AppError(result.code);
    await asUser(result.user.id, (db) => createProfile(db, result.user.id, profile, locale));

    if (result.needsEmailConfirmation) return { ok: dict.auth.confirmEmail };
    redirect(`/${locale}/account/verify`);
  });
}

/** For an account that exists but has no profile yet (for example, sign-up was interrupted). */
export async function completeProfileAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async () => {
    const user = await auth().getUser();
    if (!user) throw new AppError("not_signed_in");
    const profile = readProfile(formData);
    await asUser(user.id, (db) => createProfile(db, user.id, profile, locale));
    redirect(`/${locale}/account/verify`);
  });
}

export async function signInAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async () => {
    const email = text(formData, "email").toLowerCase();
    const password = String(formData.get("password") ?? "");
    if (!EMAIL.test(email) || !password) throw new AppError("bad_credentials");
    const result = await auth().signIn(email, password);
    if (!result.ok) throw new AppError(result.code);
    redirect(safeNext(text(formData, "next"), `/${locale}/account`));
  });
}

export async function signOutAction(formData: FormData): Promise<void> {
  const locale = asLocale(formData.get("locale"));
  await auth().signOut();
  redirect(`/${locale}`);
}

export async function updateProfileAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async (dict) => {
    const user = await auth().getUser();
    if (!user) throw new AppError("not_signed_in");
    const displayName = text(formData, "display_name");
    if (displayName.length < 2 || displayName.length > 60) throw new AppError("missing_fields");
    await asUser(user.id, (db) =>
      db.query("update profiles set display_name = $2, city = nullif($3, ''), preferred_locale = $4 where id = $1", [
        user.id,
        displayName,
        text(formData, "city"),
        locale,
      ]),
    );
    return { ok: dict.account.saved };
  });
}
