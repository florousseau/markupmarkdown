// mongosh script: seeds a signed-in user (cookie session) and an
// admin-scope agent token for the reply-suggestion E2E spec, then
// prints them as JSON. GitHub OAuth isn't available in tests, so the
// session row is written directly — same shape as testutil's
// NewTestSession / NewAPIToken.
//
// Usage (test database only — the name must contain "test"):
//   mongosh "mongodb://localhost:27017/markupmarkdown-test-e2e" --quiet e2e/fixtures/seed-session.js
// then export E2E_SESSION=<session> E2E_TOKEN=<token> before `npx playwright test`.
if (!db.getName().toLowerCase().includes("test")) {
  throw new Error(`refusing to seed non-test database ${db.getName()}`);
}
const crypto = require("crypto");
const now = new Date();
const userId = crypto.randomUUID();
const session = crypto.randomUUID();
const token = "mmk_" + crypto.randomBytes(32).toString("hex");
db.users.insertOne({
  _id: userId,
  github_id: NumberLong(String(Math.floor(Math.random() * 1e9))),
  login: "e2e-" + userId.slice(0, 8),
  name: "E2E Reviewer",
  access_token: "",
  created_at: now,
  updated_at: now,
});
db.sessions.insertOne({
  _id: session,
  user_id: userId,
  created_at: now,
  expires_at: new Date(now.getTime() + 24 * 3600 * 1000),
});
db.api_tokens.insertOne({
  _id: crypto.randomUUID(),
  user_id: userId,
  hash: crypto.createHash("sha256").update(token).digest("hex"),
  prefix: token.slice(0, 12) + "…",
  label: "e2e-agent",
  scope: "admin",
  created_at: now,
});
print(JSON.stringify({ session, token }));
