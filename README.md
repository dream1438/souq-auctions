# Souq Mania

Online auction and fixed-price marketplace for Egypt and the Middle East. Arabic first, with English.

## What works today

- **Accounts**: sign up, sign in, profile, and ID verification (photos of the ID, checked by the team in the admin). One ID can only verify one account.
- **Selling**: auction or fixed price, up to six photos, optional reserve, optional Buy Now price, delivery cost, and an optional refundable bidder deposit on items of EGP 10,000 and more.
- **Bidding**: automatic bidding up to a secret maximum, bid steps, last-minute extension, anonymous bid history.
- **Bid Guarantee**: the winner confirms within 12 hours. If they do not, the order is cancelled and the item is offered to the next bidder at their own highest bid. Two refused parcels block an account from bidding and buying.
- **Buy Now and checkout** with saved delivery addresses. Payment is cash on delivery.
- **Orders**: confirm, ship with a tracking number, delivered or refused, completed. Delivery posts the sale to the double-entry ledger with commission and VAT.
- **Admin**: ID reviews, orders, listings (take down), deposits, members (unblock), and a button to run the housekeeping job. Staff actions are written to an audit log.

Not built yet: swaps and trade-ins (tables exist), card payments, an automatic WhatsApp sender (messages are queued in `notifications`; the team sends them with one tap from the admin orders page), courier API booking, feedback and messaging screens.

## Stack

- Next.js (App Router) with TypeScript and Tailwind CSS, deployed on Vercel
- Supabase for Postgres, sign-in and file storage

To put it online, follow [docs/connect-supabase.md](docs/connect-supabase.md).

## Run locally without Supabase

The site also runs against a plain local Postgres, with a stand-in sign-in and files on disk.

```bash
createdb souq_dev
psql -d souq_dev -v ON_ERROR_STOP=1 \
  -f supabase/tests/local_supabase_stub.sql \
  -f supabase/migrations/0001_init.sql \
  -f supabase/migrations/0002_launch_modules.sql \
  -f supabase/migrations/0003_marketplace_core.sql

cat > .env.local <<'EOF'
DATABASE_URL=postgres://postgres@127.0.0.1:5432/souq_dev
AUTH_PROVIDER=dev
STORAGE_PROVIDER=local
AUTH_SECRET=<openssl rand -hex 32>
ID_HMAC_KEY=<openssl rand -hex 32>
CRON_SECRET=<openssl rand -hex 32>
EOF

npm install
npm run dev
```

Open http://localhost:3000. You are redirected to `/ar` or `/en`. Make yourself an admin with:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5432/souq_dev node scripts/grant-role.mjs you@example.com admin
```

## Browser tests

Two scripts drive a real browser through the whole site and check the database after each step: `e2e/accounts.cjs` (sign-up, ID verification, admin review) and `e2e/market.cjs` (selling, bidding, backup winner, Buy Now, orders, strikes, deposits, admin tools). They create accounts and edit rows directly, so only run them against a throwaway local database.

```bash
npm i -D playwright && npx playwright install chromium   # once
E2E_BASE_URL=http://localhost:3000 node e2e/accounts.cjs
E2E_BASE_URL=http://localhost:3000 node e2e/market.cjs
```

## Layout

- `src/app/[lang]/` pages, one tree for both languages; `dir="rtl"` is set for Arabic
- `src/app/[lang]/dictionaries/` all visible text, `ar.json` and `en.json`
- `src/app/actions/` form handlers (server actions): `auth`, `identity`, `market`
- `src/lib/market.ts` the buying and selling workflows: bids, closing auctions, backup winners, orders, deposits, staff actions
- `src/lib/listings.ts`, `src/lib/orders.ts` read queries
- `src/lib/db.ts` database access. Every query runs as the visitor's database role, so row level security applies.
- `src/lib/auth/`, `src/lib/storage/` sign-in and file storage, each with a Supabase version and a local stand-in
- `src/styles/brand-theme.css` colours, fonts and shapes. Replace this one file to change the look.
- `src/app/api/cron/tick` the housekeeping job, called every minute
- `supabase/migrations/` database schema, applied in order
- `supabase/setup/` one-time setup for the real Supabase project
- `supabase/tests/` SQL checks for the migrations, plus a stub of what Supabase provides so they run on a plain local Postgres

## Rules for app code

- Read listings through the `listings_public` view. Never `select *` on `listings`; column access is restricted and the reserve price lives in `listing_private`.
- Do not add `listings` to Supabase Realtime with all columns.
- Money is a whole number in the currency's minor unit: EGP 1,250.50 is `125050`. Rates are basis points: 8% is `800`.
- Bids go through `place_bid(listing, max_minor)`, which returns a `bid_result` and never reveals the leader.
- New database functions get no default access. Grant `execute` explicitly to the roles that need it.
- Ledger postings go through `post_journal`, service role only.
- Use `asService` only after the code has checked who is asking. Everything else goes through `asUser` or `asAnon`.
- Server actions cannot read the language from the URL. Pass it as a hidden `locale` field.

## Open business decisions

- **VAT on commission**: the 14% is added on top of the 8% commission, so the seller's payout is the item price minus 9.12%. Confirm with the accountant whether it should be inside the 8% instead.
- **Delivery money**: delivery paid by the buyer is posted to a holding account in the ledger until it is decided who keeps it (courier, seller or platform).
- **Deposits**: collected and refunded by hand (for example InstaPay) and marked in the admin.
