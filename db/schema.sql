-- SOZORO 目的地マスタ（Cloudflare D1 / SQLite）
-- 適用: wrangler d1 execute sozoro --file=db/schema.sql --remote

DROP TABLE IF EXISTS destinations;
DROP TABLE IF EXISTS landmarks;
DROP TABLE IF EXISTS sources;

-- データの出どころ。ライセンス表記を画面に出すために持つ
CREATE TABLE sources (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  publisher   TEXT NOT NULL,
  license     TEXT NOT NULL,
  url         TEXT NOT NULL,
  catalog_id  TEXT,
  fetched_at  TEXT NOT NULL
);

-- 目的地マスタ。散歩の終点になりうる全てがここに入る
CREATE TABLE destinations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  layer         TEXT NOT NULL,
  category      TEXT,
  name          TEXT NOT NULL,
  name_en       TEXT,
  lat           REAL NOT NULL,
  lon           REAL NOT NULL,
  -- 'point' = 建物の位置 / 'chome' = 丁目代表点。chome は抽選から外す
  coord_quality TEXT NOT NULL DEFAULT 'point',
  address       TEXT,
  ward          TEXT NOT NULL,
  machiaza      TEXT,
  opening_hours TEXT,
  -- オープンデータには無い。ネット調達・生成AIで後から入れる
  image_url     TEXT,
  image_credit  TEXT,
  teaser        TEXT,
  description   TEXT,
  -- 我々が着地点を制御するための列
  is_partner    INTEGER NOT NULL DEFAULT 0,
  weight        REAL    NOT NULL DEFAULT 1.0,
  status        TEXT    NOT NULL DEFAULT 'active',
  updated_at    TEXT NOT NULL
);

CREATE INDEX idx_dest_layer   ON destinations(layer, status);
CREATE INDEX idx_dest_bbox    ON destinations(lat, lon);
CREATE INDEX idx_dest_machi   ON destinations(machiaza);
CREATE INDEX idx_dest_partner ON destinations(is_partner);

-- ホーム画面の地図で混雑を色分けする対象
CREATE TABLE landmarks (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  lat        REAL NOT NULL,
  lon        REAL NOT NULL,
  area       TEXT NOT NULL,
  base_score REAL NOT NULL,
  estimated  INTEGER NOT NULL DEFAULT 0
);
