// Gives a staff role to an existing account. The first admin has to be created this way,
// because only an admin can add staff from inside the site.
//
//   DATABASE_URL=... node scripts/grant-role.mjs person@example.com admin
//
// Roles: admin, moderator, kyc_reviewer, finance, support
import pg from "pg";

const [email, role = "admin"] = process.argv.slice(2);
const roles = ["admin", "moderator", "kyc_reviewer", "finance", "support"];
if (!email || !roles.includes(role) || !process.env.DATABASE_URL) {
  console.error("Usage: DATABASE_URL=... node scripts/grant-role.mjs <email> <role>\nRoles: " + roles.join(", "));
  process.exit(1);
}

const local = /@(localhost|127\.0\.0\.1)[:/]|host=%2F|host=\//.test(process.env.DATABASE_URL);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: local ? undefined : { rejectUnauthorized: false } });
await client.connect();
try {
  const result = await client.query(
    `insert into public.staff_members (user_id, role)
     select id, $2::public.staff_role from auth.users where lower(email) = lower($1)
     on conflict do nothing returning user_id`,
    [email, role],
  );
  console.log(result.rowCount ? `Granted ${role} to ${email}.` : `No change: ${email} was not found, or already has the ${role} role.`);
} finally {
  await client.end();
}
