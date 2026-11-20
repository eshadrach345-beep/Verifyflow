const assert = require("node:assert/strict");
const {
  hashPassword, verifyPassword, readCookie, hashToken, sameOrigin, secureDatabaseConnectionString
} = require("../lib/auth");

async function main() {
  const password = "VerifyFlow-Test-Password-42";
  const stored = await hashPassword(password);
  assert.notEqual(stored, password);
  assert.equal(await verifyPassword(password, stored), true);
  assert.equal(await verifyPassword("incorrect-password", stored), false);
  assert.equal(await verifyPassword(password, "invalid-hash"), false);

  const token = "a".repeat(64);
  assert.equal(readCookie({ headers: { cookie: "other=x; vf_session=" + token + "; theme=dark" } }, "vf_session"), token);
  assert.equal(readCookie({ headers: { cookie: "vf_session=not-a-token" } }, "vf_session"), null);
  assert.equal(hashToken(token).length, 64);
  assert.equal(hashToken(token), hashToken(token));

  const neonUrl = secureDatabaseConnectionString("postgresql://user:pass@ep-example.us-east-2.aws.neon.tech/app?sslmode=require&channel_binding=require");
  assert.match(neonUrl, /sslmode=verify-full/);
  assert.match(neonUrl, /channel_binding=require/);
  assert.equal(secureDatabaseConnectionString("postgres://user:pass@localhost:5432/app?sslmode=disable"), "postgres://user:pass@localhost:5432/app?sslmode=disable");
  assert.equal(secureDatabaseConnectionString("postgres://user:pass@127.0.0.1/app"), "postgres://user:pass@127.0.0.1/app");

  assert.equal(sameOrigin({
    headers: { origin: "https://verifyflow.us.ci", host: "verifyflow.us.ci" }
  }), true);
  assert.equal(sameOrigin({
    headers: { origin: "https://evil.example", host: "verifyflow.us.ci" }
  }), false);

  console.log("Customer authentication helper tests passed (passwords, cookies, origin checks).");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
