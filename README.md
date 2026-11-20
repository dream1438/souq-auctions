# Souq Auctions

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
- `supabase/migrations/` database schema, including the `place_bid` function that makes bidding safe when two people bid at once

## Next steps

1. Create a Supabase project, run the migration, and fill in `.env.local` from `.env.example`.
2. Sign-up and login.
3. Create and browse listings.
4. Bidding and Buy Now, then checkout and orders.
