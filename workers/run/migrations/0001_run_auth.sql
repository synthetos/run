-- run's sign-in handoff (ROADMAP A1-06, A1-07; accounts docs/RP_CONTRACT.md).
-- The RUN_AUTH D1 database: pending sign-ins, device rows and the sign-in rate counter.
-- Only digests of bearer values are stored. Times are Unix seconds.

CREATE TABLE auth_requests (
  state_hash TEXT PRIMARY KEY NOT NULL CHECK (length(state_hash) = 64 AND state_hash NOT GLOB '*[^0-9a-f]*'),
  browser_nonce_hash TEXT NOT NULL CHECK (length(browser_nonce_hash) = 64 AND browser_nonce_hash NOT GLOB '*[^0-9a-f]*'),
  verifier_enc TEXT NOT NULL CHECK (length(verifier_enc) <= 256),
  nonce TEXT NOT NULL CHECK (length(nonce) = 43),
  return_to TEXT NOT NULL CHECK (length(return_to) <= 512 AND substr(return_to, 1, 1) = '/'),
  shared_computer INTEGER NOT NULL CHECK (shared_computer IN (0, 1)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  used_at INTEGER CHECK (used_at >= created_at AND used_at < expires_at)
) STRICT;
CREATE INDEX auth_requests_expiry ON auth_requests(expires_at);

-- One row per sign-in on a browser (A2-05 adds the browser's own device key later).
-- Created unbound before the code exchange, bound to the session's sub after it.
CREATE TABLE devices (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 47 AND substr(id, 1, 4) = 'dev_'),
  user_sub TEXT CHECK (user_sub IS NULL OR (length(user_sub) <= 64 AND substr(user_sub, 1, 4) = 'usr_')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  last_seen_at INTEGER NOT NULL CHECK (last_seen_at >= created_at),
  label TEXT NOT NULL CHECK (length(label) <= 64)
) STRICT;
CREATE INDEX devices_by_user ON devices(user_sub);
CREATE INDEX devices_unbound ON devices(created_at) WHERE user_sub IS NULL;

CREATE TABLE login_rate (
  bucket TEXT PRIMARY KEY NOT NULL CHECK (length(bucket) <= 96),
  count INTEGER NOT NULL CHECK (count >= 1),
  expires_at INTEGER NOT NULL CHECK (expires_at >= 0)
) STRICT;
CREATE INDEX login_rate_expiry ON login_rate(expires_at);
