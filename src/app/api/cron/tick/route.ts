import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runJobs } from "@/lib/market";

/**
 * Scheduled housekeeping: closes ended auctions, cancels unconfirmed wins and
 * moves items on to the backup winner. Call it every minute with
 *   Authorization: Bearer <CRON_SECRET>
 * Vercel Cron sends that header by itself when CRON_SECRET is set. Pages also
 * settle the listing or order being viewed, so nothing depends on this alone.
 */
export async function GET(request: Request) {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${env.cronSecret}`);
  if (!env.cronSecret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runJobs());
}
