insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-0000000000b1'),('00000000-0000-0000-0000-0000000000c1');
insert into profiles (id, display_name) values ('00000000-0000-0000-0000-0000000000a1','Old seller'),('00000000-0000-0000-0000-0000000000b1','Old bidder B'),('00000000-0000-0000-0000-0000000000c1','Old bidder C');
insert into listings (id, seller_id, category_id, title, condition, city, start_price, buy_now_price, current_price, bid_count, highest_bidder_id, ends_at, status, reserve_price)
values ('55555555-5555-5555-5555-555555555555','00000000-0000-0000-0000-0000000000a1',1,'Legacy auction','good','Giza',500.00,2000.00,750.50,2,'00000000-0000-0000-0000-0000000000c1', now()+interval '1 day','active',700.00),
       ('66666666-6666-6666-6666-666666666666','00000000-0000-0000-0000-0000000000a1',1,'Legacy fixed','new','Giza',null,1234.56,null,0,null,null,'active',null);
insert into bids (listing_id, bidder_id, amount) values ('55555555-5555-5555-5555-555555555555','00000000-0000-0000-0000-0000000000b1',500.00),('55555555-5555-5555-5555-555555555555','00000000-0000-0000-0000-0000000000c1',750.50);
