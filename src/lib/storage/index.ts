import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { env, storageProviderName } from "../env";
import { AppError } from "../errors";

/**
 * File storage with two interchangeable back ends:
 *   local     files under .data/storage, for development only
 *   supabase  Supabase Storage buckets
 * Buckets: "listing-images" is public. "identity-documents" is private and is
 * only ever served through /api/files after a permission check.
 */
export type Bucket = "listing-images" | "identity-documents";

const MAX_BYTES = 4 * 1024 * 1024;
const SAFE_PATH = /^[a-z0-9-]{1,64}\/[a-z0-9-]{1,64}\.(jpg|png|webp)$/;
const TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
type Extension = keyof typeof TYPES;

export const isSafePath = (value: string) => SAFE_PATH.test(value);
export const contentTypeFor = (filePath: string) => TYPES[(filePath.split(".").pop() ?? "jpg") as Extension] ?? "application/octet-stream";

/** Trust the bytes, not the file name: only real JPEG, PNG and WebP images pass. */
function sniff(bytes: Buffer): Extension | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length > 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

const localRoot = () => path.join(process.cwd(), ".data", "storage");

function supabase() {
  return createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Saves an uploaded image under `<folder>/<random>.<ext>` and returns that path. */
export async function saveImage(bucket: Bucket, folder: string, file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new AppError("image_too_large");
  const bytes = Buffer.from(await file.arrayBuffer());
  const extension = sniff(bytes);
  if (!extension) throw new AppError("bad_image");
  const filePath = `${folder}/${randomUUID()}.${extension}`;
  if (!isSafePath(filePath)) throw new AppError("bad_image");

  if (storageProviderName() === "supabase") {
    const { error } = await supabase().storage.from(bucket).upload(filePath, bytes, { contentType: TYPES[extension], upsert: false });
    if (error) throw new Error(`Upload to ${bucket} failed: ${error.message}`);
  } else {
    const target = path.join(localRoot(), bucket, filePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  return filePath;
}

/** Address of a public listing image. */
export function listingImageUrl(filePath: string | null | undefined): string | null {
  if (!filePath || !isSafePath(filePath)) return null;
  if (storageProviderName() === "supabase") return `${env.supabaseUrl}/storage/v1/object/public/listing-images/${filePath}`;
  return `/api/files/listing-images/${filePath}`;
}

/** Private documents always go through our own route, which checks who is asking. */
export const identityDocumentUrl = (filePath: string | null | undefined) =>
  filePath && isSafePath(filePath) ? `/api/files/identity-documents/${filePath}` : null;

export async function readLocal(bucket: Bucket, filePath: string): Promise<Buffer | null> {
  if (!isSafePath(filePath)) return null;
  try {
    return await readFile(path.join(localRoot(), bucket, filePath));
  } catch {
    return null;
  }
}

/** A short-lived link to a private file in Supabase Storage. */
export async function signedUrl(bucket: Bucket, filePath: string, seconds = 60): Promise<string | null> {
  if (!isSafePath(filePath)) return null;
  const { data, error } = await supabase().storage.from(bucket).createSignedUrl(filePath, seconds);
  return error ? null : data.signedUrl;
}

/** Picks the real files out of a form field (browsers send an empty file when nothing is chosen). */
export function filesFrom(formData: FormData, name: string): File[] {
  return formData.getAll(name).filter((entry): entry is File => entry instanceof File && entry.size > 0);
}
