// End-to-end check of listings, bidding, Bid Guarantee, Buy Now, orders, deposits and admin tools.
// Needs: the site running against a local database (see README), psql, and Playwright
// (npm i -D playwright && npx playwright install chromium).
//   E2E_BASE_URL       default http://localhost:3000
//   E2E_DATABASE_URL   default postgres://postgres@127.0.0.1:5432/souq_dev
// Only ever point this at a throwaway local database: it creates accounts and changes rows directly.
const { chromium } = require("playwright");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/souq_dev";
const ROOT = path.join(__dirname, "..");
const run = Date.now().toString(36);
const img = (name) => path.join(__dirname, "fixtures", name);
const shot = (name) => path.join(__dirname, "screenshots", name);
const sql = (text) =>
  execFileSync("psql", [DATABASE_URL, "-X", "-q", "-A", "-t", "-c", text]).toString().trim();
const results = [];
const check = (name, ok, extra = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !extra ? "" : "  [" + extra + "]"}`);
};
const submit = 'main button[type="submit"]';
const alertText = async (page) => (await page.locator('main p[role="alert"], main p[role="status"]').first().textContent({ timeout: 8000 }).catch(() => "")) || "";

// Pages stream their data in, so wait until the loading placeholder is gone before reading the page.
function settle(page) {
  const original = page.goto.bind(page);
  page.goto = async (url, options) => {
    const response = await original(url, options);
    await page
      .waitForFunction(() => {
        const main = document.querySelector("main");
        return main && !main.querySelector('[aria-busy="true"]') && main.textContent.trim().length > 0;
      }, null, { timeout: 20000 })
      .catch(() => {});
    return response;
  };
  return page;
}

async function signUp(browser, who) {
  const context = await browser.newContext();
  const page = settle(await context.newPage());
  const email = `${who}-${run}@example.test`;
  await page.goto(`${BASE}/en/sign-up`);
  await page.fill("#email", email);
  await page.fill("#password", "correct horse battery");
  await page.fill("#display_name", who);
  await page.fill("#phone", "0111" + String(Math.floor(1000000 + Math.random() * 8999999)));
  await page.check('input[name="terms"]');
  await page.click(submit);
  await page.waitForURL("**/account/verify", { timeout: 20000 });
  const id = sql(`select id from auth.users where email='${email}'`);
  return { page, email, id, who };
}

async function fillAddress(page, name) {
  await page.check('input[name="address_id"][value="new"]');
  await page.fill("#recipient_name", name);
  await page.fill("#address_phone", "01012345678");
  await page.selectOption("#governorate_id", { index: 1 });
  await page.fill("#city", "Nasr City");
  await page.fill("#street_address", "12 Test Street, floor 3");
}

async function createListing(seller, o) {
  const page = seller.page;
  await page.goto(`${BASE}/en/sell`);
  await page.fill("#title", o.title);
  await page.fill("#description", "Clean, with box and charger.");
  await page.setInputFiles("#file-photos", [img("item1.png"), img("item2.png")]);
  await page.waitForTimeout(600);
  if (o.fixed) {
    await page.check('input[name="format"][value="fixed"]');
    await page.fill("#buy_now_price", String(o.fixed));
    if (o.quantity) await page.fill("#quantity", String(o.quantity));
  } else {
    await page.fill("#start_price", String(o.start));
    if (o.reserve) await page.fill("#reserve_price", String(o.reserve));
    await page.selectOption("#days", "1");
  }
  await page.fill("#city", "Cairo");
  await page.fill("#delivery_cost", String(o.delivery ?? 0));
  if (o.deposit) {
    await page.check('input[name="requires_deposit"]');
    await page.fill("#deposit_amount", String(o.deposit));
  }
  await page.click(submit);
  await page.waitForURL(/\/listings\/[0-9a-f-]{36}$/, { timeout: 20000 }).catch(async () => {
    throw new Error("listing was not created: " + (await alertText(page)));
  });
  return page.url().split("/").pop();
}

async function bid(user, listingId, amount) {
  await user.page.goto(`${BASE}/en/listings/${listingId}`);
  await user.page.fill("#amount", String(amount));
  await user.page.click(submit);
  return alertText(user.page);
}

async function staffStep(admin, orderId, label) {
  await admin.page.goto(`${BASE}/en/admin/orders`);
  const row = admin.page.locator("tr", { has: admin.page.locator(`a[href$="${orderId}"]`) });
  await row.locator("button", { hasText: label }).click();
  await admin.page.waitForTimeout(1500);
}

(async () => {
  const browser = await chromium.launch();
  try {
    const seller = await signUp(browser, "seller");
    const alice = await signUp(browser, "alice");
    const bob = await signUp(browser, "bob");
    const admin = await signUp(browser, "boss");
    const anon = settle(await (await browser.newContext()).newPage());

    // Selling needs a verified identity.
    await seller.page.goto(`${BASE}/en/sell`);
    check("unverified member cannot open the sell form", (await seller.page.textContent("main")).includes("Verify your identity to start selling"));
    sql(`update profiles set verification_status='approved' where id in ('${seller.id}','${alice.id}','${bob.id}','${admin.id}')`);
    sql(`insert into staff_members (user_id, role) values ('${admin.id}','admin')`);

    // --- Auction with a reserve ------------------------------------------------
    const title = `Camera ${run}`;
    const auction = await createListing(seller, { title, start: 1000, reserve: 1500, delivery: 50 });
    check("auction created with photos, reserve and delivery cost",
      sql(`select status||'|'||(select count(*) from listing_images where listing_id=l.id)||'|'||(select reserve_price from listing_private where listing_id=l.id)||'|'||(select cost from listing_shipping_options where listing_id=l.id)||'|'||has_reserve from listings l where id='${auction}'`) === "active|2|150000|5000|true");

    await anon.goto(`${BASE}/en/listings?q=${encodeURIComponent(title)}`);
    check("signed-out visitor finds it by search", (await anon.textContent("main")).includes(title));
    await anon.goto(`${BASE}/en/listings/${auction}`);
    const anonText = await anon.textContent("main");
    check("signed-out visitor sees the listing and a sign-in prompt", anonText.includes("Sign in to bid") && anonText.includes("Bid Guarantee"));
    check("reserve amount is not shown", !anonText.includes("1,500"));
    const image = await anon.request.get(`${BASE}${await anon.locator("main img").first().getAttribute("src")}`);
    check("listing photo is served", image.status() === 200);

    await seller.page.goto(`${BASE}/en/listings/${auction}`);
    check("seller gets no bid form on their own listing", (await seller.page.locator("#amount").count()) === 0);

    check("low bid is refused with the minimum", (await bid(alice, auction, 900)).includes("at least 1,000"));
    check("alice bids 1,600 and leads", (await bid(alice, auction, 1600)).includes("highest bidder"));
    check("price jumps to the reserve", sql(`select current_price||'|'||reserve_met from listings where id='${auction}'`) === "150000|true");
    check("bob bids 1,550 and is told he is outbid", (await bid(bob, auction, 1550)).includes("another bidder"));
    check("proxy bidding raised the price for alice", sql(`select current_price||'|'||(highest_bidder_id='${alice.id}') from listings where id='${auction}'`) === "157500|true");
    check("bob bids 2,000 and leads", (await bid(bob, auction, 2000)).includes("highest bidder"));
    check("price is one step above alice's maximum", sql(`select current_price from listings where id='${auction}'`) === "162500");
    check("alice has an outbid message queued", sql(`select count(*) from notifications where user_id='${alice.id}' and type='outbid'`) === "1");
    await alice.page.goto(`${BASE}/en/account/bids`);
    check("my bids page shows outbid", (await alice.page.textContent("main")).includes("You have been outbid"));
    await anon.goto(`${BASE}/en/listings/${auction}`);
    const history = await anon.textContent("main");
    check("bid history hides bidder names", history.includes("***") && !history.includes("alice") && !history.includes("bob"));

    // --- Auction ends, winner does not confirm, backup winner takes it ----------
    sql(`update listings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 minute' where id='${auction}'`);
    await bob.page.goto(`${BASE}/en/account/orders`);
    const bobOrder = sql(`select id from orders where listing_id='${auction}' and buyer_id='${bob.id}'`);
    check("closing creates a pending order for the winner", sql(`select status||'|'||kind||'|'||amount from orders where id='${bobOrder}'`) === "pending|auction|162500");
    check("listing waits for the winner", sql(`select status from listings where id='${auction}'`) === "reserved");
    await bob.page.goto(`${BASE}/en/orders/${bobOrder}`);
    check("winner sees the confirm form with the deadline", (await bob.page.textContent("main")).includes("Confirm your order"));
    await alice.page.goto(`${BASE}/en/orders/${bobOrder}`);
    check("another member cannot open the order", (await alice.page.textContent("body")).includes("404") || !(await alice.page.textContent("main")).includes("Confirm your order"));

    sql(`update orders set confirm_by = now() - interval '1 minute' where id='${bobOrder}'`);
    await admin.page.goto(`${BASE}/en/admin`);
    await admin.page.locator("button", { hasText: "Close ended auctions now" }).click();
    await admin.page.waitForTimeout(2000);
    check("unconfirmed win is cancelled", sql(`select status||'|'||cancelled_reason from orders where id='${bobOrder}'`) === "cancelled|not_confirmed_in_time");
    check("the miss is on bob's record", sql(`select count(*) from trust_events where user_id='${bob.id}' and event_type='win_unconfirmed'`) === "1");
    const offer = sql(`select id from second_chance_offers where listing_id='${auction}' and bidder_id='${alice.id}' and status='pending'`);
    check("backup offer goes to alice at her own maximum", offer && sql(`select amount from second_chance_offers where id='${offer}'`) === "160000");
    await alice.page.goto(`${BASE}/en/account/orders`);
    check("alice sees the backup offer", (await alice.page.textContent("main")).includes("first winner did not confirm"));
    await alice.page.goto(`${BASE}/en/offers/${offer}`);
    await fillAddress(alice.page, "Alice Receiver");
    await alice.page.locator("button", { hasText: "Accept and order" }).click();
    await alice.page.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 20000 });
    const aliceOrder = alice.page.url().split("/").pop();
    check("accepting creates a confirmed order with delivery added",
      sql(`select status||'|'||kind||'|'||amount||'|'||shipping_amount||'|'||total_amount||'|'||commission_amount||'|'||commission_vat_amount from orders where id='${aliceOrder}'`) === "confirmed|second_chance|160000|5000|165000|12800|1792");
    check("listing is sold", sql(`select status from listings where id='${auction}'`) === "sold");

    // --- Shipping, delivery, ledger -------------------------------------------
    await seller.page.goto(`${BASE}/en/orders/${aliceOrder}`);
    const sellerView = await seller.page.textContent("main");
    check("seller sees the delivery address and payout", sellerView.includes("12 Test Street") && sellerView.includes("1,454.08"));
    await seller.page.fill("#tracking_number", `BOS${run}`);
    await seller.page.locator("button", { hasText: "Mark as shipped" }).click();
    await seller.page.waitForTimeout(1500);
    check("seller marks it shipped", sql(`select o.status||'|'||s.status||'|'||s.cod_amount from orders o join shipments s on s.order_id=o.id where o.id='${aliceOrder}'`) === "shipped|in_transit|165000");
    await staffStep(admin, aliceOrder, "Delivered, cash collected");
    check("staff mark it delivered and paid", sql(`select status||'|'||payment_status from orders where id='${aliceOrder}'`) === "delivered|paid");
    check("alice's record shows an accepted parcel", sql(`select parcels_accepted from profiles where id='${alice.id}'`) === "1");
    check("ledger journal is posted and balances",
      sql(`select count(*)||'|'||coalesce(sum(jl.amount),0) from journals j join journal_lines jl on jl.journal_id=j.id where j.order_id='${aliceOrder}'`) === "5|0");
    await staffStep(admin, aliceOrder, "Complete and release payout");
    check("staff complete the order", sql(`select status from orders where id='${aliceOrder}'`) === "completed");
    await alice.page.goto(`${BASE}/ar/orders/${aliceOrder}`);
    await alice.page.waitForLoadState("networkidle");
    await alice.page.screenshot({ path: shot("order-ar.png"), fullPage: true });

    // --- Buy Now, refused parcels and the two-strike block ------------------------
    const fixed = await createListing(seller, { title: `Headphones ${run}`, fixed: 500, quantity: 3 });
    const buy = async (who) => {
      await who.page.goto(`${BASE}/en/checkout/${fixed}`);
      if ((await who.page.locator('input[name="address_id"][value="new"]').count()) && !(await who.page.locator('input[name="address_id"]:not([value="new"])').count())) await fillAddress(who.page, "Bob Receiver");
      await who.page.locator("button", { hasText: "Place order" }).click();
      await who.page.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 15000 }).catch(() => {});
      return who.page.url().includes("/orders/") ? who.page.url().split("/").pop() : null;
    };
    const first = await buy(bob);
    check("buy now creates a confirmed order", first && sql(`select status||'|'||kind||'|'||total_amount from orders where id='${first}'`) === "confirmed|buy_now|50000");
    check("stock goes down, listing stays live", sql(`select quantity_sold||'|'||status from listings where id='${fixed}'`) === "1|active");
    const refuse = async (orderId) => {
      await staffStep(admin, orderId, "Mark as shipped");
      await staffStep(admin, orderId, "Parcel refused");
    };
    await refuse(first);
    check("first refused parcel is one strike, not blocked", sql(`select strikes||'|'||(bidding_blocked_at is null) from profiles where id='${bob.id}'`) === "1|true");
    const second = await buy(bob);
    check("second order uses the saved address", Boolean(second));
    await refuse(second);
    check("second refused parcel blocks bidding", sql(`select strikes||'|'||(bidding_blocked_at is not null) from profiles where id='${bob.id}'`) === "2|true");
    await bob.page.goto(`${BASE}/en/checkout/${fixed}`);
    await bob.page.locator("button", { hasText: "Place order" }).click();
    check("blocked member cannot buy", (await alertText(bob.page)).includes("blocked"));
    await bob.page.goto(`${BASE}/en/account`);
    check("blocked member is told why", (await bob.page.textContent("main")).includes("blocked on your account"));
    await admin.page.goto(`${BASE}/en/admin/users?q=bob`);
    const userRow = admin.page.locator("tr", { hasText: "bob" }).first();
    await userRow.locator('input[name="reason"]').fill("Courier mistake, reviewed");
    await userRow.locator("button", { hasText: "Unblock" }).click();
    await admin.page.waitForTimeout(1500);
    check("admin unblocks the member", sql(`select bidding_blocked_at is null from profiles where id='${bob.id}'`) === "t");

    // --- Deposit on a high-value item ---------------------------------------------
    await seller.page.goto(`${BASE}/en/sell`);
    const cheap = await (async () => {
      await seller.page.fill("#title", `Cheap with deposit ${run}`);
      await seller.page.fill("#description", "x");
      await seller.page.setInputFiles("#file-photos", [img("item1.png")]);
      await seller.page.waitForTimeout(400);
      await seller.page.fill("#start_price", "500");
      await seller.page.fill("#city", "Cairo");
      await seller.page.check('input[name="requires_deposit"]');
      await seller.page.fill("#deposit_amount", "100");
      await seller.page.click(submit);
      return alertText(seller.page);
    })();
    check("deposit is refused on items under EGP 10,000", cheap.includes("10,000"));
    const pricey = await createListing(seller, { title: `Gold watch ${run}`, start: 12000, deposit: 1000 });
    await alice.page.goto(`${BASE}/en/listings/${pricey}`);
    check("bidder is asked for the deposit first", (await alice.page.textContent("main")).includes("refundable deposit") && (await alice.page.locator("#amount").count()) === 0);
    await alice.page.locator("button", { hasText: "Request deposit details" }).click();
    await alice.page.waitForTimeout(1500);
    const deposit = sql(`select id from deposits where listing_id='${pricey}' and user_id='${alice.id}' and status='pending'`);
    check("deposit request is recorded", Boolean(deposit));
    await admin.page.goto(`${BASE}/en/admin/deposits`);
    await admin.page.locator("tr", { hasText: `Gold watch ${run}` }).locator("button", { hasText: "Deposit received" }).click();
    await admin.page.waitForTimeout(1500);
    check("staff confirm the deposit", sql(`select status from deposits where id='${deposit}'`) === "held");
    check("bidder can now bid", (await bid(alice, pricey, 12000)).includes("highest bidder"));

    // --- Admin take-down, scheduled job address, audit trail -------------------------
    await admin.page.goto(`${BASE}/en/admin/listings`);
    const listingRow = admin.page.locator("tr", { hasText: `Headphones ${run}` });
    await listingRow.locator('input[name="reason"]').fill("Counterfeit");
    await listingRow.locator("button", { hasText: "Take down" }).click();
    await admin.page.waitForTimeout(1500);
    check("staff take a listing down", sql(`select status from listings where id='${fixed}'`) === "cancelled");
    await anon.goto(`${BASE}/en/listings?q=${encodeURIComponent("Headphones " + run)}`);
    check("removed listing leaves the search results", !(await anon.textContent("main")).includes(`Headphones ${run}`));
    await alice.page.goto(`${BASE}/en/admin/orders`);
    check("members cannot open admin pages", (await alice.page.textContent("main")).includes("for the Souq Mania team"));
    const secret = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").match(/CRON_SECRET=(.*)/)[1].trim();
    check("job address refuses callers without the secret", (await anon.request.get(`${BASE}/api/cron/tick`)).status() === 401);
    const tick = await anon.request.get(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${secret}` } });
    check("job address runs with the secret", tick.status() === 200 && "closed" in (await tick.json()));
    check("staff actions are in the audit log", sql(`select count(*) from audit_log where actor_id='${admin.id}'`) === "8");
    check("the unblock and its reason are logged", sql(`select reason from blocks_log where user_id='${bob.id}' and action='unblocked'`) === "Courier mistake, reviewed");

    await anon.goto(`${BASE}/ar/listings/${pricey}`);
    await anon.waitForLoadState("networkidle");
    await anon.screenshot({ path: shot("listing-ar.png"), fullPage: true });
    await anon.goto(`${BASE}/ar`);
    await anon.waitForLoadState("networkidle");
    await anon.screenshot({ path: shot("home-ar.png"), fullPage: true });
  } catch (error) {
    check("run completed", false, String(error).slice(0, 500));
  } finally {
    await browser.close();
    console.log(`${results.filter(Boolean).length}/${results.length} passed`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }
})();
