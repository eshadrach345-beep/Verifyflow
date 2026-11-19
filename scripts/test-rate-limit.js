const assert = require("node:assert/strict");
const {
  makeBucketKey,
  getClientAddress,
  consumeRateLimit
} = require("../lib/rate-limit");

async function main() {
  const first = makeBucketKey("auth:login:email", "Person@Example.com", "test-pepper");
  const second = makeBucketKey("auth:login:email", "person@example.com", "test-pepper");
  const otherScope = makeBucketKey("auth:register:email", "person@example.com", "test-pepper");
  const otherPepper = makeBucketKey("auth:login:email", "person@example.com", "different-pepper");

  assert.equal(first.length, 64);
  assert.equal(first, second);
  assert.notEqual(first, otherScope);
  assert.notEqual(first, otherPepper);

  assert.equal(
    getClientAddress({ headers: { "x-forwarded-for": "203.0.113.4, 10.0.0.2" } }),
    "203.0.113.4"
  );
  assert.equal(getClientAddress({ headers: {} }), "");

  let queryText = "";
  let queryValues = [];
  const db = {
    async query(sql, values) {
      queryText = sql;
      queryValues = values;
      return { rows: [{ attempts: 4, retry_after_seconds: 520 }] };
    }
  };
  const result = await consumeRateLimit(db, {
    scope: "auth:login:identity",
    identifier: "person@example.com",
    limit: 3,
    windowSeconds: 900
  }, "test-pepper");

  assert.equal(result.allowed, false);
  assert.equal(result.attempts, 4);
  assert.equal(result.retryAfterSeconds, 520);
  assert(queryText.includes("ON CONFLICT (bucket_key) DO UPDATE"));
  assert(queryText.includes("NOW() - ($2::int * INTERVAL '1 second')"));
  assert.equal(queryValues[0].length, 64);
  assert.equal(queryValues[1], 900);
  assert.equal(queryValues.includes("person@example.com"), false);

  console.log("Authentication rate-limit tests passed (hashed identities, IP parsing and atomic windows).");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
