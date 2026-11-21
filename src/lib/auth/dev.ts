import "server-only";
import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { asService } from "../db";
import { requireSecret } from "../env";
import type { AuthProvider, AuthResult, SessionUser } from "./types";

/**
 * Development sign-in. It stands in for Supabase Auth on a local database so
 * the whole site can be used before the Supabase project exists. It is never
 * used in production (see authProviderName in env.ts).
 */
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const COOKIE = "sm_dev_session";
const WEEK = 60 * 60 * 24 * 7;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function checkPassword(password: string, stored: string | null): Promise<boolean> {
  const [scheme, saltHex, hashHex] = (stored ?? "").split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

const sign = (value: string) => createHmac("sha256", requireSecret("authSecret")).update(value).digest("hex");

async function startSession(user: SessionUser) {
  const expires = Math.floor(Date.now() / 1000) + WEEK;
  const body = `${user.id}.${expires}`;
  (await cookies()).set(COOKIE, `${body}.${sign(body)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH !== "1",
    path: "/",
    maxAge: WEEK,
  });
}

export const devAuth: AuthProvider = {
  async getUser() {
    const raw = (await cookies()).get(COOKIE)?.value;
    if (!raw) return null;
    const [id, expires, signature] = raw.split(".");
    if (!id || !expires || !signature) return null;
    const expected = Buffer.from(sign(`${id}.${expires}`));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    if (Number(expires) < Date.now() / 1000) return null;
    const row = await asService((db) =>
      db.one<{ id: string; email: string | null }>("select id, email from auth.users where id = $1", [id]),
    );
    return row ? { id: row.id, email: row.email } : null;
  },

  async signUp(email, password): Promise<AuthResult> {
    const encrypted = await hashPassword(password);
    const id = randomUUID();
    const created = await asService((db) =>
      db.one<{ id: string }>(
        `insert into auth.users (id, email, encrypted_password)
         select $1, $2, $3 where not exists (select 1 from auth.users where lower(email) = lower($2))
         returning id`,
        [id, email, encrypted],
      ),
    );
    if (!created) return { ok: false, code: "email_taken" };
    const user = { id, email };
    await startSession(user);
    return { ok: true, user };
  },

  async signIn(email, password): Promise<AuthResult> {
    const row = await asService((db) =>
      db.one<{ id: string; email: string; encrypted_password: string | null }>(
        "select id, email, encrypted_password from auth.users where lower(email) = lower($1)",
        [email],
      ),
    );
    if (!row || !(await checkPassword(password, row.encrypted_password))) return { ok: false, code: "bad_credentials" };
    const user = { id: row.id, email: row.email };
    await startSession(user);
    return { ok: true, user };
  },

  async signOut() {
    (await cookies()).delete(COOKIE);
  },
};
