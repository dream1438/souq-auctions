import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { storageProviderName } from "@/lib/env";
import { contentTypeFor, isSafePath, readLocal, signedUrl } from "@/lib/storage";

/**
 * Serves stored files.
 *   listing-images       public (only used with local storage; Supabase serves these itself)
 *   identity-documents   the owner and the ID review team only
 */
export async function GET(_request: Request, context: { params: Promise<{ bucket: string; path: string[] }> }) {
  const { bucket, path } = await context.params;
  const filePath = path.join("/");
  if (!isSafePath(filePath)) return new NextResponse("Not found", { status: 404 });

  if (bucket === "listing-images") {
    if (storageProviderName() !== "local") return new NextResponse("Not found", { status: 404 });
    const bytes = await readLocal("listing-images", filePath);
    if (!bytes) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": contentTypeFor(filePath), "Cache-Control": "public, max-age=31536000, immutable" },
    });
  }

  if (bucket === "identity-documents") {
    const user = await auth().getUser();
    if (!user) return new NextResponse("Not found", { status: 404 });
    // Row level security decides: users see their own submission, reviewers and admins see all.
    const allowed = await asUser(user.id, (db) =>
      db.one("select 1 as ok from identity_verifications where $1 in (front_image_path, back_image_path, selfie_image_path) limit 1", [
        filePath,
      ]),
    );
    if (!allowed) return new NextResponse("Not found", { status: 404 });
    if (storageProviderName() === "supabase") {
      const url = await signedUrl("identity-documents", filePath, 60);
      return url ? NextResponse.redirect(url) : new NextResponse("Not found", { status: 404 });
    }
    const bytes = await readLocal("identity-documents", filePath);
    if (!bytes) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": contentTypeFor(filePath), "Cache-Control": "private, no-store" },
    });
  }

  return new NextResponse("Not found", { status: 404 });
}
