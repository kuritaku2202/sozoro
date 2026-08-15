# Cloudflare へのデプロイ手順

本番: **https://sozoro.opd-hackathon-b.workers.dev**
D1: `sozoro`（database_id `74012c4f-5b3b-4ef7-8de0-c7f7276c8473`・APAC）

初回に済ませたこと（もう不要）: `wrangler login` / `wrangler d1 create sozoro` /
workers.dev サブドメイン `opd-hackathon-b` の登録。
**Cloudflare が出力する `binding = "sozoro"` を貼らないこと。Worker は `env.DB` を参照している。**

## 0. 準備

```sh
npm i -g wrangler     # 入っていなければ
wrangler login        # ブラウザが開く
```

## 1. D1 を作る

```sh
cd SOZORO
wrangler d1 create sozoro
```

出力される `database_id` を **`wrangler.toml` の `TODO_wrangler_d1_create_sozoro` と差し替える**。

## 2. スキーマと種データを入れる

```sh
# 手元で種SQLを生成（data/destinations.csv から作る）
cd ..
python3 scripts/collect_destinations.py
python3 scripts/enrich_wikipedia.py      # 座標・画像・解説の補強（時間がかかる）
python3 scripts/build_seed_sql.py

cd SOZORO
wrangler d1 execute sozoro --file=db/schema.sql --remote
wrangler d1 execute sozoro --file=db/seed.sql   --remote
```

確認：

```sh
wrangler d1 execute sozoro --remote \
  --command="SELECT layer, status, COUNT(*) FROM destinations GROUP BY layer, status;"
```

## 3. ODPT のトークンを入れる（届いてから）

**フロントには絶対に置かない。** Workers の secret に入れる。

```sh
wrangler secret put ODPT_TOKEN
```

## 4. 公開する

```sh
wrangler deploy
```

**静的ファイルとAPIを1つの Worker で出す**（Pages と Worker に分けない）。
`docs/` の中身がそのまま配信され、`/api/` だけ `worker/index.js` が処理する。
API は2本。
- `/api/destinations?lat&lon&r&layer` … 3案を返す（正体は伏せる）
- `/api/nearby?lat&lon&r&exclude` … 到着地の周辺スポット（伏せない）

デプロイ前の確認：

```sh
wrangler deploy --dry-run    # 「Read 19 files」なら正しい
```

**19件より多いときは `docs/` の外のもの（.git や db/）を拾っている。** そのまま出さない。

## 5. GitHub Pages は保険として残す

静的ファイルを `docs/` に移したので、**GitHub の設定変更が1回だけ必要**。

> Settings > Pages > Build and deployment > Source: Deploy from a branch
> Branch: `main` / フォルダ: **`/docs`**（これまでは `/(root)`）

これで https://kuritaku2202.github.io/sozoro/ が今までどおり動く。
**ただし GitHub Pages には API が無い**ので、3案の取得は動かない。あくまで最終手段。
提出フォームに書くURLを最後に差し替えるだけなので、コストはほぼゼロ。

---

## 出典表示の義務（画面に出す必要がある）

台東区のオープンデータは **CC BY 4.0** で、次の4点の表示が求められている
（https://www.city.taito.lg.jp/kusei/online/opendata/about/opd.html）。

1. 原著作者として「台東区」と表示
2. ライセンス名「CC-BY表示4.0国際」を表示
3. **「本作品の内容について、台東区は一切保証しないものとする。」と表示**
4. 元データへのURL表示

3番目の免責文まで義務なので、**アプリ内の出典画面に必ず入れる**こと。
API のレスポンスにも `attribution` として返している。

Wikipedia 由来の画像・解説は **CC BY-SA**。記事名とライセンスを併記する
（`destinations.image_credit` に入れてある）。
