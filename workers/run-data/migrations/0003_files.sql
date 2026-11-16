-- Account files (end-to-end design §3): one row per stored object, named by its SHA-256, counted against the
-- shared storage budget by the triggers from the moment it is reserved. `state` is the object's lifecycle
-- (pending: bytes on their way; ready: stored and verified; deleting: being removed) and `token` names the
-- object in the bucket, so an older operation can never touch a newer upload of the same digest. Only the
-- state may change; the audit row is written by the Worker in the same batch as each transition.
CREATE TABLE files (
 user_id TEXT NOT NULL, sha256 TEXT NOT NULL CHECK(length(sha256)=64), bytes INTEGER NOT NULL CHECK(bytes > 0),
 state TEXT NOT NULL CHECK(state IN ('pending','ready','deleting')), token TEXT NOT NULL CHECK(length(token)=32),
 created_at INTEGER NOT NULL, actor_label TEXT NOT NULL, PRIMARY KEY(user_id,sha256)
);
CREATE TRIGGER file_add AFTER INSERT ON files BEGIN
 UPDATE account_storage SET used_bytes=used_bytes+NEW.bytes WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER file_remove AFTER DELETE ON files BEGIN
 UPDATE account_storage SET used_bytes=used_bytes-OLD.bytes WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER file_fixed BEFORE UPDATE OF user_id,sha256,bytes,token,created_at,actor_label ON files BEGIN SELECT RAISE(ABORT,'files_fixed'); END;
