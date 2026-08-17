-- 選別作業の共有テーブル。本番アプリの destinations とは別物で、
-- 「5人が同時に採用チェックを付ける」ための作業台。
--
-- 適用（ローカル）: wrangler d1 execute sozoro --local --file=schema.sql
-- 適用（本番）:     wrangler d1 execute sozoro --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS curation_picks (
  -- curation.json の item.id と同じもの（"飲食店:店名:lat,lon"）
  item_id         TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,          -- 文化財 / 飲食店
  name            TEXT NOT NULL,
  category        TEXT,
  lat             REAL NOT NULL,
  lon             REAL NOT NULL,
  coord_quality   TEXT,
  address         TEXT,
  ward            TEXT,
  machiaza        TEXT,
  google_place_id TEXT,
  google_rating   REAL,
  google_reviews  INTEGER,
  google_lat      REAL,
  google_lon      REAL,
  -- 誰がいつ採ったか。5人で分担するので、あとで揉めないよう必ず残す
  picked_by       TEXT NOT NULL,
  picked_at       TEXT NOT NULL,
  note            TEXT
);

CREATE INDEX IF NOT EXISTS idx_picks_kind ON curation_picks(kind);
CREATE INDEX IF NOT EXISTS idx_picks_by   ON curation_picks(picked_by);
