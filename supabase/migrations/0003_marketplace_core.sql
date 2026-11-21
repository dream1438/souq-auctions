-- Souq Mania: marketplace core.
--
-- What this migration changes, in order:
--   1. Reference data: currencies (with minor-unit exponent), countries, governorates.
--   2. Money becomes bigint minor units (piastres for EGP, fils for KWD/BHD).
--   3. Staff roles replace the single is_admin flag.
--   4. Account restrictions, consents, login and risk signals.
--   5. Seller profiles, return policies, fee schedules.
--   6. Listings: format, quantity, schedule, item specifics, shipping options,
--      search, a private reserve price, column-level grants.
--   7. Proxy bidding with secret maximums, masked public bid history,
--      bid increments, buy now, auction close.
--   8. Best Offer.
--   9. Orders: money breakdown, payment status, enforced state machine.
--  10. Payments: payment intents, refunds, webhook inbox, saved card tokens,
--      payout methods.
--  11. Double-entry ledger (replaces the single-entry ledger_entries).
--  12. Shipping events, returns and disputes (cases).
--  13. Feedback and detailed seller ratings.
--  14. Watchlist, saved searches, follows.
--  15. Messaging.
--  16. Reports (moderation queue).
--  17. Notifications: preferences and delivery status.
--  18. ID verification: HMAC instead of a plain hash.
--  19. Audit triggers and updated_at triggers.
--
-- Conventions:
--   * Every money column is bigint in the currency's minor unit. EGP 1,250.50 = 125050.
--   * Rates are integer basis points: 8% = 800.
--   * auth.uid() is wrapped as (select auth.uid()) in policies so Postgres
--     evaluates it once per query, not once per row.
--   * No new enum value is used in this same file outside plpgsql bodies,
--     so the file can run inside one transaction.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- Supabase grants EXECUTE on new functions straight to anon and authenticated
-- (not through PUBLIC), so "revoke ... from public" alone does nothing there.
-- Stop that for functions created by this migration; the end of the file
-- grants each function to exactly the roles that need it.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ===========================================================================
-- 1. Reference data
-- ===========================================================================
create table currencies (
  code char(3) primary key,
  minor_exponent smallint not null check (minor_exponent between 0 and 3),
  name_ar text not null,
  name_en text not null
);

insert into currencies (code, minor_exponent, name_ar, name_en) values
  ('EGP', 2, 'جنيه مصري', 'Egyptian pound'),
  ('SAR', 2, 'ريال سعودي', 'Saudi riyal'),
  ('AED', 2, 'درهم إماراتي', 'UAE dirham'),
  ('QAR', 2, 'ريال قطري', 'Qatari riyal'),
  ('KWD', 3, 'دينار كويتي', 'Kuwaiti dinar'),
  ('BHD', 3, 'دينار بحريني', 'Bahraini dinar');

create table countries (
  code char(2) primary key,
  name_ar text not null,
  name_en text not null,
  currency char(3) not null references currencies (code),
  phone_prefix text not null,
  is_live boolean not null default false
);

insert into countries (code, name_ar, name_en, currency, phone_prefix, is_live) values
  ('EG', 'مصر', 'Egypt', 'EGP', '+20', true),
  ('SA', 'السعودية', 'Saudi Arabia', 'SAR', '+966', false),
  ('AE', 'الإمارات', 'United Arab Emirates', 'AED', '+971', false),
  ('QA', 'قطر', 'Qatar', 'QAR', '+974', false),
  ('KW', 'الكويت', 'Kuwait', 'KWD', '+965', false),
  ('BH', 'البحرين', 'Bahrain', 'BHD', '+973', false);

create table governorates (
  id smallint generated always as identity primary key,
  country char(2) not null references countries (code),
  code text not null,
  name_ar text not null,
  name_en text not null,
  unique (country, code)
);

insert into governorates (country, code, name_ar, name_en) values
  ('EG', 'C', 'القاهرة', 'Cairo'),
  ('EG', 'GZ', 'الجيزة', 'Giza'),
  ('EG', 'ALX', 'الإسكندرية', 'Alexandria'),
  ('EG', 'KB', 'القليوبية', 'Qalyubia'),
  ('EG', 'DK', 'الدقهلية', 'Dakahlia'),
  ('EG', 'SHR', 'الشرقية', 'Sharqia'),
  ('EG', 'GH', 'الغربية', 'Gharbia'),
  ('EG', 'MNF', 'المنوفية', 'Monufia'),
  ('EG', 'BH', 'البحيرة', 'Beheira'),
  ('EG', 'KFS', 'كفر الشيخ', 'Kafr El Sheikh'),
  ('EG', 'DT', 'دمياط', 'Damietta'),
  ('EG', 'PTS', 'بورسعيد', 'Port Said'),
  ('EG', 'IS', 'الإسماعيلية', 'Ismailia'),
  ('EG', 'SUZ', 'السويس', 'Suez'),
  ('EG', 'FYM', 'الفيوم', 'Faiyum'),
  ('EG', 'BNS', 'بني سويف', 'Beni Suef'),
  ('EG', 'MN', 'المنيا', 'Minya'),
  ('EG', 'AST', 'أسيوط', 'Asyut'),
  ('EG', 'SHG', 'سوهاج', 'Sohag'),
  ('EG', 'KN', 'قنا', 'Qena'),
  ('EG', 'LX', 'الأقصر', 'Luxor'),
  ('EG', 'ASN', 'أسوان', 'Aswan'),
  ('EG', 'BA', 'البحر الأحمر', 'Red Sea'),
  ('EG', 'WAD', 'الوادي الجديد', 'New Valley'),
  ('EG', 'MT', 'مطروح', 'Matrouh'),
  ('EG', 'SIN', 'شمال سيناء', 'North Sinai'),
  ('EG', 'JS', 'جنوب سيناء', 'South Sinai');

alter table currencies enable row level security;
alter table countries enable row level security;
alter table governorates enable row level security;
create policy "currencies are public" on currencies for select using (true);
create policy "countries are public" on countries for select using (true);
create policy "governorates are public" on governorates for select using (true);

-- ===========================================================================
-- 2. Money as bigint minor units
-- ===========================================================================
-- Policies that read a column block a type change, so drop them first and
-- recreate them in section 6.
drop policy "verified users create listings" on listings;
drop policy "sellers edit listings without bids" on listings;
drop function place_bid(uuid, numeric);

alter table listings
  drop constraint deposit_only_on_high_value,
  drop constraint reserve_not_below_start,
  drop constraint reserve_needs_auction;

alter table listings
  alter column start_price type bigint using round(start_price * 100)::bigint,
  alter column buy_now_price type bigint using round(buy_now_price * 100)::bigint,
  alter column current_price type bigint using round(current_price * 100)::bigint,
  alter column reserve_price type bigint using round(reserve_price * 100)::bigint,
  alter column deposit_amount type bigint using round(deposit_amount * 100)::bigint;

alter table bids alter column amount type bigint using round(amount * 100)::bigint;
alter table orders alter column amount type bigint using round(amount * 100)::bigint;
alter table deposits alter column amount type bigint using round(amount * 100)::bigint;
alter table second_chance_offers alter column amount type bigint using round(amount * 100)::bigint;
alter table swap_offers alter column cash_amount type bigint using round(cash_amount * 100)::bigint;
alter table payouts alter column amount type bigint using round(amount * 100)::bigint;
alter table shipments alter column cod_amount type bigint using round(cod_amount * 100)::bigint;

comment on column listings.start_price is 'Minor units of listings.currency (piastres for EGP).';
comment on column orders.amount is 'Item price in minor units of orders.currency.';

-- Currency columns point at the currency table.
alter table listings add constraint listings_currency_fk foreign key (currency) references currencies (code);
alter table listings add constraint listings_country_fk foreign key (country) references countries (code);
alter table orders add constraint orders_currency_fk foreign key (currency) references currencies (code);
alter table deposits add constraint deposits_currency_fk foreign key (currency) references currencies (code);
alter table payouts add constraint payouts_currency_fk foreign key (currency) references currencies (code);
alter table swap_offers add constraint swap_offers_currency_fk foreign key (currency) references currencies (code);
alter table addresses add constraint addresses_country_fk foreign key (country) references countries (code);
alter table addresses add column governorate_id smallint references governorates (id);

-- The single-entry ledger is replaced by the double-entry ledger in section 11.
drop table ledger_entries;
drop type ledger_entry_type;

update settings set value = '1000000', description = 'Lowest item price, in piastres, on which a seller may require a deposit'
  where key = 'deposit_min_item_price';
update settings set value = '800', key = 'commission_bps', description = 'Default commission in basis points (800 = 8%)'
  where key = 'commission_rate';

insert into settings (key, value, description) values
  ('bid_increments',
   '[[0, 1000], [50000, 2500], [200000, 5000], [500000, 10000], [1000000, 25000], [2500000, 50000], [5000000, 100000]]',
   'Pairs of [price from, increment], both in piastres. EGP: under 500 → 10, 500+ → 25, 2,000+ → 50, 5,000+ → 100, 10,000+ → 250, 25,000+ → 500, 50,000+ → 1,000'),
  ('vat_bps', '1400', 'VAT on our fees in basis points (Egypt 14%)'),
  ('payout_release_days', '3', 'Days after delivery before seller funds become available'),
  ('feedback_window_days', '30', 'Days after delivery in which feedback can be left'),
  ('feedback_min_account_age_days', '5', 'Minimum account age to leave feedback'),
  ('case_not_received_days', '30', 'Days after the expected delivery date to report an item not received'),
  ('case_not_as_described_days', '30', 'Days after delivery to report an item not as described'),
  ('case_seller_response_days', '3', 'Days the seller has to answer a case before the buyer can escalate'),
  ('offer_hours', '24', 'Hours a seller has to answer a Best Offer'),
  ('counter_offer_hours', '96', 'Hours a counteroffer stays open'),
  ('max_offers_per_buyer', '3', 'Best Offers one buyer may make on one listing'),
  ('reserve_change_min_hours', '12', 'Hours that must remain to lower a reserve'),
  ('snipe_extension_seconds', '120', 'A bid this close to the end pushes the end out by this much'),
  ('delivery_otp_min_price', '1000000', 'Orders at or above this (piastres) need an OTP at delivery');

create function setting_int(p_key text, p_default bigint)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value #>> '{}')::bigint from settings where key = p_key), p_default);
$$;

-- ===========================================================================
-- 3. Staff roles
-- ===========================================================================
create type staff_role as enum ('admin', 'moderator', 'kyc_reviewer', 'finance', 'support');

create table staff_members (
  user_id uuid not null references profiles (id) on delete cascade,
  role staff_role not null,
  granted_by uuid references profiles (id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- Admins hold every role.
create function has_role(p_role staff_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from staff_members s
    where s.user_id = auth.uid() and (s.role = p_role or s.role = 'admin')
  );
$$;

-- Keep is_admin() working for every policy in 0002, and honour the old flag
-- until it is dropped.
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select has_role('admin')
      or coalesce((select p.is_admin from profiles p where p.id = auth.uid()), false);
$$;

create function is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from staff_members s where s.user_id = auth.uid())
      or coalesce((select p.is_admin from profiles p where p.id = auth.uid()), false);
$$;

alter table staff_members enable row level security;
create policy "staff read the staff list" on staff_members for select using ((select is_staff()));
create policy "admins manage staff" on staff_members for all using ((select is_admin())) with check ((select is_admin()));

-- KYC reviewers, not only admins, review ID submissions.
create or replace function review_identity_verification(
  p_verification_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns identity_verifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row identity_verifications;
begin
  if not has_role('kyc_reviewer') and not is_admin() then
    raise exception 'kyc_reviewer_only';
  end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    raise exception 'rejection_needs_reason';
  end if;

  select * into v_row from identity_verifications where id = p_verification_id for update;
  if not found then
    raise exception 'verification_not_found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'verification_already_reviewed';
  end if;
  if v_row.user_id = auth.uid() then
    raise exception 'cannot_review_own_submission';
  end if;

  update identity_verifications
  set status = case when p_approve then 'approved' else 'rejected' end::verification_status,
      rejection_reason = case when p_approve then null else p_reason end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_verification_id
  returning * into v_row;

  update profiles set verification_status = v_row.status where id = v_row.user_id;

  insert into audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    case when p_approve then 'identity_approved' else 'identity_rejected' end,
    'identity_verification',
    p_verification_id::text,
    jsonb_build_object('user_id', v_row.user_id, 'reason', p_reason)
  );

  return v_row;
end;
$$;

-- ===========================================================================
-- 4. Restrictions, consents, sign-ins, risk
-- ===========================================================================
create type restriction_kind as enum ('bidding', 'buying', 'selling', 'messaging', 'payouts', 'account');

-- Any limit on an account, with who set it, why and until when. The 0002
-- bidding block (profiles.bidding_blocked_at) is still checked as well.
create table account_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  kind restriction_kind not null,
  reason text not null check (char_length(reason) between 3 and 500),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  lifted_at timestamptz,
  lifted_by uuid references profiles (id),
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create index account_restrictions_active_idx on account_restrictions (user_id, kind)
  where lifted_at is null;

create function is_restricted(p_user_id uuid, p_kind restriction_kind)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from account_restrictions r
    where r.user_id = p_user_id
      and r.kind in (p_kind, 'account')
      and r.lifted_at is null
      and r.starts_at <= now()
      and (r.ends_at is null or r.ends_at > now())
  );
$$;

create type consent_kind as enum (
  'terms', 'privacy', 'whatsapp_transactional', 'whatsapp_marketing', 'email_marketing', 'sms_marketing'
);

-- WhatsApp messages need recorded opt-in. A withdrawal is a new row, never an edit.
create table consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  kind consent_kind not null,
  granted boolean not null,
  document_version text,
  source text not null default 'web',
  created_at timestamptz not null default now()
);

create index consents_user_idx on consents (user_id, kind, created_at desc);

create table login_events (
  id bigint generated always as identity primary key,
  user_id uuid references profiles (id) on delete set null,
  ip inet,
  user_agent text,
  device_hash text,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);

create index login_events_user_idx on login_events (user_id, created_at desc);
create index login_events_device_idx on login_events (device_hash) where device_hash is not null;

create table risk_signals (
  id bigint generated always as identity primary key,
  user_id uuid references profiles (id) on delete cascade,
  listing_id uuid references listings (id) on delete cascade,
  order_id uuid references orders (id) on delete cascade,
  kind text not null,
  score smallint not null check (score between 0 and 100),
  details jsonb not null default '{}',
  reviewed_by uuid references profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index risk_signals_user_idx on risk_signals (user_id, created_at desc);
create index risk_signals_open_idx on risk_signals (score desc, created_at) where reviewed_at is null;

create trigger consents_append_only before update or delete on consents
  for each row execute function forbid_change();

alter table account_restrictions enable row level security;
alter table consents enable row level security;
alter table login_events enable row level security;
alter table risk_signals enable row level security;

create policy "users see their own restrictions" on account_restrictions
  for select using (user_id = (select auth.uid()) or (select is_staff()));
create policy "staff set restrictions" on account_restrictions
  for insert with check ((select has_role('moderator')) and created_by = (select auth.uid()));
create policy "staff lift restrictions" on account_restrictions
  for update using ((select has_role('moderator'))) with check ((select has_role('moderator')));

create policy "users read their own consents" on consents
  for select using (user_id = (select auth.uid()) or (select is_staff()));
revoke insert on consents from anon, authenticated;
grant insert (user_id, kind, granted, document_version) on consents to authenticated;
create policy "users record their own consents" on consents
  for insert with check (user_id = (select auth.uid()));

create policy "staff read sign-ins" on login_events for select using ((select is_staff()));
create policy "staff read risk signals" on risk_signals for select using ((select is_staff()));
create policy "staff review risk signals" on risk_signals
  for update using ((select has_role('moderator'))) with check ((select has_role('moderator')));

-- ===========================================================================
-- 5. Sellers, return policies, fees
-- ===========================================================================
create type seller_type as enum ('individual', 'business');
create type return_shipping_payer as enum ('buyer', 'seller');

create table seller_profiles (
  user_id uuid primary key references profiles (id) on delete cascade,
  seller_type seller_type not null default 'individual',
  business_name text,
  commercial_register_no text,
  tax_registration_no text,
  business_verified_at timestamptz,
  business_verified_by uuid references profiles (id),
  vacation_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    seller_type = 'individual'
    or (business_name is not null and commercial_register_no is not null and tax_registration_no is not null)
  )
);

create table return_policies (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  accepts_returns boolean not null,
  return_days smallint not null default 0,
  return_shipping_paid_by return_shipping_payer not null default 'buyer',
  created_at timestamptz not null default now(),
  check ((accepts_returns and return_days in (3, 7, 14, 30)) or (not accepts_returns and return_days = 0))
);

create index return_policies_seller_idx on return_policies (seller_id);

-- Commission by category and period. A null category is the default rate.
create table fee_schedules (
  id smallint generated always as identity primary key,
  category_id smallint references categories (id),
  currency char(3) not null default 'EGP' references currencies (code),
  rate_bps integer not null check (rate_bps between 0 and 5000),
  fixed_fee bigint not null default 0 check (fixed_fee >= 0),
  max_fee bigint check (max_fee > 0),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  check (valid_to is null or valid_to > valid_from)
);

create index fee_schedules_lookup_idx on fee_schedules (currency, category_id, valid_from desc);

insert into fee_schedules (category_id, currency, rate_bps) values (null, 'EGP', 800);

-- Commission on an amount, for the category's current schedule (falls back to default).
create function commission_for(p_category_id smallint, p_currency char(3), p_amount bigint)
returns table (rate_bps integer, fee bigint)
language sql
stable
security definer
set search_path = public
as $$
  select f.rate_bps,
         least(coalesce(f.max_fee, 9223372036854775807),
               (p_amount * f.rate_bps + 5000) / 10000 + f.fixed_fee)
  from fee_schedules f
  where f.currency = p_currency
    and (f.category_id = p_category_id or f.category_id is null)
    and f.valid_from <= now()
    and (f.valid_to is null or f.valid_to > now())
  order by (f.category_id is null), f.valid_from desc
  limit 1;
$$;

alter table seller_profiles enable row level security;
alter table return_policies enable row level security;
alter table fee_schedules enable row level security;

create policy "sellers read their own seller profile" on seller_profiles
  for select using (user_id = (select auth.uid()) or (select is_staff()));
create policy "sellers create their seller profile" on seller_profiles
  for insert with check (user_id = (select auth.uid()) and business_verified_at is null and business_verified_by is null);
create policy "sellers edit their seller profile" on seller_profiles
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke update on seller_profiles from authenticated, anon;
grant update (seller_type, business_name, commercial_register_no, tax_registration_no, vacation_until)
  on seller_profiles to authenticated;

create policy "return policies are public" on return_policies for select using (true);
create policy "sellers manage their return policies" on return_policies
  for all using (seller_id = (select auth.uid())) with check (seller_id = (select auth.uid()));

create policy "fee schedules are public" on fee_schedules for select using (true);
create policy "finance manages fees" on fee_schedules
  for all using ((select has_role('finance'))) with check ((select has_role('finance')));

-- ===========================================================================
-- 6. Listings
-- ===========================================================================
create type listing_format as enum ('auction', 'fixed_price', 'classified');
create type attribute_data_type as enum ('text', 'number', 'boolean', 'choice');

alter type listing_status add value if not exists 'scheduled';

alter table listings
  drop constraint has_a_price,
  add column format listing_format,
  add column quantity integer not null default 1 check (quantity between 1 and 10000),
  add column quantity_sold integer not null default 0 check (quantity_sold >= 0),
  add column starts_at timestamptz,
  add column governorate_id smallint references governorates (id),
  add column return_policy_id uuid references return_policies (id),
  add column has_reserve boolean not null default false,
  add column reserve_met boolean not null default false,
  add column updated_at timestamptz not null default now(),
  add column search_vector tsvector generated always as (
    setweight(to_tsvector('arabic', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('arabic', coalesce(description, '')), 'C')
    || setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) stored;

-- Backfill rows that already exist before the new rules apply to them.
update listings set
  format = case when start_price is not null then 'auction' else 'fixed_price' end::listing_format,
  starts_at = least(created_at, coalesce(ends_at, created_at) - interval '1 second');

alter table listings
  alter column format set not null,
  alter column format set default 'fixed_price',
  alter column starts_at set not null,
  alter column starts_at set default now(),
  add constraint sold_within_quantity check (quantity_sold <= quantity),
  add constraint auction_shape check (
    format <> 'auction' or (start_price is not null and ends_at is not null and quantity = 1)
  ),
  add constraint fixed_price_shape check (
    format <> 'fixed_price' or (buy_now_price is not null and start_price is null)
  ),
  add constraint classified_shape check (
    format <> 'classified' or (start_price is null and not requires_deposit)
  ),
  add constraint ends_after_start check (ends_at is null or ends_at > starts_at),
  add constraint deposit_only_on_high_value check (
    not requires_deposit or coalesce(start_price, buy_now_price) >= 1000000
  );

create index listings_search_idx on listings using gin (search_vector);
create index listings_title_trgm_idx on listings using gin (title extensions.gin_trgm_ops);
create index listings_live_price_idx on listings (category_id, coalesce(current_price, start_price, buy_now_price))
  where status = 'active';
create index listings_governorate_idx on listings (governorate_id) where status = 'active';
create index listings_starts_idx on listings (starts_at) where status = 'draft';

-- Private, seller-only listing settings: reserve and Best Offer thresholds.
create table listing_private (
  listing_id uuid primary key references listings (id) on delete cascade,
  reserve_price bigint check (reserve_price > 0),
  offer_auto_accept bigint check (offer_auto_accept > 0),
  offer_auto_decline bigint check (offer_auto_decline > 0),
  updated_at timestamptz not null default now(),
  check (offer_auto_decline is null or offer_auto_accept is null or offer_auto_decline < offer_auto_accept)
);

-- Move existing reserves across, then drop the public column.
insert into listing_private (listing_id, reserve_price)
select id, reserve_price from listings where reserve_price is not null;

update listings l
set has_reserve = (l.reserve_price is not null),
    reserve_met = l.bid_count > 0 and (l.reserve_price is null or l.current_price >= l.reserve_price);

alter table listings drop column reserve_price;

-- Counters change often; keeping them off the listings row avoids lock
-- contention with place_bid and needless search-vector rewrites.
create table listing_stats (
  listing_id uuid primary key references listings (id) on delete cascade,
  watch_count integer not null default 0 check (watch_count >= 0),
  view_count bigint not null default 0 check (view_count >= 0)
);

alter table listing_stats enable row level security;
create policy "listing stats are public" on listing_stats for select using (true);

-- Keeps listings.has_reserve in step, and applies eBay's reserve rules: add only
-- before bids; lower only while unmet with enough time left; remove only before bids.
create function listing_private_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_l listings;
  v_min_hours bigint := setting_int('reserve_change_min_hours', 12);
  v_old bigint := case when tg_op in ('UPDATE', 'DELETE') then old.reserve_price end;
  v_new bigint := case when tg_op in ('INSERT', 'UPDATE') then new.reserve_price end;
begin
  select * into v_l from listings
  where id = coalesce(new.listing_id, old.listing_id) for update;

  if v_new is not distinct from v_old then
    null;
  elsif v_new is not null and (v_l.format <> 'auction' or v_new < v_l.start_price) then
    raise exception 'reserve_needs_auction_at_or_above_start';
  elsif v_l.bid_count > 0 then
    if v_new is null or v_old is null then
      raise exception 'reserve_locked_after_bids';
    elsif v_new > v_old then
      raise exception 'reserve_can_only_be_lowered';
    elsif v_l.reserve_met then
      raise exception 'reserve_already_met';
    elsif v_l.ends_at - now() < make_interval(hours => v_min_hours::int) then
      raise exception 'too_late_to_change_reserve';
    end if;
  end if;

  if v_l.buy_now_price is not null and v_new is not null and v_new > v_l.buy_now_price then
    raise exception 'reserve_above_buy_now';
  end if;

  update listings
  set has_reserve = (v_new is not null),
      reserve_met = bid_count > 0 and (v_new is null or current_price >= v_new)
  where id = v_l.id;

  -- A lowered reserve may now be within the leader's maximum: run the proxy
  -- up to the new reserve, exactly as place_bid would have.
  if v_new is not null and v_l.bid_count > 0 and v_l.current_price < v_new
     and (select a.max_amount from auto_bids a
          where a.listing_id = v_l.id and a.bidder_id = v_l.highest_bidder_id) >= v_new then
    insert into bids (listing_id, bidder_id, amount, is_automatic)
    values (v_l.id, v_l.highest_bidder_id, v_new, true);
    update listings
    set current_price = v_new, reserve_met = true, bid_count = bid_count + 1
    where id = v_l.id;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger listing_private_guard
  before insert or update or delete on listing_private
  for each row execute function listing_private_guard();

-- Item specifics per category (brand, model, storage, colour...).
create table category_attributes (
  id integer generated always as identity primary key,
  category_id smallint not null references categories (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name_ar text not null,
  name_en text not null,
  data_type attribute_data_type not null,
  choices jsonb check (choices is null or jsonb_typeof(choices) = 'array'),
  is_required boolean not null default false,
  is_filter boolean not null default true,
  sort_order smallint not null default 0,
  unique (category_id, key),
  check ((data_type = 'choice') = (choices is not null))
);

create table listing_attributes (
  listing_id uuid not null references listings (id) on delete cascade,
  attribute_id integer not null references category_attributes (id),
  value_text text,
  value_number numeric,
  value_boolean boolean,
  primary key (listing_id, attribute_id),
  check (num_nonnulls(value_text, value_number, value_boolean) = 1)
);

create index listing_attributes_filter_text_idx on listing_attributes (attribute_id, value_text);
create index listing_attributes_filter_number_idx on listing_attributes (attribute_id, value_number);

create table listing_shipping_options (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id) on delete cascade,
  courier text not null default 'bosta',
  service text not null default 'standard',
  cost bigint not null default 0 check (cost >= 0),
  handling_days smallint not null default 2 check (handling_days between 0 and 10),
  is_local_pickup boolean not null default false,
  sort_order smallint not null default 0
);

create index listing_shipping_options_listing_idx on listing_shipping_options (listing_id, sort_order);

-- Column-level grants: clients may write only these columns. Prices, counters,
-- winner, reserve flags and status after bids change only through functions.
revoke insert, update on listings from anon, authenticated;
grant insert (
  seller_id, category_id, title, description, condition, city, country, currency,
  start_price, buy_now_price, ends_at, status, requires_deposit, deposit_amount,
  accepts_swaps, format, quantity, starts_at, governorate_id, return_policy_id
) on listings to authenticated;
grant update (
  category_id, title, description, condition, city, start_price, buy_now_price, ends_at,
  status, requires_deposit, deposit_amount, accepts_swaps, format, quantity, starts_at,
  governorate_id, return_policy_id
) on listings to authenticated;

-- Reads: everything except the current winner's account id.
revoke select on listings from anon, authenticated;
grant select (
  id, seller_id, category_id, title, description, condition, city, country, currency,
  start_price, buy_now_price, current_price, bid_count, ends_at, status, created_at,
  requires_deposit, deposit_amount, accepts_swaps, format, quantity, quantity_sold,
  starts_at, governorate_id, return_policy_id, has_reserve, reserve_met,
  updated_at, search_vector
) on listings to anon, authenticated;

-- What the app reads. select('*') works here; on the table itself it fails,
-- because highest_bidder_id has no read grant.
create view listings_public
with (security_invoker = true) as
  select
    id, seller_id, category_id, title, description, condition, city, country, currency,
    start_price, buy_now_price, current_price, bid_count, ends_at, status, created_at,
    requires_deposit, deposit_amount, accepts_swaps, format, quantity, quantity_sold,
    starts_at, governorate_id, return_policy_id, has_reserve, reserve_met, updated_at,
    search_vector
  from listings;
grant select on listings_public to anon, authenticated;

create policy "verified users create listings" on listings
  for insert with check (
    seller_id = (select auth.uid())
    and status in ('draft', 'active')
    and exists (
      select 1 from profiles p
      where p.id = (select auth.uid()) and p.verification_status = 'approved'
    )
    and not is_restricted((select auth.uid()), 'selling')
  );

-- No edits after the first bid or the first sale: a changed title or condition
-- would rewrite the evidence for a not-as-described claim.
create policy "sellers edit listings without bids" on listings
  for update using (
    seller_id = (select auth.uid()) and bid_count = 0 and quantity_sold = 0
    and status in ('draft', 'active')
  )
  with check (
    seller_id = (select auth.uid()) and bid_count = 0 and quantity_sold = 0
    and status in ('draft', 'active', 'cancelled')
    and not is_restricted((select auth.uid()), 'selling')
  );

alter table listing_private enable row level security;
alter table category_attributes enable row level security;
alter table listing_attributes enable row level security;
alter table listing_shipping_options enable row level security;

create policy "sellers manage their private settings" on listing_private
  for all using (
    exists (select 1 from listings l where l.id = listing_id and l.seller_id = (select auth.uid()))
    or (select is_staff())
  )
  with check (
    exists (select 1 from listings l where l.id = listing_id and l.seller_id = (select auth.uid()))
  );

create policy "category attributes are public" on category_attributes for select using (true);
create policy "moderators manage category attributes" on category_attributes
  for all using ((select has_role('moderator'))) with check ((select has_role('moderator')));

create policy "listing attributes follow their listing" on listing_attributes
  for select using (
    exists (select 1 from listings l where l.id = listing_id
            and (l.status <> 'draft' or l.seller_id = (select auth.uid())))
  );
create policy "sellers manage their listing attributes" on listing_attributes
  for all using (
    exists (select 1 from listings l where l.id = listing_id
            and l.seller_id = (select auth.uid()) and l.bid_count = 0)
  )
  with check (
    exists (select 1 from listings l where l.id = listing_id
            and l.seller_id = (select auth.uid()) and l.bid_count = 0)
  );

create policy "shipping options follow their listing" on listing_shipping_options
  for select using (
    exists (select 1 from listings l where l.id = listing_id
            and (l.status <> 'draft' or l.seller_id = (select auth.uid())))
  );
create policy "sellers manage their shipping options" on listing_shipping_options
  for all using (
    exists (select 1 from listings l where l.id = listing_id and l.seller_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from listings l where l.id = listing_id and l.seller_id = (select auth.uid()))
  );

-- ===========================================================================
-- 7. Bidding: proxy bids, masked history, increments, buy now, close
-- ===========================================================================
-- One secret maximum per bidder per listing. Only the bidder can read it.
create table auto_bids (
  listing_id uuid not null references listings (id) on delete cascade,
  bidder_id uuid not null references profiles (id),
  max_amount bigint not null check (max_amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (listing_id, bidder_id)
);

create index auto_bids_bidder_idx on auto_bids (bidder_id, updated_at desc);

alter table bids add column is_automatic boolean not null default false;

-- Existing bids become each bidder's maximum, so a running auction keeps its price.
insert into auto_bids (listing_id, bidder_id, max_amount, created_at, updated_at)
select listing_id, bidder_id, max(amount), min(created_at), max(created_at)
from bids
group by listing_id, bidder_id;

alter table auto_bids enable row level security;
create policy "bidders read their own maximum" on auto_bids
  for select using (bidder_id = (select auth.uid()) or (select is_staff()));

-- Bids are no longer public rows: the public sees masked history through the view.
drop policy "bids are public" on bids;
create policy "bidders read their own bids" on bids
  for select using (bidder_id = (select auth.uid()) or (select is_staff()));

create view bid_history
with (security_barrier = true) as
  select
    b.id,
    b.listing_id,
    b.amount,
    b.is_automatic,
    b.created_at,
    left(p.display_name, 1) || '***' || right(p.display_name, 1) as bidder_alias,
    b.bidder_id = auth.uid() as is_mine
  from bids b
  join profiles p on p.id = b.bidder_id;
grant select on bid_history to anon, authenticated;

-- Is the caller winning? Reads the hidden highest_bidder_id for the caller only.
create function am_i_winning(p_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select highest_bidder_id = auth.uid() from listings where id = p_listing_id), false);
$$;

create function bid_increment(p_price bigint)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (step ->> 1)::bigint
     from settings s, jsonb_array_elements(s.value) step
     where s.key = 'bid_increments' and (step ->> 0)::bigint <= p_price
     order by (step ->> 0)::bigint desc
     limit 1),
    1000);
$$;

-- Place or raise a maximum bid. The visible price moves only as far as needed:
-- one increment above the runner-up's maximum, or up to the reserve when the
-- leader's maximum reaches it. Equal maximums: the earlier one leads.
-- What a bidder gets back: never the leader's account id, only whether it is them.
create type bid_result as (
  current_price bigint,
  bid_count integer,
  ends_at timestamptz,
  reserve_met boolean,
  is_leading boolean
);

create function place_bid(p_listing_id uuid, p_max_amount bigint)
returns bid_result
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_listing listings;
  v_profile profiles;
  v_reserve bigint;
  v_leader auto_bids;
  v_min bigint;
  v_price bigint;
  v_leader_id uuid;
  v_leader_max bigint;
  v_new_bids integer := 0;
  v_ext interval := make_interval(secs => setting_int('snipe_extension_seconds', 120));
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;

  select * into v_profile from profiles where id = v_uid;
  if not found then
    raise exception 'profile_not_found';
  end if;
  if v_profile.verification_status <> 'approved' then
    raise exception 'identity_not_verified';
  end if;
  if v_profile.bidding_blocked_at is not null or is_restricted(v_uid, 'bidding') then
    raise exception 'bidding_blocked';
  end if;

  select * into v_listing from listings where id = p_listing_id for update;
  if not found then
    raise exception 'listing_not_found';
  end if;
  if v_listing.status <> 'active' or v_listing.format <> 'auction' then
    raise exception 'listing_not_open_for_bids';
  end if;
  if v_listing.starts_at > now() then
    raise exception 'auction_not_started';
  end if;
  if v_listing.ends_at <= now() then
    raise exception 'auction_ended';
  end if;
  if v_listing.seller_id = v_uid then
    raise exception 'cannot_bid_on_own_listing';
  end if;
  if v_listing.requires_deposit and not exists (
    select 1 from deposits d
    where d.listing_id = p_listing_id and d.user_id = v_uid and d.status = 'held'
  ) then
    raise exception 'deposit_required' using detail = v_listing.deposit_amount::text;
  end if;

  select reserve_price into v_reserve from listing_private where listing_id = p_listing_id;

  if v_listing.highest_bidder_id is not null then
    select * into v_leader from auto_bids
    where listing_id = p_listing_id and bidder_id = v_listing.highest_bidder_id;
  end if;

  -- The leader raising their own maximum.
  if v_listing.highest_bidder_id = v_uid then
    if p_max_amount <= v_leader.max_amount then
      raise exception 'new_maximum_must_be_higher' using detail = v_leader.max_amount::text;
    end if;
    update auto_bids set max_amount = p_max_amount, updated_at = now()
    where listing_id = p_listing_id and bidder_id = v_uid;

    if v_reserve is not null and not v_listing.reserve_met and p_max_amount >= v_reserve then
      insert into bids (listing_id, bidder_id, amount, is_automatic)
      values (p_listing_id, v_uid, v_reserve, false);
      update listings
      set current_price = v_reserve, reserve_met = true, bid_count = bid_count + 1, updated_at = now()
      where id = p_listing_id
      returning * into v_listing;
    end if;
    return (v_listing.current_price, v_listing.bid_count, v_listing.ends_at,
            v_listing.reserve_met, v_listing.highest_bidder_id = v_uid)::bid_result;
  end if;

  v_min := case
    when v_listing.bid_count = 0 then v_listing.start_price
    else v_listing.current_price + bid_increment(v_listing.current_price)
  end;
  if p_max_amount < v_min then
    raise exception 'bid_too_low' using detail = v_min::text;
  end if;

  insert into auto_bids (listing_id, bidder_id, max_amount)
  values (p_listing_id, v_uid, p_max_amount)
  on conflict (listing_id, bidder_id)
  do update set max_amount = excluded.max_amount, updated_at = now();

  if v_leader.bidder_id is null then
    -- First bid.
    v_leader_id := v_uid;
    v_leader_max := p_max_amount;
    v_price := v_listing.start_price;
  elsif p_max_amount > v_leader.max_amount then
    -- New leader. Record the old leader's automatic bid at their maximum.
    if v_leader.max_amount > v_listing.current_price then
      insert into bids (listing_id, bidder_id, amount, is_automatic)
      values (p_listing_id, v_leader.bidder_id, v_leader.max_amount, true);
      v_new_bids := v_new_bids + 1;
    end if;
    v_leader_id := v_uid;
    v_leader_max := p_max_amount;
    v_price := least(p_max_amount, v_leader.max_amount + bid_increment(v_leader.max_amount));
  else
    -- The leader keeps the lead (ties go to the earlier maximum).
    insert into bids (listing_id, bidder_id, amount, is_automatic)
    values (p_listing_id, v_uid, p_max_amount, false);
    v_new_bids := v_new_bids + 1;
    v_leader_id := v_leader.bidder_id;
    v_leader_max := v_leader.max_amount;
    v_price := least(v_leader.max_amount, p_max_amount + bid_increment(p_max_amount));
  end if;

  -- Jump to the reserve when the leader's maximum covers it.
  if v_reserve is not null and v_price < v_reserve and v_leader_max >= v_reserve then
    v_price := v_reserve;
  end if;

  insert into bids (listing_id, bidder_id, amount, is_automatic)
  values (p_listing_id, v_leader_id, v_price, v_leader_id <> v_uid);
  v_new_bids := v_new_bids + 1;

  update listings
  set current_price = v_price,
      bid_count = bid_count + v_new_bids,
      highest_bidder_id = v_leader_id,
      reserve_met = (v_reserve is null or v_price >= v_reserve),
      ends_at = case when ends_at - now() < v_ext then now() + v_ext else ends_at end,
      updated_at = now()
  where id = p_listing_id
  returning * into v_listing;

  return (v_listing.current_price, v_listing.bid_count, v_listing.ends_at,
            v_listing.reserve_met, v_listing.highest_bidder_id = v_uid)::bid_result;
end;
$$;

-- Admin-approved bid retraction is a correction, not an edit: the bid rows
-- stay, a retraction row records it, and the auction is recomputed by staff.
create table bid_retractions (
  id bigint generated always as identity primary key,
  listing_id uuid not null references listings (id),
  bidder_id uuid not null references profiles (id),
  reason text not null,
  approved_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

alter table bid_retractions enable row level security;
create policy "bidder and staff read retractions" on bid_retractions
  for select using (bidder_id = (select auth.uid()) or (select is_staff()));

-- A frozen copy of what was sold, kept on the order as evidence for claims.
create function listing_snapshot(p_listing_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'title', l.title,
    'description', l.description,
    'condition', l.condition,
    'category_id', l.category_id,
    'format', l.format,
    'attributes', coalesce((
      select jsonb_object_agg(a.key, coalesce(to_jsonb(v.value_text), to_jsonb(v.value_number), to_jsonb(v.value_boolean)))
      from listing_attributes v join category_attributes a on a.id = v.attribute_id
      where v.listing_id = l.id), '{}'::jsonb),
    'images', coalesce((
      select jsonb_agg(i.storage_path order by i.sort_order)
      from listing_images i where i.listing_id = l.id), '[]'::jsonb),
    'taken_at', now()
  )
  from listings l where l.id = p_listing_id;
$$;

-- Buy now: fixed-price listings, or an auction's Buy It Now while no bid has
-- been placed (or while the reserve is not yet met).
create function buy_now(
  p_listing_id uuid,
  p_address_id uuid,
  p_payment_method payment_method default 'cod',
  p_quantity integer default 1
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_listing listings;
  v_profile profiles;
  v_address addresses;
  v_fee record;
  v_order orders;
  v_shipping bigint;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  select * into v_profile from profiles where id = v_uid;
  if v_profile.verification_status <> 'approved' then
    raise exception 'identity_not_verified';
  end if;
  if v_profile.bidding_blocked_at is not null or is_restricted(v_uid, 'buying') then
    raise exception 'buying_blocked';
  end if;
  if p_quantity < 1 then
    raise exception 'bad_quantity';
  end if;

  select * into v_address from addresses where id = p_address_id and user_id = v_uid;
  if not found then
    raise exception 'address_not_found';
  end if;

  select * into v_listing from listings where id = p_listing_id for update;
  if not found or v_listing.status <> 'active' or v_listing.buy_now_price is null
     or v_listing.starts_at > now() or v_listing.format = 'classified' then
    raise exception 'not_available_to_buy_now';
  end if;
  if v_listing.format = 'auction'
     and (v_listing.ends_at <= now()
          or (v_listing.bid_count > 0 and not (v_listing.has_reserve and not v_listing.reserve_met))) then
    raise exception 'buy_now_no_longer_available';
  end if;
  if v_listing.ends_at is not null and v_listing.ends_at <= now() then
    raise exception 'listing_ended';
  end if;
  if v_listing.seller_id = v_uid then
    raise exception 'cannot_buy_own_listing';
  end if;
  if v_listing.requires_deposit and not exists (
    select 1 from deposits d
    where d.listing_id = p_listing_id and d.user_id = v_uid and d.status = 'held'
  ) then
    raise exception 'deposit_required' using detail = v_listing.deposit_amount::text;
  end if;
  if v_listing.quantity - v_listing.quantity_sold < p_quantity then
    raise exception 'not_enough_quantity';
  end if;

  select coalesce(min(cost), 0) into v_shipping
  from listing_shipping_options where listing_id = p_listing_id and not is_local_pickup;

  select * into v_fee from commission_for(v_listing.category_id, v_listing.currency,
                                          v_listing.buy_now_price * p_quantity);

  insert into orders (
    listing_id, buyer_id, seller_id, kind, amount, quantity, unit_price, shipping_amount,
    commission_bps, commission_amount, commission_vat_amount, currency, payment_method, status,
    shipping_name, shipping_phone, shipping_address, shipping_city, shipping_governorate_id,
    confirm_by, item_snapshot
  ) values (
    p_listing_id, v_uid, v_listing.seller_id, 'buy_now', v_listing.buy_now_price * p_quantity,
    p_quantity, v_listing.buy_now_price, v_shipping,
    coalesce(v_fee.rate_bps, 800), coalesce(v_fee.fee, 0),
    (coalesce(v_fee.fee, 0) * setting_int('vat_bps', 1400) + 5000) / 10000,
    v_listing.currency, p_payment_method, 'pending',
    v_address.recipient_name, v_address.phone, v_address.street_address, v_address.city,
    v_address.governorate_id,
    now() + make_interval(hours => setting_int('win_confirmation_hours', 12)::int),
    listing_snapshot(p_listing_id)
  )
  returning * into v_order;

  update listings
  set quantity_sold = quantity_sold + p_quantity,
      status = case when quantity_sold + p_quantity >= quantity then 'sold'::listing_status else status end,
      updated_at = now()
  where id = p_listing_id;

  return v_order;
end;
$$;

-- Close one auction after its end time. Idempotent: safe to call from a cron
-- job every minute. Returns the new order id, or null when nothing sold.
create function close_auction(p_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing listings;
  v_fee record;
  v_order orders;
begin
  select * into v_listing from listings where id = p_listing_id for update;
  if not found or v_listing.format <> 'auction' or v_listing.status <> 'active'
     or v_listing.ends_at > now() then
    return null;
  end if;

  if v_listing.bid_count = 0 or not v_listing.reserve_met then
    update listings set status = 'ended', updated_at = now() where id = p_listing_id;
    return null;
  end if;

  select * into v_fee from commission_for(v_listing.category_id, v_listing.currency, v_listing.current_price);

  insert into orders (
    listing_id, buyer_id, seller_id, kind, amount, quantity, unit_price,
    commission_bps, commission_amount, commission_vat_amount, currency, payment_method, status, confirm_by,
    item_snapshot
  ) values (
    p_listing_id, v_listing.highest_bidder_id, v_listing.seller_id, 'auction', v_listing.current_price,
    1, v_listing.current_price, coalesce(v_fee.rate_bps, 800), coalesce(v_fee.fee, 0),
    (coalesce(v_fee.fee, 0) * setting_int('vat_bps', 1400) + 5000) / 10000,
    v_listing.currency, 'cod', 'pending',
    now() + make_interval(hours => setting_int('win_confirmation_hours', 12)::int),
    listing_snapshot(p_listing_id)
  )
  returning * into v_order;

  update listings set status = 'reserved', updated_at = now() where id = p_listing_id;
  return v_order.id;
end;
$$;

-- ===========================================================================
-- 8. Best Offer
-- ===========================================================================
create type offer_party as enum ('buyer', 'seller');

create table offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id),
  buyer_id uuid not null references profiles (id),
  seller_id uuid not null references profiles (id),
  made_by offer_party not null,
  amount bigint not null check (amount > 0),
  quantity integer not null default 1 check (quantity > 0),
  message text check (char_length(message) <= 500),
  status offer_status not null default 'pending',
  counter_of uuid references offers (id),
  order_id uuid references orders (id),
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  check (buyer_id <> seller_id)
);

create index offers_listing_idx on offers (listing_id, status);
create index offers_buyer_idx on offers (buyer_id, created_at desc);
create index offers_seller_open_idx on offers (seller_id, expires_at) where status = 'pending';
create unique index offers_one_open_per_buyer on offers (listing_id, buyer_id) where status = 'pending';

alter table listings add column accepts_offers boolean not null default false;
grant insert (accepts_offers), update (accepts_offers) on listings to authenticated;
grant select (accepts_offers) on listings to anon, authenticated;

-- A buyer makes an offer. Enforces the per-buyer limit and the seller's
-- automatic accept and decline thresholds (accept still needs the seller's
-- confirmation step in app code to create the order).
create function make_offer(p_listing_id uuid, p_amount bigint, p_message text default null)
returns offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_listing listings;
  v_private listing_private;
  v_offer offers;
  v_status offer_status := 'pending';
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  if not exists (select 1 from profiles where id = v_uid and verification_status = 'approved') then
    raise exception 'identity_not_verified';
  end if;
  if is_restricted(v_uid, 'buying')
     or exists (select 1 from profiles where id = v_uid and bidding_blocked_at is not null) then
    raise exception 'buying_blocked';
  end if;
  select * into v_listing from listings where id = p_listing_id for update;
  if not found or v_listing.status <> 'active' or not v_listing.accepts_offers
     or v_listing.buy_now_price is null or (v_listing.format = 'auction' and v_listing.bid_count > 0) then
    raise exception 'offers_not_accepted';
  end if;
  if v_listing.seller_id = v_uid then
    raise exception 'cannot_offer_on_own_listing';
  end if;
  if p_amount >= v_listing.buy_now_price then
    raise exception 'offer_at_or_above_price_use_buy_now';
  end if;
  if (select count(*) from offers
      where listing_id = p_listing_id and buyer_id = v_uid and made_by = 'buyer')
     >= setting_int('max_offers_per_buyer', 3) then
    raise exception 'offer_limit_reached';
  end if;

  select * into v_private from listing_private where listing_id = p_listing_id;
  if v_private.offer_auto_decline is not null and p_amount < v_private.offer_auto_decline then
    v_status := 'declined';
  end if;

  insert into offers (listing_id, buyer_id, seller_id, made_by, amount, message, status,
                      expires_at, responded_at)
  values (p_listing_id, v_uid, v_listing.seller_id, 'buyer', p_amount, p_message, v_status,
          least(coalesce(v_listing.ends_at, 'infinity'),
                now() + make_interval(hours => setting_int('offer_hours', 24)::int)),
          case when v_status = 'declined' then now() end)
  returning * into v_offer;

  return v_offer;
end;
$$;

alter table offers enable row level security;
create policy "buyer and seller read offers" on offers
  for select using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()) or (select is_staff()));

-- ===========================================================================
-- 9. Orders: money breakdown, payment status, state machine
-- ===========================================================================
create type order_payment_status as enum (
  'unpaid', 'cod_pending', 'paid', 'partially_refunded', 'refunded', 'failed'
);

alter table orders
  drop column commission_rate,
  add column quantity integer not null default 1 check (quantity > 0),
  add column unit_price bigint check (unit_price >= 0),
  add column shipping_amount bigint not null default 0 check (shipping_amount >= 0),
  add column discount_amount bigint not null default 0 check (discount_amount >= 0),
  add column total_amount bigint generated always as (amount + shipping_amount - discount_amount) stored,
  add column commission_bps integer not null default 800 check (commission_bps between 0 and 5000),
  add column commission_amount bigint not null default 0 check (commission_amount >= 0),
  add column commission_vat_amount bigint not null default 0 check (commission_vat_amount >= 0),
  add column payment_status order_payment_status not null default 'unpaid',
  add column shipping_governorate_id smallint references governorates (id),
  add column expected_delivery_at timestamptz,
  add column shipped_at timestamptz,
  add column completed_at timestamptz,
  add column cancelled_at timestamptz,
  add column funds_release_at timestamptz,
  add column item_snapshot jsonb,
  add column updated_at timestamptz not null default now(),
  add constraint discount_within_total check (discount_amount <= amount + shipping_amount),
  add constraint commission_within_amount check (commission_amount <= amount);

-- One live order per single-item listing. Multi-quantity Buy It Now listings
-- are protected by the row lock in buy_now().
drop index orders_one_live_order_per_listing;
create unique index orders_one_live_order_per_listing
  on orders (listing_id)
  where status not in ('cancelled', 'returned') and kind in ('auction', 'second_chance', 'swap');

create index orders_status_idx on orders (status, created_at);
create index orders_release_idx on orders (funds_release_at)
  where status = 'delivered' and funds_release_at is not null;

create table order_status_transitions (
  from_status order_status not null,
  to_status order_status not null,
  primary key (from_status, to_status)
);

insert into order_status_transitions (from_status, to_status) values
  ('pending', 'confirmed'), ('pending', 'cancelled'),
  ('confirmed', 'shipped'), ('confirmed', 'cancelled'),
  ('shipped', 'delivered'), ('shipped', 'returned'),
  ('delivered', 'completed'), ('delivered', 'returned'),
  ('completed', 'returned');

alter table order_status_transitions enable row level security;
create policy "order transitions are public" on order_status_transitions for select using (true);

-- Rejects a status jump the table does not allow, stamps the time columns,
-- and writes the history row.
create function order_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if not exists (
      select 1 from order_status_transitions
      where from_status = old.status and to_status = new.status
    ) then
      raise exception 'order_transition_not_allowed' using detail = old.status || ' -> ' || new.status;
    end if;

    new.confirmed_at := case when new.status = 'confirmed' then coalesce(new.confirmed_at, now()) else new.confirmed_at end;
    new.shipped_at := case when new.status = 'shipped' then coalesce(new.shipped_at, now()) else new.shipped_at end;
    new.delivered_at := case when new.status = 'delivered' then coalesce(new.delivered_at, now()) else new.delivered_at end;
    new.completed_at := case when new.status = 'completed' then coalesce(new.completed_at, now()) else new.completed_at end;
    new.cancelled_at := case when new.status = 'cancelled' then coalesce(new.cancelled_at, now()) else new.cancelled_at end;
    if new.status = 'delivered' then
      new.funds_release_at := now() + make_interval(days => setting_int('payout_release_days', 3)::int);
    end if;

    insert into order_events (order_id, status, note, actor_id)
    values (new.id, new.status, new.cancelled_reason, auth.uid());
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger orders_status_guard
  before update on orders
  for each row execute function order_status_guard();

create function order_created_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into order_events (order_id, status, note, actor_id)
  values (new.id, new.status, 'created', auth.uid());
  return new;
end;
$$;

create trigger orders_created_event
  after insert on orders
  for each row execute function order_created_event();

-- ===========================================================================
-- 10. Payments, refunds, webhooks, saved methods, payout methods
-- ===========================================================================
create type payment_provider as enum ('bosta_cod', 'instapay_manual', 'paymob', 'wallet');
create type payment_intent_status as enum (
  'created', 'requires_action', 'processing', 'succeeded', 'failed', 'cancelled', 'expired'
);
create type refund_status as enum ('pending', 'succeeded', 'failed');
create type payout_method_kind as enum ('instapay', 'bank_account', 'mobile_wallet');

-- One row per attempt to collect money. The idempotency key stops a double
-- click or a retried request from charging twice.
create table payment_intents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders (id),
  deposit_id uuid references deposits (id),
  payer_id uuid not null references profiles (id),
  provider payment_provider not null,
  method payment_method not null,
  amount bigint not null check (amount > 0),
  currency char(3) not null references currencies (code),
  status payment_intent_status not null default 'created',
  idempotency_key text not null unique,
  provider_reference text,
  payment_method_id uuid,
  failure_code text,
  failure_message text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  succeeded_at timestamptz,
  check (num_nonnulls(order_id, deposit_id) = 1)
);

create unique index payment_intents_provider_ref_idx on payment_intents (provider, provider_reference)
  where provider_reference is not null;
create index payment_intents_order_idx on payment_intents (order_id);
create index payment_intents_payer_idx on payment_intents (payer_id, created_at desc);
create index payment_intents_open_idx on payment_intents (created_at)
  where status in ('created', 'requires_action', 'processing');

create table refunds (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references payment_intents (id),
  case_id uuid,
  amount bigint not null check (amount > 0),
  currency char(3) not null references currencies (code),
  status refund_status not null default 'pending',
  reason text not null,
  idempotency_key text not null unique,
  provider_reference text,
  requested_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index refunds_intent_idx on refunds (payment_intent_id);

-- Every webhook body exactly as received, before it is processed. The unique
-- event id makes a retried webhook a no-op.
create table payment_webhook_events (
  id bigint generated always as identity primary key,
  provider payment_provider not null,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  signature_valid boolean not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  unique (provider, provider_event_id)
);

create index payment_webhook_events_unprocessed_idx on payment_webhook_events (received_at)
  where processed_at is null;

-- Saved cards. Only the gateway's token and display details are stored:
-- never the card number, never the CVV. The token column is not readable by
-- signed-in users at all (see grants below).
create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  provider payment_provider not null,
  provider_token text not null,
  brand text not null,
  last4 char(4) not null check (last4 ~ '^[0-9]{4}$'),
  exp_month smallint not null check (exp_month between 1 and 12),
  exp_year smallint not null check (exp_year between 2024 and 2100),
  fingerprint text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (provider, provider_token)
);

create index payment_methods_user_idx on payment_methods (user_id) where revoked_at is null;
create unique index payment_methods_one_default on payment_methods (user_id)
  where is_default and revoked_at is null;

alter table payment_intents add constraint payment_intents_method_fk
  foreign key (payment_method_id) references payment_methods (id);

-- Where a seller is paid. Account details are encrypted by server code
-- (Supabase Vault key); only a masked hint is stored in clear.
create table payout_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  kind payout_method_kind not null,
  display_hint text not null check (char_length(display_hint) <= 40),
  details_encrypted bytea not null,
  key_version smallint not null default 1,
  verified_at timestamptz,
  verified_by uuid references profiles (id),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index payout_methods_user_idx on payout_methods (user_id) where revoked_at is null;
create unique index payout_methods_one_default on payout_methods (user_id)
  where is_default and revoked_at is null;

alter table payouts
  add column payout_method_id uuid references payout_methods (id),
  add column idempotency_key text unique,
  add column approved_by uuid references profiles (id),
  add column approved_at timestamptz,
  add column failure_reason text;

alter table payment_intents enable row level security;
alter table refunds enable row level security;
alter table payment_webhook_events enable row level security;
alter table payment_methods enable row level security;
alter table payout_methods enable row level security;

create policy "payers read their payments" on payment_intents
  for select using (payer_id = (select auth.uid()) or (select has_role('finance')));
create policy "payers read their refunds" on refunds
  for select using (
    (select has_role('finance'))
    or exists (select 1 from payment_intents p where p.id = payment_intent_id and p.payer_id = (select auth.uid()))
  );
-- Webhook inbox: service role only (no policies), finance can read.
create policy "finance reads webhooks" on payment_webhook_events for select using ((select has_role('finance')));

create policy "users read their saved cards" on payment_methods
  for select using (user_id = (select auth.uid()));
create policy "users remove their saved cards" on payment_methods
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on payment_methods from anon, authenticated;
grant select (id, user_id, provider, brand, last4, exp_month, exp_year, is_default, created_at, revoked_at)
  on payment_methods to authenticated;
grant update (is_default, revoked_at) on payment_methods to authenticated;

create policy "users read their payout methods" on payout_methods
  for select using (user_id = (select auth.uid()) or (select has_role('finance')));
revoke all on payout_methods from anon, authenticated;
grant select (id, user_id, kind, display_hint, verified_at, is_default, created_at, revoked_at)
  on payout_methods to authenticated;

-- ===========================================================================
-- 11. Double-entry ledger
-- ===========================================================================
-- Sign: positive = debit, negative = credit. Every journal sums to zero.
-- Assets (cash, receivables) carry debit balances; what we owe people
-- (seller funds, wallets, deposits, refunds, VAT) and revenue carry credits.
create type ledger_account_kind as enum (
  'platform_cash',          -- asset: bank and InstaPay balance
  'gateway_clearing',       -- asset: card money the gateway owes us
  'courier_cod_receivable', -- asset: COD cash the courier owes us
  'commission_revenue',     -- revenue
  'vat_payable',            -- liability: VAT owed to the tax authority
  'buyer_refund_payable',   -- liability: refunds owed to a buyer
  'seller_pending',         -- liability: seller money still on hold
  'seller_available',       -- liability: seller money ready to pay out
  'payout_in_transit',      -- liability: payout sent, not yet confirmed
  'deposit_held',           -- liability: bidder deposits we hold
  'user_wallet',            -- liability: store credit (trade-ins, goodwill)
  'suspense'                -- anything unexplained, reviewed by finance
);

create table ledger_accounts (
  id bigint generated always as identity primary key,
  kind ledger_account_kind not null,
  user_id uuid references profiles (id),
  currency char(3) not null references currencies (code),
  created_at timestamptz not null default now(),
  unique nulls not distinct (kind, user_id, currency),
  check (
    (kind in ('buyer_refund_payable', 'seller_pending', 'seller_available', 'payout_in_transit',
              'deposit_held', 'user_wallet')) = (user_id is not null)
  )
);

create table journals (
  id bigint generated always as identity primary key,
  kind text not null check (kind ~ '^[a-z_]{3,40}$'),
  idempotency_key text not null unique,
  payload_hash text not null,
  order_id uuid references orders (id),
  payment_intent_id uuid references payment_intents (id),
  refund_id uuid references refunds (id),
  payout_id uuid references payouts (id),
  deposit_id uuid references deposits (id),
  memo text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index journals_order_idx on journals (order_id);
create index journals_payout_idx on journals (payout_id);

create table journal_lines (
  id bigint generated always as identity primary key,
  journal_id bigint not null references journals (id),
  account_id bigint not null references ledger_accounts (id),
  amount bigint not null check (amount <> 0),
  created_at timestamptz not null default now()
);

create index journal_lines_journal_idx on journal_lines (journal_id);
create index journal_lines_account_idx on journal_lines (account_id, created_at);

create trigger journals_append_only before update or delete on journals
  for each row execute function forbid_change();
create trigger journal_lines_append_only before update or delete on journal_lines
  for each row execute function forbid_change();

-- Checked at commit, so all lines of a journal can be inserted first. Runs as
-- owner: row level security must not hide lines from the sum.
create function journal_must_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_journal_id bigint := (to_jsonb(new) ->> case when tg_table_name = 'journals' then 'id' else 'journal_id' end)::bigint;
  v_sum numeric;
  v_lines integer;
  v_currencies integer;
begin
  select coalesce(sum(l.amount), 0), count(*), count(distinct a.currency)
  into v_sum, v_lines, v_currencies
  from journal_lines l
  join ledger_accounts a on a.id = l.account_id
  where l.journal_id = v_journal_id;

  if v_lines < 2 then
    raise exception 'journal_needs_two_lines' using detail = v_journal_id::text;
  end if;
  if v_sum <> 0 then
    raise exception 'journal_does_not_balance' using detail = v_journal_id::text || ': ' || v_sum;
  end if;
  if v_currencies <> 1 then
    raise exception 'journal_mixes_currencies' using detail = v_journal_id::text;
  end if;
  return null;
end;
$$;

create constraint trigger journal_lines_balance
  after insert on journal_lines
  deferrable initially deferred
  for each row execute function journal_must_balance();

-- A journal with no lines at all is also caught.
create constraint trigger journals_have_lines
  after insert on journals
  deferrable initially deferred
  for each row execute function journal_must_balance();

create function ledger_account(p_kind ledger_account_kind, p_user_id uuid, p_currency char(3))
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  select id into v_id from ledger_accounts
  where kind = p_kind and user_id is not distinct from p_user_id and currency = p_currency;
  if v_id is null then
    insert into ledger_accounts (kind, user_id, currency)
    values (p_kind, p_user_id, p_currency)
    on conflict (kind, user_id, currency) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from ledger_accounts
      where kind = p_kind and user_id is not distinct from p_user_id and currency = p_currency;
    end if;
  end if;
  return v_id;
end;
$$;

-- Post a balanced journal. p_lines = [{"kind": "...", "user_id": "...", "amount": 123}, ...].
-- Calling again with the same idempotency key returns the first journal.
create function post_journal(
  p_kind text,
  p_idempotency_key text,
  p_currency char(3),
  p_lines jsonb,
  p_order_id uuid default null,
  p_memo text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_journal_id bigint;
  v_line jsonb;
  v_hash text := md5(p_kind || '|' || p_currency || '|' || coalesce(p_order_id::text, '') || '|' || p_lines::text);
  v_existing_hash text;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'journal_needs_two_lines';
  end if;
  if (select sum((l ->> 'amount')::bigint) from jsonb_array_elements(p_lines) l) <> 0 then
    raise exception 'journal_does_not_balance';
  end if;

  -- Race-safe: two calls with one key both land here; one inserts, the other
  -- gets nothing back and reads the winner's row.
  insert into journals (kind, idempotency_key, payload_hash, order_id, memo, created_by)
  values (p_kind, p_idempotency_key, v_hash, p_order_id, p_memo, auth.uid())
  on conflict (idempotency_key) do nothing
  returning id into v_journal_id;

  if v_journal_id is null then
    select id, payload_hash into v_journal_id, v_existing_hash
    from journals where idempotency_key = p_idempotency_key;
    if v_existing_hash <> v_hash then
      raise exception 'idempotency_key_reused_with_different_payload';
    end if;
    return v_journal_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into journal_lines (journal_id, account_id, amount)
    values (
      v_journal_id,
      ledger_account((v_line ->> 'kind')::ledger_account_kind, (v_line ->> 'user_id')::uuid, p_currency),
      (v_line ->> 'amount')::bigint
    );
  end loop;

  return v_journal_id;
end;
$$;

create view ledger_balances
with (security_invoker = true) as
  select a.id as account_id, a.kind, a.user_id, a.currency,
         coalesce(sum(l.amount), 0)::bigint as balance
  from ledger_accounts a
  left join journal_lines l on l.account_id = a.id
  group by a.id;

alter table ledger_accounts enable row level security;
alter table journals enable row level security;
alter table journal_lines enable row level security;

create policy "users read their own accounts" on ledger_accounts
  for select using (user_id = (select auth.uid()) or (select has_role('finance')));
create policy "users read lines on their accounts" on journal_lines
  for select using (
    (select has_role('finance'))
    or exists (select 1 from ledger_accounts a where a.id = account_id and a.user_id = (select auth.uid()))
  );
create policy "users read journals that touch them" on journals
  for select using (
    (select has_role('finance'))
    or exists (
      select 1 from journal_lines l join ledger_accounts a on a.id = l.account_id
      where l.journal_id = journals.id and a.user_id = (select auth.uid())
    )
  );
grant select on ledger_balances to authenticated;

-- ===========================================================================
-- 12. Shipping events, returns and disputes
-- ===========================================================================
create type shipment_direction as enum ('to_buyer', 'return_to_seller', 'to_hub', 'from_hub');
create type case_type as enum ('not_received', 'not_as_described', 'return_request', 'cancellation');
create type case_status as enum (
  'open', 'awaiting_seller', 'awaiting_buyer', 'return_in_transit', 'escalated', 'resolved', 'closed'
);
create type case_resolution as enum (
  'full_refund', 'partial_refund', 'replacement', 'no_refund', 'withdrawn', 'cancelled_before_shipping'
);

alter table shipments
  add column direction shipment_direction not null default 'to_buyer',
  add column case_id uuid,
  add column label_url text,
  add column expected_delivery_at timestamptz,
  add column cod_collected_amount bigint check (cod_collected_amount >= 0),
  add column delivery_otp_required boolean not null default false,
  add column updated_at timestamptz not null default now();

create table shipment_events (
  id bigint generated always as identity primary key,
  shipment_id uuid not null references shipments (id),
  status shipment_status not null,
  provider_event_id text,
  description text,
  raw jsonb not null default '{}',
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique (shipment_id, provider_event_id)
);

create index shipment_events_shipment_idx on shipment_events (shipment_id, occurred_at);

create table cases (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id),
  type case_type not null,
  opened_by uuid not null references profiles (id),
  reason_code text not null,
  description text not null check (char_length(description) between 10 and 2000),
  status case_status not null default 'open',
  respond_by timestamptz not null,
  return_shipment_id uuid references shipments (id),
  requested_amount bigint check (requested_amount > 0),
  refund_amount bigint check (refund_amount >= 0),
  resolution case_resolution,
  decided_by uuid references profiles (id),
  resolved_at timestamptz,
  appeal_by timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status in ('resolved', 'closed')) = (resolution is not null))
);

create unique index cases_one_open_per_type on cases (order_id, type)
  where status not in ('resolved', 'closed');
create index cases_queue_idx on cases (status, respond_by);

alter table shipments add constraint shipments_case_fk foreign key (case_id) references cases (id);
alter table refunds add constraint refunds_case_fk foreign key (case_id) references cases (id);

create table case_events (
  id bigint generated always as identity primary key,
  case_id uuid not null references cases (id) on delete cascade,
  actor_id uuid references profiles (id),
  kind text not null default 'message',
  body text check (char_length(body) <= 2000),
  attachment_paths text[] not null default '{}' check (cardinality(attachment_paths) <= 10),
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index case_events_case_idx on case_events (case_id, created_at);

create trigger case_events_append_only before update or delete on case_events
  for each row execute function forbid_change();

-- The buyer opens a case inside the time window for its type.
create function open_case(p_order_id uuid, p_type case_type, p_reason_code text, p_description text)
returns cases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order orders;
  v_case cases;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  select * into v_order from orders where id = p_order_id for update;
  if not found or v_order.buyer_id <> v_uid then
    raise exception 'order_not_found';
  end if;

  if p_type = 'not_received' then
    if v_order.status <> 'shipped' or coalesce(v_order.expected_delivery_at, v_order.shipped_at + interval '7 days') > now() then
      raise exception 'too_early_to_report_not_received';
    end if;
    if coalesce(v_order.expected_delivery_at, v_order.shipped_at + interval '7 days')
       + make_interval(days => setting_int('case_not_received_days', 30)::int) < now() then
      raise exception 'case_window_closed';
    end if;
  elsif p_type in ('not_as_described', 'return_request') then
    if v_order.status not in ('delivered', 'completed') or v_order.delivered_at
       + make_interval(days => setting_int('case_not_as_described_days', 30)::int) < now() then
      raise exception 'case_window_closed';
    end if;
  elsif p_type = 'cancellation' and v_order.status not in ('pending', 'confirmed') then
    raise exception 'already_shipped';
  end if;

  insert into cases (order_id, type, opened_by, reason_code, description, status, respond_by)
  values (p_order_id, p_type, v_uid, p_reason_code, p_description, 'awaiting_seller',
          now() + make_interval(days => setting_int('case_seller_response_days', 3)::int))
  returning * into v_case;

  insert into case_events (case_id, actor_id, kind, body)
  values (v_case.id, v_uid, 'opened', p_description);

  return v_case;
end;
$$;

alter table shipment_events enable row level security;
alter table cases enable row level security;
alter table case_events enable row level security;

create policy "order parties read shipment events" on shipment_events
  for select using (
    (select is_staff()) or exists (
      select 1 from shipments s join orders o on o.id = s.order_id
      where s.id = shipment_id and (o.buyer_id = (select auth.uid()) or o.seller_id = (select auth.uid()))
    )
  );

create policy "order parties read cases" on cases
  for select using (
    (select is_staff()) or exists (
      select 1 from orders o where o.id = order_id
        and (o.buyer_id = (select auth.uid()) or o.seller_id = (select auth.uid()))
    )
  );
create policy "support works cases" on cases
  for update using ((select has_role('support'))) with check ((select has_role('support')));
-- Support moves the clock and the status by hand; a decision and its money
-- go through resolve_case() only.
revoke update on cases from anon, authenticated;
grant update (status, respond_by) on cases to authenticated;

insert into settings (key, value, description) values
  ('support_refund_limit', '500000', 'Largest refund (piastres) support may grant without finance');

create function resolve_case(
  p_case_id uuid,
  p_resolution case_resolution,
  p_refund_amount bigint default 0,
  p_note text default null
)
returns cases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case cases;
  v_order orders;
begin
  if not has_role('support') then
    raise exception 'support_only';
  end if;
  select * into v_case from cases where id = p_case_id for update;
  if not found or v_case.status in ('resolved', 'closed') then
    raise exception 'case_not_open';
  end if;
  select * into v_order from orders where id = v_case.order_id;
  if p_refund_amount < 0 or p_refund_amount > v_order.total_amount then
    raise exception 'refund_out_of_range';
  end if;
  if (p_refund_amount > 0) <> (p_resolution in ('full_refund', 'partial_refund')) then
    raise exception 'refund_does_not_match_resolution';
  end if;
  if p_refund_amount > setting_int('support_refund_limit', 500000) and not has_role('finance') then
    raise exception 'refund_needs_finance';
  end if;

  update cases
  set status = 'resolved', resolution = p_resolution, refund_amount = p_refund_amount,
      decided_by = auth.uid(), resolved_at = now(), appeal_by = now() + interval '30 days'
  where id = p_case_id
  returning * into v_case;

  insert into case_events (case_id, actor_id, kind, body)
  values (p_case_id, auth.uid(), 'decision', coalesce(p_note, p_resolution::text));

  return v_case;
end;
$$;

create policy "order parties read case messages" on case_events
  for select using (
    (select is_staff()) or (not is_internal and exists (
      select 1 from cases c join orders o on o.id = c.order_id
      where c.id = case_id and (o.buyer_id = (select auth.uid()) or o.seller_id = (select auth.uid()))
    ))
  );
revoke insert on case_events from anon, authenticated;
grant insert (case_id, actor_id, body, attachment_paths) on case_events to authenticated;

create policy "order parties add case messages" on case_events
  for insert with check (
    actor_id = (select auth.uid())
    and not is_internal
    and exists (
      select 1 from cases c join orders o on o.id = c.order_id
      where c.id = case_id and c.status not in ('resolved', 'closed')
        and (o.buyer_id = (select auth.uid()) or o.seller_id = (select auth.uid()))
    )
  );

-- ===========================================================================
-- 13. Feedback
-- ===========================================================================
create type feedback_direction as enum ('buyer_to_seller', 'seller_to_buyer');
create type feedback_rating as enum ('positive', 'neutral', 'negative');

create table feedback (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id),
  author_id uuid not null references profiles (id),
  recipient_id uuid not null references profiles (id),
  direction feedback_direction not null,
  rating feedback_rating not null,
  comment text check (char_length(comment) <= 500),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 5),
  is_automatic boolean not null default false,
  reply text check (char_length(reply) <= 500),
  replied_at timestamptz,
  removed_at timestamptz,
  removed_reason text,
  removed_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  unique (order_id, direction),
  check (author_id <> recipient_id),
  -- Sellers can only leave positive feedback for buyers.
  check (direction = 'buyer_to_seller' or rating = 'positive')
);

create index feedback_recipient_idx on feedback (recipient_id, created_at desc) where removed_at is null;

create table seller_ratings (
  feedback_id uuid primary key references feedback (id) on delete cascade,
  item_as_described smallint not null check (item_as_described between 1 and 5),
  communication smallint not null check (communication between 1 and 5),
  shipping_time smallint not null check (shipping_time between 1 and 5),
  shipping_cost smallint not null check (shipping_cost between 1 and 5)
);

create view feedback_scores
with (security_barrier = true) as
  select recipient_id as user_id,
         count(*) filter (where rating = 'positive') as positive,
         count(*) filter (where rating = 'neutral') as neutral,
         count(*) filter (where rating = 'negative') as negative,
         count(*) filter (where rating = 'positive') - count(*) filter (where rating = 'negative') as score,
         round(100.0 * count(*) filter (where rating = 'positive')
               / nullif(count(*) filter (where rating <> 'neutral'), 0), 1) as positive_percent
  from feedback
  where removed_at is null
  group by recipient_id;
grant select on feedback_scores to anon, authenticated;

alter table feedback enable row level security;
alter table seller_ratings enable row level security;

revoke insert on feedback from anon, authenticated;
grant insert (order_id, author_id, recipient_id, direction, rating, comment, photo_paths)
  on feedback to authenticated;

create policy "feedback is public" on feedback for select using (removed_at is null or (select is_staff()));
create policy "order parties leave feedback in the window" on feedback
  for insert with check (
    author_id = (select auth.uid())
    and not is_automatic
    and removed_at is null
    and reply is null
    and exists (
      select 1 from orders o
      join profiles a on a.id = (select auth.uid())
      where o.id = order_id
        and o.status in ('delivered', 'completed')
        and o.delivered_at + make_interval(days => setting_int('feedback_window_days', 30)::int) > now()
        and a.created_at + make_interval(days => setting_int('feedback_min_account_age_days', 5)::int) <= now()
        and (
          (direction = 'buyer_to_seller' and o.buyer_id = author_id and o.seller_id = recipient_id)
          or (direction = 'seller_to_buyer' and o.seller_id = author_id and o.buyer_id = recipient_id)
        )
    )
  );
create policy "recipients reply once" on feedback
  for update using (recipient_id = (select auth.uid()) and reply is null)
  with check (recipient_id = (select auth.uid()));
revoke update on feedback from anon, authenticated;
grant update (reply, replied_at) on feedback to authenticated;

create policy "seller ratings are public" on seller_ratings for select using (true);
create policy "buyers rate with their feedback" on seller_ratings
  for insert with check (
    exists (select 1 from feedback f where f.id = feedback_id
            and f.author_id = (select auth.uid()) and f.direction = 'buyer_to_seller')
  );

-- ===========================================================================
-- 14. Watchlist, saved searches, follows
-- ===========================================================================
create type alert_frequency as enum ('off', 'instant', 'daily', 'weekly');

create table watchlist (
  user_id uuid not null references profiles (id) on delete cascade,
  listing_id uuid not null references listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create index watchlist_listing_idx on watchlist (listing_id);

create table saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  name text not null check (char_length(name) <= 80),
  query text not null default '',
  filters jsonb not null default '{}',
  alert_frequency alert_frequency not null default 'daily',
  last_alerted_at timestamptz,
  created_at timestamptz not null default now()
);

create index saved_searches_user_idx on saved_searches (user_id);
create index saved_searches_alert_idx on saved_searches (alert_frequency, last_alerted_at)
  where alert_frequency <> 'off';

create table follows (
  user_id uuid not null references profiles (id) on delete cascade,
  seller_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, seller_id),
  check (user_id <> seller_id)
);

create index follows_seller_idx on follows (seller_id);

-- Keeps listing_stats.watch_count in step with the watchlist.
create function watch_count_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into listing_stats (listing_id, watch_count) values (new.listing_id, 1)
    on conflict (listing_id) do update set watch_count = listing_stats.watch_count + 1;
  else
    update listing_stats set watch_count = greatest(watch_count - 1, 0)
    where listing_id = old.listing_id;
  end if;
  return null;
end;
$$;

create trigger watchlist_count after insert or delete on watchlist
  for each row execute function watch_count_sync();

alter table watchlist enable row level security;
alter table saved_searches enable row level security;
alter table follows enable row level security;

create policy "users manage their watchlist" on watchlist
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "users manage their saved searches" on saved_searches
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "users manage who they follow" on follows
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "sellers see their followers" on follows
  for select using (seller_id = (select auth.uid()));

-- ===========================================================================
-- 15. Messaging
-- ===========================================================================
create table conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references listings (id),
  order_id uuid references orders (id),
  buyer_id uuid not null references profiles (id),
  seller_id uuid not null references profiles (id),
  last_message_at timestamptz not null default now(),
  buyer_read_at timestamptz,
  seller_read_at timestamptz,
  created_at timestamptz not null default now(),
  check (buyer_id <> seller_id),
  check (listing_id is not null or order_id is not null)
);

create unique index conversations_one_per_listing_buyer on conversations (listing_id, buyer_id)
  where order_id is null;
create unique index conversations_one_per_order on conversations (order_id) where order_id is not null;
create index conversations_buyer_idx on conversations (buyer_id, last_message_at desc);
create index conversations_seller_idx on conversations (seller_id, last_message_at desc);

create table messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references conversations (id) on delete cascade,
  sender_id uuid not null references profiles (id),
  body text not null check (char_length(body) between 1 and 2000),
  attachment_paths text[] not null default '{}' check (cardinality(attachment_paths) <= 5),
  flagged_reason text,
  hidden_at timestamptz,
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on messages (conversation_id, created_at);

create function message_bump_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update conversations set last_message_at = new.created_at where id = new.conversation_id;
  return null;
end;
$$;

create trigger messages_bump after insert on messages
  for each row execute function message_bump_conversation();

alter table conversations enable row level security;
alter table messages enable row level security;

create policy "participants read conversations" on conversations
  for select using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()) or (select is_staff()));
create policy "buyers start conversations about live listings" on conversations
  for insert with check (
    buyer_id = (select auth.uid())
    and order_id is null
    and not is_restricted((select auth.uid()), 'messaging')
    and exists (select 1 from listings l where l.id = listing_id and l.seller_id = conversations.seller_id
                and l.status = 'active')
  );
create policy "participants mark conversations read" on conversations
  for update using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()))
  with check (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()));
revoke update on conversations from anon, authenticated;
grant update (buyer_read_at, seller_read_at) on conversations to authenticated;

create policy "participants read messages" on messages
  for select using (
    (select is_staff()) or (hidden_at is null and exists (
      select 1 from conversations c where c.id = conversation_id
        and (c.buyer_id = (select auth.uid()) or c.seller_id = (select auth.uid()))
    ))
  );
-- Clients write only the columns a person types; times and flags are server-set.
revoke insert on messages from anon, authenticated;
grant insert (conversation_id, sender_id, body, attachment_paths) on messages to authenticated;
revoke insert on conversations from anon, authenticated;
grant insert (listing_id, buyer_id, seller_id) on conversations to authenticated;

create policy "participants send messages" on messages
  for insert with check (
    sender_id = (select auth.uid())
    and flagged_reason is null
    and hidden_at is null
    and not is_restricted((select auth.uid()), 'messaging')
    and exists (
      select 1 from conversations c where c.id = conversation_id
        and (c.buyer_id = (select auth.uid()) or c.seller_id = (select auth.uid()))
    )
  );

-- ===========================================================================
-- 16. Reports (moderation queue)
-- ===========================================================================
create type report_target as enum ('listing', 'user', 'message', 'feedback');
create type report_status as enum ('open', 'actioned', 'dismissed');

create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles (id),
  target_type report_target not null,
  target_id text not null,
  reason text not null,
  details text check (char_length(details) <= 1000),
  status report_status not null default 'open',
  handled_by uuid references profiles (id),
  handled_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);

create index reports_queue_idx on reports (created_at) where status = 'open';
create index reports_target_idx on reports (target_type, target_id);
create unique index reports_one_open_per_reporter on reports (reporter_id, target_type, target_id)
  where status = 'open';

alter table reports enable row level security;
revoke insert on reports from anon, authenticated;
grant insert (reporter_id, target_type, target_id, reason, details) on reports to authenticated;
create policy "users file reports" on reports
  for insert with check (reporter_id = (select auth.uid()) and status = 'open' and handled_by is null);
create policy "reporters and moderators read reports" on reports
  for select using (reporter_id = (select auth.uid()) or (select has_role('moderator')));
create policy "moderators handle reports" on reports
  for update using ((select has_role('moderator'))) with check ((select has_role('moderator')));

-- ===========================================================================
-- 17. Notifications
-- ===========================================================================
create type notification_delivery as enum ('queued', 'sent', 'delivered', 'failed', 'skipped');

alter table notifications
  add column template text,
  add column delivery_status notification_delivery not null default 'queued',
  add column provider_message_id text,
  add column error text,
  add column dedupe_key text unique;

create index notifications_queue_idx on notifications (created_at) where delivery_status = 'queued';

create table notification_preferences (
  user_id uuid not null references profiles (id) on delete cascade,
  type text not null,
  channel notification_channel not null,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, type, channel)
);

alter table notification_preferences enable row level security;
create policy "users manage their notification settings" on notification_preferences
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ===========================================================================
-- 18. ID verification: HMAC, not a plain hash
-- ===========================================================================
-- A 14-digit Egyptian national ID encodes birth date and governorate, so a
-- plain SHA-256 can be reversed by trying every plausible number. Server code
-- computes HMAC-SHA256(secret key from Vault, normalised number) instead.
alter table identity_verifications rename column document_number_hash to document_number_hmac;
alter table identity_verifications
  add column hmac_key_version smallint not null default 1,
  add column provider text not null default 'manual',
  add column provider_reference text,
  add column images_purge_after timestamptz;
alter index identity_verifications_one_account_per_document rename to identity_verifications_one_account_per_id;

comment on column identity_verifications.document_number_hmac is
  'HMAC-SHA256 of the normalised document number with a server-held key. Never a plain hash.';
comment on column identity_verifications.images_purge_after is
  'When the ID photos are deleted from storage after review (data minimisation).';

create policy "kyc reviewers read submissions" on identity_verifications
  for select using ((select has_role('kyc_reviewer')));

-- ===========================================================================
-- 19. Audit and updated_at triggers
-- ===========================================================================
-- Writes one audit row per change to sensitive tables, without secrets.
create function audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  insert into audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'listing_id', v_row ->> 'user_id', v_row ->> 'key'),
    jsonb_build_object(
      'old', v_old - 'provider_token' - 'details_encrypted',
      'new', v_new - 'provider_token' - 'details_encrypted'
    )
  );
  return null;
end;
$$;

create trigger audit_listing_private after insert or update or delete on listing_private
  for each row execute function audit_row();
create trigger audit_staff_members after insert or update or delete on staff_members
  for each row execute function audit_row();
create trigger audit_account_restrictions after insert or update or delete on account_restrictions
  for each row execute function audit_row();
create trigger audit_settings after insert or update or delete on settings
  for each row execute function audit_row();
create trigger audit_fee_schedules after insert or update or delete on fee_schedules
  for each row execute function audit_row();
create trigger audit_payment_methods after insert or update or delete on payment_methods
  for each row execute function audit_row();
create trigger audit_payout_methods after insert or update or delete on payout_methods
  for each row execute function audit_row();
create trigger audit_payouts after insert or update on payouts
  for each row execute function audit_row();
create trigger audit_cases after update on cases
  for each row execute function audit_row();

create function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger listings_updated_at before update on listings
  for each row execute function set_updated_at();
create trigger seller_profiles_updated_at before update on seller_profiles
  for each row execute function set_updated_at();
create trigger payment_intents_updated_at before update on payment_intents
  for each row execute function set_updated_at();
create trigger shipments_updated_at before update on shipments
  for each row execute function set_updated_at();
create trigger cases_updated_at before update on cases
  for each row execute function set_updated_at();
create trigger listing_private_updated_at before update on listing_private
  for each row execute function set_updated_at();

-- ===========================================================================
-- Indexes on foreign keys and hot paths
-- ===========================================================================
create index cases_order_idx on cases (order_id);
create index journals_payment_intent_idx on journals (payment_intent_id);
create index journals_refund_idx on journals (refund_id);
create index journals_deposit_idx on journals (deposit_id);
create index payment_intents_deposit_idx on payment_intents (deposit_id);
create index refunds_case_idx on refunds (case_id);
create index offers_order_idx on offers (order_id);
create index offers_counter_idx on offers (counter_of);
create index feedback_author_idx on feedback (author_id);
create index listings_leader_idx on listings (highest_bidder_id) where status = 'active';
create index bids_listing_id_idx on bids (listing_id, id);
create index messages_sender_idx on messages (sender_id);
create index conversations_listing_idx on conversations (listing_id);
create index shipments_case_idx on shipments (case_id);

-- ===========================================================================
-- Function privileges
-- ===========================================================================
-- Supabase gives anon and authenticated EXECUTE directly, so strip every
-- function in the schema (including those from 0001 and 0002) and grant back
-- exactly what each role needs. Trigger functions need no grant.
revoke execute on all functions in schema public from public, anon, authenticated;

-- Used inside row level security policies, so every client role needs them.
grant execute on function is_admin() to anon, authenticated, service_role;
grant execute on function is_staff() to anon, authenticated, service_role;
grant execute on function has_role(staff_role) to anon, authenticated, service_role;
grant execute on function setting_int(text, bigint) to anon, authenticated, service_role;
grant execute on function is_restricted(uuid, restriction_kind) to anon, authenticated, service_role;

-- Read-only helpers for the app.
grant execute on function bid_increment(bigint) to anon, authenticated, service_role;
grant execute on function commission_for(smallint, char, bigint) to anon, authenticated, service_role;
grant execute on function am_i_winning(uuid) to authenticated;

-- Actions a signed-in person takes.
grant execute on function place_bid(uuid, bigint) to authenticated;
grant execute on function buy_now(uuid, uuid, payment_method, integer) to authenticated;
grant execute on function make_offer(uuid, bigint, text) to authenticated;
grant execute on function open_case(uuid, case_type, text, text) to authenticated;

-- Staff actions (each checks the role inside).
grant execute on function review_identity_verification(uuid, boolean, text) to authenticated;
grant execute on function unblock_user(uuid, text) to authenticated;
grant execute on function resolve_case(uuid, case_resolution, bigint, text) to authenticated;

-- Server code and scheduled jobs only.
grant execute on function close_auction(uuid) to service_role;
grant execute on function ledger_account(ledger_account_kind, uuid, char) to service_role;
grant execute on function post_journal(text, text, char, jsonb, uuid, text) to service_role;
grant execute on function record_trust_event(uuid, trust_event_type, uuid, text) to service_role;
grant execute on function listing_snapshot(uuid) to service_role;
