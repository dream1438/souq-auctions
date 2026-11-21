-- Souq Mania: launch modules.
-- ID verification, Bid Guarantee (win confirmation, backup winner, strikes,
-- deposits), swaps, order history, money ledger, shipping, notifications, admin.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type verification_status as enum ('unverified', 'pending', 'approved', 'rejected');
create type id_document_type as enum ('national_id', 'passport');
create type order_kind as enum ('auction', 'buy_now', 'second_chance', 'swap');
create type offer_status as enum ('pending', 'accepted', 'declined', 'expired', 'cancelled');
create type swap_status as enum ('pending', 'accepted', 'declined', 'countered', 'expired', 'cancelled');
create type cash_direction as enum ('none', 'offerer_pays', 'owner_pays');
create type deposit_status as enum ('pending', 'held', 'released', 'forfeited');
create type trust_event_type as enum ('parcel_accepted', 'parcel_refused', 'win_unconfirmed');
create type ledger_entry_type as enum (
  'cash_collected', 'commission', 'seller_payout', 'refund',
  'deposit_held', 'deposit_released', 'deposit_forfeited', 'swap_fee', 'adjustment'
);
create type payout_status as enum ('pending', 'sent', 'failed');
create type shipment_status as enum (
  'pending', 'pickup_requested', 'picked_up', 'in_transit', 'delivered', 'refused', 'returned'
);
create type notification_channel as enum ('email', 'whatsapp', 'sms', 'in_app');

alter type listing_status add value if not exists 'reserved';

-- ---------------------------------------------------------------------------
-- Accounts: verification state, strikes, addresses
-- ---------------------------------------------------------------------------
alter table profiles
  add column verification_status verification_status not null default 'unverified',
  add column phone_verified_at timestamptz,
  add column parcels_accepted integer not null default 0,
  add column parcels_refused integer not null default 0,
  add column strikes smallint not null default 0,
  add column bidding_blocked_at timestamptz;

create function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from profiles p where p.id = auth.uid()), false);
$$;

-- Users may change only harmless profile fields. Everything else (admin flag,
-- verification, strikes, phone) changes through server code or the functions below.
drop policy "users update their own profile" on profiles;
create policy "users update their own profile" on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
revoke update on profiles from authenticated, anon;
grant update (display_name, city, preferred_locale) on profiles to authenticated;

drop policy "users create their own profile" on profiles;
create policy "users create their own profile" on profiles
  for insert with check (
    auth.uid() = id
    and not is_admin
    and not is_seller_approved
    and verification_status = 'unverified'
    and strikes = 0
    and parcels_accepted = 0
    and parcels_refused = 0
    and bidding_blocked_at is null
    and phone_verified_at is null
  );

create policy "admins read all profiles" on profiles
  for select using (is_admin());

drop view public_profiles;
create view public_profiles
with (security_barrier = true) as
  select
    id,
    display_name,
    city,
    verification_status = 'approved' as is_verified,
    parcels_accepted,
    created_at
  from profiles;
grant select on public_profiles to anon, authenticated;

-- One row per ID submission. Photos live in a private storage bucket; only the
-- paths are stored here. The document number is stored as a hash so the same ID
-- cannot open a second account, without keeping the number itself.
create table identity_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  document_type id_document_type not null default 'national_id',
  document_number_hash text not null,
  front_image_path text not null,
  back_image_path text,
  selfie_image_path text,
  status verification_status not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_by uuid references profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index identity_verifications_user_idx on identity_verifications (user_id, created_at desc);
create index identity_verifications_queue_idx on identity_verifications (created_at)
  where status = 'pending';
-- One approved account per document, and one open submission per user.
create unique index identity_verifications_one_account_per_document
  on identity_verifications (document_type, document_number_hash) where status = 'approved';
create unique index identity_verifications_one_pending_per_user
  on identity_verifications (user_id) where status = 'pending';

create table addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  label text,
  recipient_name text not null,
  phone text not null,
  country char(2) not null default 'EG',
  governorate text not null,
  city text not null,
  street_address text not null,
  notes text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index addresses_user_idx on addresses (user_id);
create unique index addresses_one_default_per_user on addresses (user_id) where is_default;

-- ---------------------------------------------------------------------------
-- Listings: category tree, reserve price, deposits, swaps
-- ---------------------------------------------------------------------------
alter table categories add column parent_id smallint references categories (id);

alter table listings
  add column reserve_price numeric(12, 2) check (reserve_price > 0),
  add column requires_deposit boolean not null default false,
  add column deposit_amount numeric(12, 2) check (deposit_amount > 0),
  add column accepts_swaps boolean not null default false,
  add constraint reserve_needs_auction check (reserve_price is null or start_price is not null),
  add constraint reserve_not_below_start check (reserve_price is null or reserve_price >= start_price),
  add constraint deposit_has_amount check (requires_deposit = (deposit_amount is not null)),
  -- Deposits are only for expensive items.
  add constraint deposit_only_on_high_value check (
    not requires_deposit or coalesce(start_price, buy_now_price) >= 10000
  );

-- Selling now needs an approved ID instead of the old seller flag.
drop policy "approved sellers create listings" on listings;
create policy "verified users create listings" on listings
  for insert with check (
    seller_id = auth.uid()
    and bid_count = 0
    and highest_bidder_id is null
    and current_price is null
    and status in ('draft', 'active')
    and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.verification_status = 'approved'
    )
  );

drop policy "sellers edit listings without bids" on listings;
create policy "sellers edit listings without bids" on listings
  for update using (
    seller_id = auth.uid() and bid_count = 0 and status in ('draft', 'active')
  )
  with check (
    seller_id = auth.uid()
    and bid_count = 0
    and highest_bidder_id is null
    and current_price is null
    and status in ('draft', 'active', 'cancelled')
  );

create policy "admins manage listings" on listings
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- Bid Guarantee: deposits, backup winner offers, strikes
-- ---------------------------------------------------------------------------
create table deposits (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id),
  user_id uuid not null references profiles (id),
  amount numeric(12, 2) not null check (amount > 0),
  currency char(3) not null default 'EGP',
  status deposit_status not null default 'pending',
  payment_reference text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (listing_id, user_id)
);

create index deposits_user_idx on deposits (user_id, created_at desc);

create table second_chance_offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id),
  bidder_id uuid not null references profiles (id),
  amount numeric(12, 2) not null check (amount > 0),
  status offer_status not null default 'pending',
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (listing_id, bidder_id)
);

create unique index second_chance_one_open_offer_per_listing
  on second_chance_offers (listing_id) where status = 'pending';
create index second_chance_bidder_idx on second_chance_offers (bidder_id, created_at desc);

create table trust_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (id),
  event_type trust_event_type not null,
  order_id uuid,
  note text,
  created_at timestamptz not null default now()
);

create index trust_events_user_idx on trust_events (user_id, created_at desc);

create table blocks_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (id),
  action text not null check (action in ('blocked', 'unblocked')),
  reason text not null,
  acted_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index blocks_log_user_idx on blocks_log (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Swaps
-- ---------------------------------------------------------------------------
create table swap_offers (
  id uuid primary key default gen_random_uuid(),
  target_listing_id uuid not null references listings (id),
  offerer_id uuid not null references profiles (id),
  cash_amount numeric(12, 2) not null default 0 check (cash_amount >= 0),
  cash_direction cash_direction not null default 'none',
  currency char(3) not null default 'EGP',
  message text check (char_length(message) <= 500),
  status swap_status not null default 'pending',
  counter_of uuid references swap_offers (id),
  expires_at timestamptz not null default now() + interval '48 hours',
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint cash_matches_direction check ((cash_direction = 'none') = (cash_amount = 0))
);

create index swap_offers_target_idx on swap_offers (target_listing_id, status);
create index swap_offers_offerer_idx on swap_offers (offerer_id, created_at desc);

create table swap_offer_items (
  swap_offer_id uuid not null references swap_offers (id) on delete cascade,
  listing_id uuid not null references listings (id),
  primary key (swap_offer_id, listing_id)
);

create index swap_offer_items_listing_idx on swap_offer_items (listing_id);

-- ---------------------------------------------------------------------------
-- Orders: kinds, confirmation clock, history
-- ---------------------------------------------------------------------------
alter table orders
  add column kind order_kind not null default 'auction',
  add column swap_offer_id uuid references swap_offers (id),
  add column confirm_by timestamptz,
  add column confirmed_at timestamptz,
  add column cancelled_reason text,
  add constraint swap_orders_link_an_offer check ((kind = 'swap') = (swap_offer_id is not null));

-- A swap order can carry no cash.
alter table orders drop constraint orders_amount_check;
alter table orders add constraint orders_amount_check check (amount >= 0);

-- A listing can have many failed orders but only one live one, so a backup
-- winner can get a fresh order after the first buyer drops out.
alter table orders drop constraint orders_listing_id_key;
create unique index orders_one_live_order_per_listing
  on orders (listing_id) where status not in ('cancelled', 'returned');
create index orders_listing_idx on orders (listing_id);
create index orders_awaiting_confirmation_idx on orders (confirm_by)
  where status = 'pending' and confirmed_at is null;

alter table trust_events
  add constraint trust_events_order_fk foreign key (order_id) references orders (id);

create table order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references orders (id) on delete cascade,
  status order_status not null,
  note text,
  actor_id uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index order_events_order_idx on order_events (order_id, created_at);

-- ---------------------------------------------------------------------------
-- Payments: append-only ledger, payouts
-- ---------------------------------------------------------------------------
create table payouts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references profiles (id),
  amount numeric(12, 2) not null check (amount > 0),
  currency char(3) not null default 'EGP',
  method text not null,
  reference text,
  status payout_status not null default 'pending',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index payouts_seller_idx on payouts (seller_id, created_at desc);

-- Positive amounts are money owed to the user, negative amounts are money taken.
-- Rows are never changed; a mistake is fixed with an 'adjustment' row.
create table ledger_entries (
  id bigint generated always as identity primary key,
  entry_type ledger_entry_type not null,
  user_id uuid references profiles (id),
  order_id uuid references orders (id),
  payout_id uuid references payouts (id),
  deposit_id uuid references deposits (id),
  amount numeric(12, 2) not null check (amount <> 0),
  currency char(3) not null default 'EGP',
  note text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index ledger_entries_user_idx on ledger_entries (user_id, created_at desc);
create index ledger_entries_order_idx on ledger_entries (order_id);

create function forbid_change()
returns trigger
language plpgsql
as $$
begin
  raise exception '% rows cannot be changed or deleted', tg_table_name;
end;
$$;

create trigger ledger_entries_append_only
  before update or delete on ledger_entries
  for each row execute function forbid_change();

create trigger bids_append_only
  before update or delete on bids
  for each row execute function forbid_change();

-- ---------------------------------------------------------------------------
-- Shipping, notifications, admin
-- ---------------------------------------------------------------------------
create table shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id),
  courier text not null default 'bosta',
  tracking_number text,
  status shipment_status not null default 'pending',
  cod_amount numeric(12, 2) not null default 0 check (cod_amount >= 0),
  delivery_attempts smallint not null default 0,
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create index shipments_order_idx on shipments (order_id);
create unique index shipments_tracking_idx on shipments (courier, tracking_number)
  where tracking_number is not null;

create table notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  type text not null,
  channel notification_channel not null,
  payload jsonb not null default '{}',
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on notifications (user_id, created_at desc);

create table settings (
  key text primary key,
  value jsonb not null,
  description text not null default '',
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

insert into settings (key, value, description) values
  ('commission_rate', '0.08', 'Share of the sale price kept on completed sales'),
  ('win_confirmation_hours', '12', 'Hours a winner has to confirm before the item goes to the backup winner'),
  ('second_chance_hours', '12', 'Hours a backup winner has to accept the offer'),
  ('return_window_days', '3', 'Days after delivery before the seller is paid'),
  ('strikes_before_block', '2', 'Refused parcels before a buyer is blocked from bidding'),
  ('deposit_min_item_price', '10000', 'Lowest item price on which a seller may require a deposit'),
  ('swap_offer_hours', '48', 'Hours before an unanswered swap offer expires');

create table audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles (id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index audit_log_entity_idx on audit_log (entity_type, entity_id);

create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function forbid_change();

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Admin approves or rejects an ID submission.
create function review_identity_verification(
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
  if not is_admin() then
    raise exception 'admin_only';
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

-- A new submission marks the profile as pending.
create function mark_profile_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles set verification_status = 'pending'
  where id = new.user_id and verification_status <> 'approved';
  return new;
end;
$$;

create trigger identity_verifications_mark_pending
  after insert on identity_verifications
  for each row execute function mark_profile_pending();

-- Record how a parcel ended for the buyer. Called by server code when the
-- courier reports delivery or refusal, or when a winner fails to confirm.
create function record_trust_event(
  p_user_id uuid,
  p_event trust_event_type,
  p_order_id uuid default null,
  p_note text default null
)
returns profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles;
  v_limit integer;
begin
  select (value #>> '{}')::integer into v_limit from settings where key = 'strikes_before_block';
  v_limit := coalesce(v_limit, 2);

  insert into trust_events (user_id, event_type, order_id, note)
  values (p_user_id, p_event, p_order_id, p_note);

  update profiles
  set parcels_accepted = parcels_accepted + (p_event = 'parcel_accepted')::integer,
      parcels_refused = parcels_refused + (p_event = 'parcel_refused')::integer,
      strikes = strikes + (p_event = 'parcel_refused')::integer
  where id = p_user_id
  returning * into v_profile;

  if not found then
    raise exception 'user_not_found';
  end if;

  if v_profile.strikes >= v_limit and v_profile.bidding_blocked_at is null then
    update profiles set bidding_blocked_at = now() where id = p_user_id
    returning * into v_profile;
    insert into blocks_log (user_id, action, reason)
    values (p_user_id, 'blocked', format('%s refused parcels', v_profile.strikes));
  end if;

  return v_profile;
end;
$$;

-- Admin lifts a block and clears the strikes.
create function unblock_user(p_user_id uuid, p_reason text)
returns profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles;
begin
  if not is_admin() then
    raise exception 'admin_only';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'unblock_needs_reason';
  end if;

  update profiles set bidding_blocked_at = null, strikes = 0 where id = p_user_id
  returning * into v_profile;
  if not found then
    raise exception 'user_not_found';
  end if;

  insert into blocks_log (user_id, action, reason, acted_by)
  values (p_user_id, 'unblocked', p_reason, auth.uid());

  return v_profile;
end;
$$;

-- Place a bid atomically. Replaces the first version with the Bid Guarantee
-- checks: approved ID, not blocked, and a held deposit where the seller asks for one.
create or replace function place_bid(p_listing_id uuid, p_amount numeric)
returns listings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing listings;
  v_profile profiles;
  v_min numeric;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;

  select * into v_profile from profiles where id = auth.uid();
  if not found then
    raise exception 'profile_not_found';
  end if;
  if v_profile.verification_status <> 'approved' then
    raise exception 'identity_not_verified';
  end if;
  if v_profile.bidding_blocked_at is not null then
    raise exception 'bidding_blocked';
  end if;

  select * into v_listing from listings where id = p_listing_id for update;

  if not found then
    raise exception 'listing_not_found';
  end if;
  if v_listing.status <> 'active' or v_listing.start_price is null then
    raise exception 'listing_not_open_for_bids';
  end if;
  if v_listing.ends_at <= now() then
    raise exception 'auction_ended';
  end if;
  if v_listing.seller_id = auth.uid() then
    raise exception 'cannot_bid_on_own_listing';
  end if;
  if v_listing.requires_deposit and not exists (
    select 1 from deposits d
    where d.listing_id = p_listing_id and d.user_id = auth.uid() and d.status = 'held'
  ) then
    raise exception 'deposit_required' using detail = v_listing.deposit_amount::text;
  end if;

  -- First bid must meet the start price; later bids must beat the current
  -- price by at least 1% (minimum 5).
  if v_listing.bid_count = 0 then
    v_min := v_listing.start_price;
  else
    v_min := v_listing.current_price + greatest(5, round(v_listing.current_price * 0.01));
  end if;
  if p_amount < v_min then
    raise exception 'bid_too_low' using detail = v_min::text;
  end if;

  insert into bids (listing_id, bidder_id, amount)
  values (p_listing_id, auth.uid(), p_amount);

  update listings
  set current_price = p_amount,
      bid_count = bid_count + 1,
      highest_bidder_id = auth.uid(),
      ends_at = case
        when ends_at - now() < interval '2 minutes' then now() + interval '2 minutes'
        else ends_at
      end
  where id = p_listing_id
  returning * into v_listing;

  return v_listing;
end;
$$;

revoke all on function is_admin() from public;
revoke all on function review_identity_verification(uuid, boolean, text) from public;
revoke all on function record_trust_event(uuid, trust_event_type, uuid, text) from public;
revoke all on function unblock_user(uuid, text) from public;
revoke all on function mark_profile_pending() from public;
grant execute on function is_admin() to anon, authenticated;
grant execute on function review_identity_verification(uuid, boolean, text) to authenticated;
grant execute on function unblock_user(uuid, text) to authenticated;
grant execute on function record_trust_event(uuid, trust_event_type, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table identity_verifications enable row level security;
alter table addresses enable row level security;
alter table deposits enable row level security;
alter table second_chance_offers enable row level security;
alter table trust_events enable row level security;
alter table blocks_log enable row level security;
alter table swap_offers enable row level security;
alter table swap_offer_items enable row level security;
alter table order_events enable row level security;
alter table payouts enable row level security;
alter table ledger_entries enable row level security;
alter table shipments enable row level security;
alter table notifications enable row level security;
alter table settings enable row level security;
alter table audit_log enable row level security;

-- ID submissions: the owner and admins only. Reviews go through the function.
create policy "users read their own submissions" on identity_verifications
  for select using (user_id = auth.uid() or is_admin());
create policy "users submit their own ID" on identity_verifications
  for insert with check (
    user_id = auth.uid()
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and rejection_reason is null
  );

create policy "users manage their own addresses" on addresses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Deposits, offers, payouts, ledger, shipments: read your own; written by server code.
create policy "users read their own deposits" on deposits
  for select using (user_id = auth.uid() or is_admin());

create policy "bidder and seller read backup offers" on second_chance_offers
  for select using (
    bidder_id = auth.uid()
    or is_admin()
    or exists (select 1 from listings l where l.id = listing_id and l.seller_id = auth.uid())
  );

create policy "users read their own trust events" on trust_events
  for select using (user_id = auth.uid() or is_admin());

create policy "users read their own blocks" on blocks_log
  for select using (user_id = auth.uid() or is_admin());

create policy "both sides read a swap offer" on swap_offers
  for select using (
    offerer_id = auth.uid()
    or is_admin()
    or exists (select 1 from listings l where l.id = target_listing_id and l.seller_id = auth.uid())
  );
create policy "verified users offer swaps" on swap_offers
  for insert with check (
    offerer_id = auth.uid()
    and status = 'pending'
    and responded_at is null
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.verification_status = 'approved'
        and p.bidding_blocked_at is null
    )
    and exists (
      select 1 from listings l
      where l.id = target_listing_id
        and l.status = 'active'
        and l.accepts_swaps
        and l.seller_id <> auth.uid()
    )
  );

create policy "both sides read swap items" on swap_offer_items
  for select using (
    exists (select 1 from swap_offers s where s.id = swap_offer_id)
  );
create policy "offerers add their own active listings" on swap_offer_items
  for insert with check (
    exists (
      select 1 from swap_offers s
      where s.id = swap_offer_id and s.offerer_id = auth.uid() and s.status = 'pending'
    )
    and exists (
      select 1 from listings l
      where l.id = listing_id and l.seller_id = auth.uid() and l.status = 'active'
    )
  );

create policy "admins read all orders" on orders
  for select using (is_admin());

create policy "buyer and seller read order history" on order_events
  for select using (
    is_admin()
    or exists (
      select 1 from orders o
      where o.id = order_id and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    )
  );

create policy "sellers read their own payouts" on payouts
  for select using (seller_id = auth.uid() or is_admin());

create policy "users read their own ledger" on ledger_entries
  for select using (user_id = auth.uid() or is_admin());

create policy "buyer and seller read shipments" on shipments
  for select using (
    is_admin()
    or exists (
      select 1 from orders o
      where o.id = order_id and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    )
  );

create policy "users read their own notifications" on notifications
  for select using (user_id = auth.uid());
create policy "users mark their notifications read" on notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on notifications from authenticated, anon;
grant update (read_at) on notifications to authenticated;

create policy "settings are public" on settings for select using (true);
create policy "admins change settings" on settings
  for all using (is_admin()) with check (is_admin());

create policy "admins read the audit log" on audit_log
  for select using (is_admin());
