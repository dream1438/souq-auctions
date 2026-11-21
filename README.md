# Souq Mania

Online auction and fixed-price marketplace for Egypt and the Middle East. Arabic first, with English.

## Stack

- Next.js (App Router) with TypeScript and Tailwind CSS
- Supabase for the Postgres database, login and image storage (not connected yet)

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. You are redirected to `/ar` or `/en`.

## Layout

- `src/app/[lang]/` pages, one tree for both languages; `dir="rtl"` is set for Arabic
- `src/app/[lang]/dictionaries/` all visible text, `ar.json` and `en.json`
- `src/proxy.ts` sends visitors to their language
- `supabase/migrations/` database schema, applied in order. `0001` is the first core, `0002` adds ID verification, Bid Guarantee, swaps and admin tables, and `0003` is the reviewed marketplace core: money as whole minor units (piastres), automatic bidding with secret maximums, offers, the order state machine, payments, a double-entry ledger, returns, feedback, messaging and staff roles.
- `supabase/tests/` SQL checks for the migrations, plus a stub of what Supabase provides so they run on a plain local Postgres.

## Rules for app code

- Read listings through the `listings_public` view. Never `select('*')` on `listings`; column access is restricted and the reserve price lives in `listing_private`.
- Do not add `listings` to Supabase Realtime with all columns.
- Money is a whole number in the currency's minor unit: EGP 1,250.50 is `125050`. Rates are basis points: 8% is `800`.
- Bids go through `place_bid(listing, max_minor)`, which returns a `bid_result` and never reveals the leader.
- New database functions get no default access. Grant `execute` explicitly to the roles that need it.
- Ledger postings go through `post_journal`, service role only.

## Next steps

1. Create a Supabase project, run the migration, and fill in `.env.local` from `.env.example`.
2. Sign-up and login.
3. Create and browse listings.
4. Bidding and Buy Now, then checkout and orders.
