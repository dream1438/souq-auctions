\set ON_ERROR_STOP 1
-- Users: seller S, bidders A, B, C, admin Z
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c'),('00000000-0000-0000-0000-000000000005'),('00000000-0000-0000-0000-00000000000f');
insert into profiles (id, display_name, verification_status, created_at) values
 ('00000000-0000-0000-0000-00000000000a','Ahmed','approved', now()-interval '10 days'),
 ('00000000-0000-0000-0000-00000000000b','Basma','approved', now()-interval '10 days'),
 ('00000000-0000-0000-0000-00000000000c','Carim','approved', now()-interval '10 days'),
 ('00000000-0000-0000-0000-000000000005','Seller','approved', now()-interval '10 days'),
 ('00000000-0000-0000-0000-00000000000f','Finance','approved', now()-interval '10 days');
insert into staff_members (user_id, role) values ('00000000-0000-0000-0000-00000000000f','finance');

-- Auction: start 1,000 EGP, reserve 3,000 EGP, BIN 5,000
insert into listings (id, seller_id, category_id, title, condition, city, format, start_price, buy_now_price, ends_at, status)
values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000005',1,'iPhone 14 Pro 256GB','good','Cairo','auction',100000,500000, now()+interval '3 days','active');
insert into listing_private (listing_id, reserve_price) values ('11111111-1111-1111-1111-111111111111', 300000);
select has_reserve, reserve_met from listings where id='11111111-1111-1111-1111-111111111111';

-- A bids max 1,500 → price 1,000 (start)
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select current_price, bid_count, reserve_met from place_bid('11111111-1111-1111-1111-111111111111', 150000);
-- B bids max 1,200 → A keeps lead, price = min(1500, 1200+10)=1,210
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
select current_price, bid_count, not is_leading as a_leads from place_bid('11111111-1111-1111-1111-111111111111', 120000);
-- B bids max 4,000 → B leads; price jumps to reserve 3,000 (1500+10=1510 < reserve, B max covers it)
select current_price, bid_count, reserve_met, is_leading as b_leads from place_bid('11111111-1111-1111-1111-111111111111', 400000);
-- C ties B at 4,000 → B keeps (earlier), price 4,000
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
select current_price, not is_leading as b_still_leads from place_bid('11111111-1111-1111-1111-111111111111', 400000);
-- bid too low
do $$ begin perform place_bid('11111111-1111-1111-1111-111111111111', 400500); raise exception 'should fail'; exception when others then if sqlerrm <> 'bid_too_low' then raise; end if; raise notice 'ok bid_too_low'; end $$;
-- reserve cannot be raised after bids
do $$ begin update listing_private set reserve_price = 350000 where listing_id='11111111-1111-1111-1111-111111111111'; raise exception 'should fail'; exception when others then raise notice 'reserve change blocked: %', sqlerrm; end $$;

-- RLS as authenticated user C
set role authenticated;
select count(*) as c_sees_reserve_rows from listing_private;  -- expect 0
select count(*) as c_sees_bid_rows from bids;                  -- only own
select count(*) as c_sees_auto_bids from auto_bids;            -- only own
select bidder_alias, amount, is_automatic, is_mine from bid_history order by id;
do $$ begin perform highest_bidder_id from listings limit 1; raise exception 'should fail'; exception when insufficient_privilege then raise notice 'ok highest_bidder hidden'; end $$;
select am_i_winning('11111111-1111-1111-1111-111111111111') as c_winning;
reset role;

-- Close the auction → order to B at 4,000 with 8% commission
update listings set starts_at = now() - interval '2 days', ends_at = now() - interval '1 second' where id='11111111-1111-1111-1111-111111111111';
select close_auction('11111111-1111-1111-1111-111111111111') is not null as order_made;
select amount, commission_bps, commission_amount, commission_vat_amount, total_amount, buyer_id = '00000000-0000-0000-0000-00000000000b' as b_buys, item_snapshot->>'title' as snap_title from orders where listing_id='11111111-1111-1111-1111-111111111111';
select close_auction('11111111-1111-1111-1111-111111111111') is null as idempotent;

-- Order transitions
update orders set status='confirmed' where listing_id='11111111-1111-1111-1111-111111111111';
do $$ begin update orders set status='completed' where listing_id='11111111-1111-1111-1111-111111111111'; raise exception 'should fail'; exception when others then raise notice 'transition blocked: %', sqlerrm; end $$;
update orders set status='shipped' where listing_id='11111111-1111-1111-1111-111111111111';
update orders set status='delivered' where listing_id='11111111-1111-1111-1111-111111111111';
select status, funds_release_at > now() as hold_set, (select count(*) from order_events e where e.order_id = o.id) as events from orders o where listing_id='11111111-1111-1111-1111-111111111111';

-- Ledger: COD collected 4,000 → courier receivable; seller pending 3,680; commission 320 less VAT handled by app
begin;
select post_journal('cod_sale_delivered','order-1-delivered','EGP',
  jsonb_build_array(
    jsonb_build_object('kind','courier_cod_receivable','amount',400000),
    jsonb_build_object('kind','seller_pending','user_id','00000000-0000-0000-0000-000000000005','amount',-368000),
    jsonb_build_object('kind','commission_revenue','amount',-28070),
    jsonb_build_object('kind','vat_payable','amount',-3930)));
commit;
select post_journal('cod_sale_delivered','order-1-delivered','EGP',
  jsonb_build_array(
    jsonb_build_object('kind','courier_cod_receivable','amount',400000),
    jsonb_build_object('kind','seller_pending','user_id','00000000-0000-0000-0000-000000000005','amount',-368000),
    jsonb_build_object('kind','commission_revenue','amount',-28070),
    jsonb_build_object('kind','vat_payable','amount',-3930))) as same_id_again;
-- Unbalanced journal must fail at commit
do $$ begin
  perform post_journal('bad','bad-1','EGP', jsonb_build_array(jsonb_build_object('kind','platform_cash','amount',100), jsonb_build_object('kind','suspense','amount',-99)));
  set constraints all immediate;
  raise exception 'should fail';
exception when others then raise notice 'unbalanced rejected: %', sqlerrm; end $$;
select kind, balance from ledger_balances order by kind;

-- Seller sees own pending balance only
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
set role authenticated;
select kind, balance from ledger_balances;
reset role;

-- Saved card token not readable
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
insert into payment_methods (user_id, provider, provider_token, brand, last4, exp_month, exp_year) values ('00000000-0000-0000-0000-00000000000a','paymob','tok_secret','visa','4242',12,2030);
set role authenticated;
select brand, last4 from payment_methods;
do $$ begin perform provider_token from payment_methods; raise exception 'should fail'; exception when insufficient_privilege then raise notice 'ok token hidden'; end $$;
reset role;

-- Buy now on fixed price, with address, then feedback rules
insert into addresses (id, user_id, recipient_name, phone, governorate, city, street_address) values ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-00000000000a','Ahmed','+201000000000','Cairo','Nasr City','1 St');
insert into listings (id, seller_id, category_id, title, condition, city, format, buy_now_price, quantity, status)
values ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000005',2,'AirPods Pro','new','Cairo','fixed_price',800000,2,'active');
insert into listing_shipping_options (listing_id, cost) values ('33333333-3333-3333-3333-333333333333', 6000);
select amount, shipping_amount, total_amount, commission_amount from buy_now('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222');
select quantity_sold, status from listings where id='33333333-3333-3333-3333-333333333333';
-- Search
select title from listings where search_vector @@ websearch_to_tsquery('english','iphone');
-- Seller can't give buyer negative feedback
do $$ begin insert into feedback (order_id, author_id, recipient_id, direction, rating) select id, seller_id, buyer_id, 'seller_to_buyer', 'negative' from orders limit 1; raise exception 'should fail'; exception when check_violation then raise notice 'ok seller negative blocked'; end $$;
-- Offer
update listings set accepts_offers = true where id='33333333-3333-3333-3333-333333333333';
insert into listing_private (listing_id, offer_auto_decline) values ('33333333-3333-3333-3333-333333333333', 600000);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
select status from make_offer('33333333-3333-3333-3333-333333333333', 500000);
select status from make_offer('33333333-3333-3333-3333-333333333333', 700000);
select count(*) as audit_rows from audit_log;

-- ===== Added after the senior DB review =====
-- Public view works for anon and hides private columns
set role anon;
select count(*) as anon_sees_listings from listings_public;
do $$ begin perform watch_count from listings limit 1; raise exception 'should fail'; exception when undefined_column then raise notice 'ok watch_count moved to listing_stats'; end $$;
reset role;
-- Money functions cannot be called by app users
set role authenticated;
do $$ begin perform post_journal('x','x-1','EGP','[]'::jsonb); raise exception 'should fail'; exception when insufficient_privilege then raise notice 'ok post_journal denied'; end $$;
do $$ begin perform close_auction('11111111-1111-1111-1111-111111111111'); raise exception 'should fail'; exception when insufficient_privilege then raise notice 'ok close_auction denied'; end $$;
do $$ begin perform record_trust_event('00000000-0000-0000-0000-00000000000a'::uuid, (enum_range(null::trust_event_type))[1], null::uuid, null::text); raise exception 'should fail'; exception when insufficient_privilege or undefined_function then raise notice 'ok record_trust_event denied'; end $$;
reset role;
set role anon;
do $$ begin perform place_bid('11111111-1111-1111-1111-111111111111', 999999); raise exception 'should fail'; exception when insufficient_privilege then raise notice 'ok anon cannot bid'; end $$;
reset role;
-- Idempotency key reused with a different payload is rejected
do $$ begin perform post_journal('cod_sale_delivered','order-1-delivered','EGP', jsonb_build_array(jsonb_build_object('kind','platform_cash','amount',1), jsonb_build_object('kind','suspense','amount',-1))); raise exception 'should fail'; exception when others then raise notice 'reuse rejected: %', sqlerrm; end $$;
-- Seller cannot edit a listing after a sale
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
set role authenticated;
update listings set title = 'Changed after sale' where id='33333333-3333-3333-3333-333333333333';
select title from listings_public where id='33333333-3333-3333-3333-333333333333';
reset role;
-- Lowering an unmet reserve re-runs the proxy up to the new reserve
insert into listings (id, seller_id, category_id, title, condition, city, format, start_price, ends_at, status)
values ('44444444-4444-4444-4444-444444444444','00000000-0000-0000-0000-000000000005',1,'Rolex Datejust','good','Cairo','auction',100000, now()+interval '3 days','active');
insert into listing_private (listing_id, reserve_price) values ('44444444-4444-4444-4444-444444444444', 500000);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select current_price, reserve_met from place_bid('44444444-4444-4444-4444-444444444444', 300000);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
select current_price, reserve_met from place_bid('44444444-4444-4444-4444-444444444444', 200000);
update listing_private set reserve_price = 250000 where listing_id='44444444-4444-4444-4444-444444444444';
select current_price, reserve_met from listings where id='44444444-4444-4444-4444-444444444444';

