-- Souq Auctions: core schema (users, listings, bids, orders).
-- Money is stored in whole minor-free units of the listing currency (EGP at launch).

create extension if not exists pgcrypto;

create type listing_status as enum ('draft', 'active', 'sold', 'ended', 'cancelled');
create type listing_condition as enum ('new', 'like_new', 'good', 'fair', 'for_parts');
create type order_status as enum ('pending', 'confirmed', 'shipped', 'delivered', 'completed', 'returned', 'cancelled');
create type payment_method as enum ('cod', 'instapay', 'card');

-- One profile per auth user.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  phone text unique,
  city text,
  preferred_locale text not null default 'ar' check (preferred_locale in ('ar', 'en')),
  is_seller_approved boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table categories (
  id smallint generated always as identity primary key,
  slug text not null unique,
  name_ar text not null,
  name_en text not null,
  sort_order smallint not null default 0
);

insert into categories (slug, name_ar, name_en, sort_order) values
  ('phones', 'موبايلات', 'Phones', 1),
  ('electronics', 'إلكترونيات', 'Electronics', 2),
  ('home', 'المنزل', 'Home', 3),
  ('collectibles', 'مقتنيات', 'Collectibles', 4);

create table listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references profiles (id),
  category_id smallint not null references categories (id),
  title text not null check (char_length(title) between 3 and 120),
  description text not null default '',
  condition listing_condition not null,
  city text not null,
  country char(2) not null default 'EG',
  currency char(3) not null default 'EGP',
  -- Auction fields: null start_price means Buy Now only.
  start_price numeric(12, 2) check (start_price > 0),
  buy_now_price numeric(12, 2) check (buy_now_price > 0),
  current_price numeric(12, 2),
  bid_count integer not null default 0,
  highest_bidder_id uuid references profiles (id),
  ends_at timestamptz,
  status listing_status not null default 'draft',
  created_at timestamptz not null default now(),
  constraint has_a_price check (start_price is not null or buy_now_price is not null),
  constraint auction_has_end check (start_price is null or ends_at is not null),
  constraint buy_now_above_start check (
    start_price is null or buy_now_price is null or buy_now_price > start_price
  )
);

create index listings_browse_idx on listings (status, category_id, created_at desc);
create index listings_ending_idx on listings (ends_at) where status = 'active';
create index listings_seller_idx on listings (seller_id);

create table listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id) on delete cascade,
  storage_path text not null,
  sort_order smallint not null default 0
);

create index listing_images_listing_idx on listing_images (listing_id, sort_order);

create table bids (
  id bigint generated always as identity primary key,
  listing_id uuid not null references listings (id) on delete cascade,
  bidder_id uuid not null references profiles (id),
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index bids_listing_idx on bids (listing_id, amount desc);
create index bids_bidder_idx on bids (bidder_id, created_at desc);

create table orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null unique references listings (id),
  buyer_id uuid not null references profiles (id),
  seller_id uuid not null references profiles (id),
  amount numeric(12, 2) not null check (amount > 0),
  commission_rate numeric(5, 4) not null default 0.08,
  currency char(3) not null default 'EGP',
  payment_method payment_method not null default 'cod',
  status order_status not null default 'pending',
  shipping_name text,
  shipping_phone text,
  shipping_address text,
  shipping_city text,
  tracking_number text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create index orders_buyer_idx on orders (buyer_id, created_at desc);
create index orders_seller_idx on orders (seller_id, created_at desc);

-- Place a bid atomically. The row lock on the listing stops two bids racing,
-- and a bid in the last 2 minutes pushes the end time out by 2 minutes.
create function place_bid(p_listing_id uuid, p_amount numeric)
returns listings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing listings;
  v_min numeric;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
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

revoke all on function place_bid(uuid, numeric) from public;
grant execute on function place_bid(uuid, numeric) to authenticated;

-- Row level security: everyone can read public data, people can only change their own.
alter table profiles enable row level security;
alter table categories enable row level security;
alter table listings enable row level security;
alter table listing_images enable row level security;
alter table bids enable row level security;
alter table orders enable row level security;

-- Phone numbers are private, so other users read profiles through a narrow view.
create policy "own profile is readable" on profiles
  for select using (auth.uid() = id);
create policy "users create their own profile" on profiles
  for insert with check (auth.uid() = id and not is_admin and not is_seller_approved);
create policy "users update their own profile" on profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and is_admin = (select p.is_admin from profiles p where p.id = auth.uid())
    and is_seller_approved = (select p.is_seller_approved from profiles p where p.id = auth.uid())
  );

create view public_profiles
with (security_barrier = true) as
  select id, display_name, city, is_seller_approved, created_at from profiles;
grant select on public_profiles to anon, authenticated;

create policy "categories are public" on categories for select using (true);

create policy "live listings are public, drafts are private" on listings
  for select using (status <> 'draft' or seller_id = auth.uid());
create policy "approved sellers create listings" on listings
  for insert with check (
    seller_id = auth.uid()
    and bid_count = 0
    and highest_bidder_id is null
    and exists (select 1 from profiles p where p.id = auth.uid() and p.is_seller_approved)
  );
-- Sellers can edit only before the first bid; bids change listings through place_bid.
create policy "sellers edit listings without bids" on listings
  for update using (seller_id = auth.uid() and bid_count = 0)
  with check (seller_id = auth.uid() and bid_count = 0 and highest_bidder_id is null);

create policy "images follow their listing" on listing_images
  for select using (
    exists (
      select 1 from listings l
      where l.id = listing_id and (l.status <> 'draft' or l.seller_id = auth.uid())
    )
  );
create policy "sellers manage their images" on listing_images
  for all using (
    exists (select 1 from listings l where l.id = listing_id and l.seller_id = auth.uid())
  )
  with check (
    exists (select 1 from listings l where l.id = listing_id and l.seller_id = auth.uid())
  );

-- Bids are inserted only by place_bid, so there is no insert policy.
create policy "bids are public" on bids for select using (true);

-- Orders are created and updated by server code with the service role.
create policy "buyer and seller read their orders" on orders
  for select using (buyer_id = auth.uid() or seller_id = auth.uid());
