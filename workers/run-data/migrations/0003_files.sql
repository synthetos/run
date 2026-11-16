-- Account files (end-to-end design §3): one row per stored object, named by its SHA-256, counted against the
-- shared storage budget by the triggers. The audit row is written by the Worker in the same batch.
CREATE TABLE files (
 user_id TEXT NOT NULL, sha256 TEXT NOT NULL CHECK(length(sha256)=64), bytes INTEGER NOT NULL CHECK(bytes > 0),
 created_at INTEGER NOT NULL, actor_label TEXT NOT NULL, PRIMARY KEY(user_id,sha256)
);
CREATE TRIGGER file_add AFTER INSERT ON files BEGIN
 UPDATE account_storage SET used_bytes=used_bytes+NEW.bytes WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER file_remove AFTER DELETE ON files BEGIN
 UPDATE account_storage SET used_bytes=used_bytes-OLD.bytes WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER file_no_update BEFORE UPDATE ON files BEGIN SELECT RAISE(ABORT,'files_fixed'); END;
