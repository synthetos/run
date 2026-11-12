-- Revisions and audit rows are appended atomically by SQLite, including CAS and quota checks.
CREATE TABLE account_storage (user_id TEXT PRIMARY KEY, used_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_bytes >= 0), limit_bytes INTEGER NOT NULL CHECK(limit_bytes > 0), CHECK(used_bytes <= limit_bytes));
CREATE TABLE records (user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('tool','material')), id TEXT NOT NULL, head_rev INTEGER NOT NULL, archived_at INTEGER, PRIMARY KEY(user_id,kind,id));
CREATE TABLE record_revisions (
 user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('tool','material')), id TEXT NOT NULL,
 rev INTEGER NOT NULL CHECK(rev > 0), parent_rev INTEGER, content_json TEXT NOT NULL, content_sha256 TEXT NOT NULL,
 content_bytes INTEGER NOT NULL CHECK(content_bytes > 0), actor_kind TEXT NOT NULL CHECK(actor_kind='app'), credential_id TEXT,
 actor_label TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,kind,id,rev)
);
CREATE TABLE changes (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, at INTEGER NOT NULL, actor_kind TEXT NOT NULL,
 credential_id TEXT, actor_label TEXT NOT NULL, object_kind TEXT NOT NULL, object_id TEXT NOT NULL,
 rev_before INTEGER, rev_after INTEGER, summary TEXT NOT NULL, undone_by TEXT
);
CREATE INDEX changes_user_time ON changes(user_id,at,id);
CREATE TRIGGER revision_cas BEFORE INSERT ON record_revisions BEGIN
 SELECT CASE WHEN NEW.rev != COALESCE(NEW.parent_rev,0)+1 OR
 (NEW.parent_rev IS NULL AND EXISTS(SELECT 1 FROM records WHERE user_id=NEW.user_id AND kind=NEW.kind AND id=NEW.id)) OR
 (NEW.parent_rev IS NOT NULL AND NOT EXISTS(SELECT 1 FROM records WHERE user_id=NEW.user_id AND kind=NEW.kind AND id=NEW.id AND head_rev=NEW.parent_rev AND archived_at IS NULL))
 THEN RAISE(ABORT,'record_conflict') END;
END;
CREATE TRIGGER revision_apply AFTER INSERT ON record_revisions BEGIN
 UPDATE account_storage SET used_bytes=used_bytes+NEW.content_bytes WHERE user_id=NEW.user_id;
 INSERT INTO records(user_id,kind,id,head_rev) VALUES(NEW.user_id,NEW.kind,NEW.id,NEW.rev)
 ON CONFLICT(user_id,kind,id) DO UPDATE SET head_rev=NEW.rev;
 INSERT INTO changes VALUES(lower(hex(randomblob(16))),NEW.user_id,NEW.created_at,NEW.actor_kind,NEW.credential_id,NEW.actor_label,NEW.kind,NEW.id,NEW.parent_rev,NEW.rev,'Saved record',NULL);
END;
CREATE TRIGGER revision_no_update BEFORE UPDATE ON record_revisions BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER revision_no_delete BEFORE DELETE ON record_revisions BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER changes_no_update BEFORE UPDATE ON changes BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER changes_no_delete BEFORE DELETE ON changes BEGIN SELECT RAISE(ABORT,'append_only'); END;
