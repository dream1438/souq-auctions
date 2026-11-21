# Connect the site to Supabase and put it online

The site runs today against a local database with a stand-in sign-in. These steps swap in the real services. Nothing in the code changes: the site switches by itself as soon as the keys below are present.

Budget about 45 minutes. Never paste any key into a chat or commit it to the repository.

## 1. Create the Supabase project

1. On supabase.com, create a project. Pick the **Frankfurt (eu-central-1)** region, the closest to Egypt.
2. Save the database password it asks for. You need it in step 4.

## 2. Create the database

In the Supabase dashboard, open **SQL Editor** and run these files one at a time, in this order. Paste the whole file and press Run. Each must finish without an error before the next.

1. `supabase/migrations/0001_init.sql`
2. `supabase/migrations/0002_launch_modules.sql`
3. `supabase/migrations/0003_marketplace_core.sql`
4. `supabase/setup/storage_buckets.sql`

Do **not** run `supabase/tests/local_supabase_stub.sql`. It imitates Supabase on a plain local database and is not for the real project.

## 3. Sign-in settings

Under **Authentication**:

- **Sign In / Providers > Email**: enabled, with email and password.
- **Confirm email**: turn it **off** for launch. Supabase's built-in email sender only allows a few messages per hour, so with it on, most sign-ups would never get their confirmation. Every member is ID-verified by the team before they can bid or sell, so this is not the safety gate. Turn it back on once a mail sender (for example Resend) is set under **Authentication > Emails > SMTP Settings**.
- **URL Configuration > Site URL**: the public address of the site, for example `https://souqmania.com`.

## 4. Environment variables

Add these in Vercel under **Project > Settings > Environment Variables** (for Production), and in a local `.env.local` file if you run the site on your own computer. `.env.example` lists the same names.

| Name | Where to find it |
| --- | --- |
| `DATABASE_URL` | Supabase **Connect** button > **Transaction pooler** connection string (port 6543). Replace `[YOUR-PASSWORD]` with the database password. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase **Project Settings > API > Project URL** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page, the `anon` / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page, the `service_role` / secret key. Server only, it bypasses all access rules. |
| `ID_HMAC_KEY` | Make one yourself: `openssl rand -hex 32`. **Never change it after launch**, or the "one ID, one account" check stops recognising earlier members. Keep a copy somewhere safe. |
| `CRON_SECRET` | Make one yourself: `openssl rand -hex 32` |
| `NEXT_PUBLIC_SITE_URL` | The public address of the site, no trailing slash. Used in the WhatsApp links the team sends. |
| `WHATSAPP_SUPPORT_NUMBER` | Optional. Support number, digits only with country code, for example `201012345678`. |

Do **not** set `AUTH_PROVIDER`, `STORAGE_PROVIDER`, `AUTH_SECRET` or `ALLOW_DEV_AUTH` in production. They belong to the local stand-in. The site refuses to start the stand-in sign-in in production.

Optional hardening: download the database certificate from **Project Settings > Database > SSL Configuration** and put its text in `DATABASE_CA_CERT`, so the site also verifies the database server's identity.

## 5. Deploy

Import the GitHub repository in Vercel (framework: Next.js, no other settings), add the variables from step 4, and deploy. Point the domain at the Vercel project.

## 6. Schedule the housekeeping job

Auctions close, unconfirmed wins expire and backup winners get their offer through one address, `/api/cron/tick`, which should be called every minute. Pages also settle the listing or order being looked at, so a missed minute does not lose anything, but without the schedule nothing happens while nobody is looking.

Vercel's free plan only runs scheduled jobs once a day, so schedule it from Supabase instead. In the SQL editor, with your own site address and the `CRON_SECRET` value from step 4:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'souq-mania-tick',
  '* * * * *',
  $$ select net.http_get(
       url := 'https://YOUR-SITE/api/cron/tick',
       headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET')
     ) $$
);
```

To check it, open **Integrations > Cron** in Supabase after a few minutes: the job should show successful runs. To change the secret later, run `select cron.unschedule('souq-mania-tick');` and schedule it again.

## 7. Create the first admin

1. Sign up on the live site with the email you will use as admin.
2. In the Supabase SQL editor, run this with that email:

```sql
insert into public.staff_members (user_id, role)
select id, 'admin' from auth.users where lower(email) = lower('you@example.com')
on conflict do nothing;
```

3. Reload the site. An **Admin** link appears in the menu. From there you approve ID checks and run the day-to-day tools.

Other roles for team members, set the same way: `moderator`, `kyc_reviewer`, `finance`, `support`.

## 8. Check it before telling anyone

Do one full round with two test accounts: sign up, submit an ID, approve it as admin, list an item with photos, bid from the second account, buy a fixed-price item, mark it shipped, then mark it delivered in the admin. If the photo upload or the sign-in fails, the usual cause is a wrong or missing key from step 4.

## What has not been proven yet

Everything was tested end to end on a local copy of the database that imitates Supabase. Two parts could only be written, not run, because no Supabase project existed yet:

- the Supabase sign-in (sign up, sign in, sign out, session refresh)
- uploads to Supabase Storage, and the short-lived links for ID photos

Treat step 8 as the test of those two.
