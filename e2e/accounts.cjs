// End-to-end check of sign-up, ID verification and admin review against the local dev database.
// Needs: the site running against a local database (see README), psql, and Playwright
// (npm i -D playwright && npx playwright install chromium).
//   E2E_BASE_URL       default http://localhost:3000
//   E2E_DATABASE_URL   default postgres://postgres@127.0.0.1:5432/souq_dev
// Only ever point this at a throwaway local database: it creates accounts and changes rows directly.
const { chromium } = require("playwright");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

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
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

async function signUp(browser, who, nationalId) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/en/sign-up`);
  await page.fill("#email", `${who}-${run}@example.test`);
  await page.fill("#password", "correct horse battery");
  await page.fill("#display_name", who);
  await page.fill("#phone", "0101234" + String(Math.floor(1000 + Math.random() * 8999)));
  await page.check('input[name="terms"]');
  await page.click('main button[type="submit"]');
  await page.waitForURL("**/account/verify", { timeout: 15000 }).catch(async () => { throw new Error("sign-up did not redirect: " + (await page.textContent("main")).slice(-200)); });
  if (nationalId) {
    await page.fill("#document_number", nationalId);
    await page.setInputFiles("#file-front", img("front.png"));
    await page.setInputFiles("#file-back", img("back.png"));
    await page.waitForTimeout(500);
    await page.click('main button[type="submit"]');
    await page.waitForURL("**/account");
  }
  return { context, page, email: `${who}-${run}@example.test` };
}

(async () => {
  const browser = await chromium.launch();
  try {
    // Validation on the sign-up form.
    const probe = await (await browser.newContext()).newPage();
    await probe.goto(`${BASE}/en/sign-up`);
    await probe.fill("#email", `bad-${run}@example.test`);
    await probe.fill("#password", "correct horse battery");
    await probe.fill("#display_name", "Bad Phone");
    await probe.fill("#phone", "12345");
    await probe.check('input[name="terms"]');
    await probe.click('main button[type="submit"]');
    await probe.waitForSelector('p[role="alert"]');
    check("sign-up rejects a bad phone number", (await probe.textContent('p[role="alert"]')).includes("Egyptian mobile"));

    const serial = String(Math.floor(10000 + Math.random() * 89999));
    const buyer = await signUp(browser, "buyer", `2900101010${serial.slice(0, 4)}`);
    check("buyer signed up and submitted an ID", (await buyer.page.textContent("body")).includes("Under review"));
    check("profile is pending in the database", sql(`select verification_status from profiles p join auth.users u on u.id=p.id where u.email='${buyer.email}'`) === "pending");
    check("consents recorded", sql(`select count(*) from consents c join auth.users u on u.id=c.user_id where u.email='${buyer.email}'`) === "3");
    check("ID number is stored only as a fingerprint", /^[0-9a-f]{64}$/.test(sql(`select document_number_hmac from identity_verifications v join auth.users u on u.id=v.user_id where u.email='${buyer.email}'`)));

    // The same ID on a second account is refused.
    const copycat = await signUp(browser, "copycat", null);
    await copycat.page.fill("#document_number", `2900101010${serial.slice(0, 4)}`);
    await copycat.page.setInputFiles("#file-front", img("front.png"));
    await copycat.page.setInputFiles("#file-back", img("back.png"));
    await copycat.page.waitForTimeout(500);
    await copycat.page.click('main button[type="submit"]');
    await copycat.page.waitForSelector('p[role="alert"]');
    check("same ID on another account is refused", (await copycat.page.textContent('p[role="alert"]')).includes("already linked"));

    // Private documents: the owner can open them, a stranger cannot.
    const docPath = sql(`select front_image_path from identity_verifications v join auth.users u on u.id=v.user_id where u.email='${buyer.email}'`);
    const own = await buyer.page.request.get(`${BASE}/api/files/identity-documents/${docPath}`);
    const stranger = await copycat.page.request.get(`${BASE}/api/files/identity-documents/${docPath}`);
    const anon = await probe.request.get(`${BASE}/api/files/identity-documents/${docPath}`);
    check("owner can open their ID photo", own.status() === 200);
    check("another user cannot open it", stranger.status() === 404);
    check("signed-out visitor cannot open it", anon.status() === 404);

    // Admin review.
    const admin = await signUp(browser, "admin", null);
    await admin.page.goto(`${BASE}/en/admin/verifications`);
    check("non-staff cannot see the admin area", (await admin.page.textContent("body")).includes("for the Souq Mania team"));
    execFileSync("node", ["scripts/grant-role.mjs", admin.email, "admin"], { cwd: ROOT, env: { ...process.env, DATABASE_URL } });
    await admin.page.goto(`${BASE}/en/admin/verifications`);
    const card = admin.page.locator("article", { hasText: "buyer" }).first();
    check("admin sees the pending ID", (await card.count()) === 1);
    const shown = await admin.page.request.get(`${BASE}/api/files/identity-documents/${docPath}`);
    check("admin can open the ID photo", shown.status() === 200);
    await card.locator("button", { hasText: "Approve" }).click();
    await admin.page.waitForTimeout(1500);
    check("buyer is approved in the database", sql(`select verification_status from profiles p join auth.users u on u.id=p.id where u.email='${buyer.email}'`) === "approved");
    check("approval is in the audit log", Number(sql(`select count(*) from audit_log where action='identity_approved'`)) >= 1);

    await buyer.page.goto(`${BASE}/ar/account`);
    check("Arabic account page shows verified", (await buyer.page.textContent("body")).includes("موثّق"));
    await buyer.page.screenshot({ path: shot("account-ar.png"), fullPage: true });

    // Sign out and back in.
    await buyer.page.click('header button[type="submit"]');
    await buyer.page.waitForURL("**/ar");
    await buyer.page.goto(`${BASE}/en/sign-in`);
    await buyer.page.fill("#email", buyer.email);
    await buyer.page.fill("#password", "wrong password");
    await buyer.page.click('main button[type="submit"]');
    await buyer.page.waitForSelector('p[role="alert"]');
    check("wrong password is refused", true);
    await buyer.page.fill("#password", "correct horse battery");
    await buyer.page.click('main button[type="submit"]');
    await buyer.page.waitForURL("**/account");
    check("sign-in works", true);
  } catch (error) {
    check("run completed", false, String(error).slice(0, 400));
  } finally {
    await browser.close();
    console.log(`${results.filter(Boolean).length}/${results.length} passed`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }
})();
