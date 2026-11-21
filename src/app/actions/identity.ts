"use server";

import { createHmac } from "node:crypto";
import { redirect } from "next/navigation";
import { asLocale } from "@/app/[lang]/dictionaries";
import { guarded, text } from "@/lib/action";
import { getViewer } from "@/lib/auth";
import { asService, asUser } from "@/lib/db";
import { requireSecret } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { FormState } from "@/lib/form";
import { filesFrom, saveImage } from "@/lib/storage";

const latinDigits = (value: string) => value.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

/** Egyptian national ID: century digit, birth date, governorate code, serial, check digit. */
function isEgyptianNationalId(value: string): boolean {
  if (!/^[23]\d{13}$/.test(value)) return false;
  const month = Number(value.slice(3, 5));
  const day = Number(value.slice(5, 7));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/**
 * The document number is never stored. We keep a keyed fingerprint of it,
 * which is enough to stop one ID from being used on two accounts.
 */
const fingerprint = (documentType: string, number: string) =>
  createHmac("sha256", requireSecret("idHmacKey")).update(`${documentType}:${number}`).digest("hex");

export async function submitIdentityAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async () => {
    const viewer = await getViewer();
    if (!viewer) throw new AppError("not_signed_in");
    if (!viewer.profile) throw new AppError("profile_not_found");
    if (viewer.profile.verification_status === "approved") throw new AppError("already_verified");
    if (viewer.profile.verification_status === "pending") throw new AppError("verification_pending");

    const documentType = text(formData, "document_type") === "passport" ? "passport" : "national_id";
    const number = latinDigits(text(formData, "document_number")).replace(/\s|-/g, "").toUpperCase();
    const valid = documentType === "national_id" ? isEgyptianNationalId(number) : /^[A-Z0-9]{6,12}$/.test(number);
    if (!valid) throw new AppError("bad_id_number");
    const hmac = fingerprint(documentType, number);

    const [front] = filesFrom(formData, "front");
    const [back] = filesFrom(formData, "back");
    const [selfie] = filesFrom(formData, "selfie");
    if (!front || (documentType === "national_id" && !back)) throw new AppError("image_required");

    // Looks across all accounts, so it needs the service role. Only a yes/no leaves this block.
    const usedElsewhere = await asService((db) =>
      db.one(
        "select 1 as used from identity_verifications where document_number_hmac = $1 and user_id <> $2 and status in ('pending', 'approved') limit 1",
        [hmac, viewer.user.id],
      ),
    );
    if (usedElsewhere) throw new AppError("id_already_used");

    const folder = viewer.user.id;
    const frontPath = await saveImage("identity-documents", folder, front);
    const backPath = back ? await saveImage("identity-documents", folder, back) : null;
    const selfiePath = selfie ? await saveImage("identity-documents", folder, selfie) : null;

    await asUser(viewer.user.id, (db) =>
      db.query(
        `insert into identity_verifications (user_id, document_type, document_number_hmac, front_image_path, back_image_path, selfie_image_path)
         values ($1, $2, $3, $4, $5, $6)`,
        [viewer.user.id, documentType, hmac, frontPath, backPath, selfiePath],
      ),
    );
    redirect(`/${locale}/account`);
  });
}

export async function reviewIdentityAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = asLocale(formData.get("locale"));
  return guarded(locale, async () => {
    const viewer = await getViewer();
    if (!viewer) throw new AppError("not_signed_in");
    const approve = text(formData, "decision") === "approve";
    // The database function checks the reviewer role and writes the audit log.
    await asUser(viewer.user.id, (db) =>
      db.query("select review_identity_verification($1, $2, nullif($3, ''))", [text(formData, "id"), approve, text(formData, "reason")]),
    );
    redirect(`/${locale}/admin/verifications`);
  });
}
