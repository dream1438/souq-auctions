import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "./env";

/**
 * Data access goes straight to Postgres, but every query runs inside a
 * transaction that first switches to the same database role Supabase would
 * use for that visitor. Row level security therefore applies exactly as it
 * does through the Supabase API:
 *
 *   asUser(id, ...)   role "authenticated", auth.uid() = id
 *   asAnon(...)       role "anon", auth.uid() is null
 *   asService(...)    role "service_role", bypasses row level security.
 *                     Only for trusted server jobs, after the code has done
 *                     its own permission check.
 */
export type Db = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T | null>;
};

type Role = "anon" | "authenticated" | "service_role";

const globalForPg = globalThis as unknown as { souqPool?: Pool };

function pool(): Pool {
  if (!globalForPg.souqPool) {
    if (!env.databaseUrl) throw new Error("DATABASE_URL is not set");
    const local = /@(localhost|127\.0\.0\.1)[:/]|host=%2F|host=\//.test(env.databaseUrl);
    globalForPg.souqPool = new Pool({
      connectionString: env.databaseUrl,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
      // Hosted Postgres is always encrypted. Give DATABASE_CA_CERT to also verify the server certificate.
      ssl: local ? undefined : env.databaseCaCert ? { ca: env.databaseCaCert } : { rejectUnauthorized: false },
    });
  }
  return globalForPg.souqPool;
}

function wrap(client: PoolClient): Db {
  const query = async <T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T[]> =>
    (await client.query<T>(text, params)).rows;
  const one = async <T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T | null> =>
    (await query<T>(text, params))[0] ?? null;
  return { query, one };
}

async function run<T>(role: Role, userId: string | null, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const claims = JSON.stringify(userId ? { sub: userId, role } : { role });
    await client.query(
      "select set_config('role', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $1, true), set_config('request.jwt.claims', $3, true)",
      [role, userId ?? "", claims],
    );
    const result = await fn(wrap(client));
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export function asUser<T>(userId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  if (!isUuid(userId)) throw new Error("asUser needs a user id");
  return run("authenticated", userId, fn);
}

export function asAnon<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return run("anon", null, fn);
}

/** Visitor-scoped access: the signed-in user if there is one, otherwise anonymous. */
export function asVisitor<T>(userId: string | null | undefined, fn: (db: Db) => Promise<T>): Promise<T> {
  return userId ? asUser(userId, fn) : asAnon(fn);
}

export function asService<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return run("service_role", null, fn);
}
