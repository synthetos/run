-- The setup-wizard document joins the record kinds (first-run design §6.1): one `setup` record per account.
-- SQLite cannot widen a CHECK, so both record tables are rebuilt in place as 0002 did and the triggers are
-- recreated unchanged. Every revision, audit row and storage count is carried over as it was.
DROP TRIGGER revision_cas;
DROP TRIGGER revision_apply;
DROP TRIGGER revision_no_update;
DROP TRIGGER revision_no_delete;

CREATE TABLE records_v3 (user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('tool','material','machine','project','setup')), id TEXT NOT NULL, head_rev INTEGER NOT NULL, archived_at INTEGER, PRIMARY KEY(user_id,kind,id));
INSERT INTO records_v3 (user_id,kind,id,head_rev,archived_at) SELECT user_id,kind,id,head_rev,archived_at FROM records;
DROP TABLE records;
ALTER TABLE records_v3 RENAME TO records;

CREATE TABLE record_revisions_v3 (
 user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('tool','material','machine','project','setup')), id TEXT NOT NULL,
 rev INTEGER NOT NULL CHECK(rev > 0), parent_rev INTEGER, content_json TEXT NOT NULL, content_sha256 TEXT NOT NULL,
 content_bytes INTEGER NOT NULL CHECK(content_bytes > 0), actor_kind TEXT NOT NULL CHECK(actor_kind='app'), credential_id TEXT,
 actor_label TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,kind,id,rev)
);
INSERT INTO record_revisions_v3 (user_id,kind,id,rev,parent_rev,content_json,content_sha256,content_bytes,actor_kind,credential_id,actor_label,created_at)
 SELECT user_id,kind,id,rev,parent_rev,content_json,content_sha256,content_bytes,actor_kind,credential_id,actor_label,created_at FROM record_revisions;
DROP TABLE record_revisions;
ALTER TABLE record_revisions_v3 RENAME TO record_revisions;

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
