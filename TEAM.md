# チームで開発する

**本番の Cloudflare を触らなくても、全員が手元でアプリを丸ごと動かせる。**
まずはこの手順だけでよい。Cloudflare のアカウントも要らない。

## 1. 用意する

```sh
git clone https://github.com/kuritaku2202/sozoro.git
cd sozoro
npm i -g wrangler
```

## 2. 手元にデータベースを作る

`db/seed.sql` はリポジトリに入っている（台東区・荒川区のオープンデータから作った 7,864 件）。

```sh
yes | wrangler d1 execute sozoro --local --file=db/schema.sql
yes | wrangler d1 execute sozoro --local --file=db/seed.sql
```

`--local` を付けると、本番ではなく `.wrangler/state/` の中に作られる。
**間違って本番を消す心配がない。**

## 3. 動かす

```sh
wrangler dev
# → http://localhost:8787
```

静的ファイル（`docs/`）と API（`worker/index.js`）が両方立ち上がり、
`/api/destinations` は手元のデータベースを引く。

現在地は要らない。**開いた時点で「雷門・11月23日 12:00」のデモモード**になっている。

### 地図について

Google マップのキーはリポジトリに入っていない（Workers の secret に置いてある）。
そのため**手元では自動的に Leaflet + 国土地理院の地図に切り替わる**。
見た目は変わるが、機能はすべて動く。キーの有無で落ちないように作ってある。

## 4. 変更したら

```sh
git switch -c 作業内容がわかる名前
# 直して、確かめて
git add -A && git commit && git push -u origin ブランチ名
```

**`main` に直接 push しない。** 本番（https://sozoro.opd-hackathon-b.workers.dev）は
`wrangler deploy` を打った時だけ更新される。デプロイは代表者がまとめてやる。

---

## どのファイルを触るか

| やりたいこと | 触るファイル |
|---|---|
| 画面の見た目 | `docs/app.css` |
| 画面の中身・文言 | `docs/index.html` |
| 画面遷移・状態 | `docs/js/main.js` |
| 混雑の推定 | `docs/js/congestion.js` と `docs/data/congestion.json` |
| 地図 | `docs/js/map-google.js` / `docs/js/map-leaflet.js` |
| 3案の選び方・API | `worker/index.js` |
| シートの開き具合 | `docs/js/main.js` の `SHEET_MIN_PX` あたり |

**目的地データそのもの（名前・画像・ティーザー文）を変えたいときは、
`db/seed.sql` を直接いじらない。** ひとつ上のフォルダにある加工スクリプトを
直してから作り直す（`../scripts/write_teasers.py` など）。手順は README を見る。

---

## 本番のデータベースを触りたい場合

**基本は触らなくてよい。** どうしても必要なとき（データの入れ替え・確認）は、
次のどれかで代表者から権限をもらう。

| 方法 | 手間 | 向いている場面 |
|---|---|---|
| **A. Cloudflare アカウントに招待** | 中 | 複数人が継続的にデプロイもする |
| **B. APIトークンを渡す** | 小 | 1〜2人が一時的に触るだけ |
| **C. 触らない（推奨）** | なし | それ以外の全員 |

### A. アカウントに招待する（代表者の作業）

Cloudflare ダッシュボード → 右上のアカウント → **Manage Account → Members → Invite**。
招待されたメンバーは自分の Cloudflare アカウントで `wrangler login` すれば、
`--remote` のコマンドが通るようになる。

### B. APIトークンを渡す（代表者の作業）

ダッシュボード → **My Profile → API Tokens → Create Token**。
権限は最小限にする。

- `Account` / `D1` / **Edit**
- `Account` / `Workers Scripts` / **Edit**（デプロイもさせる場合のみ）

渡されたメンバーは、シェルの環境変数に入れて使う。

```sh
export CLOUDFLARE_API_TOKEN=（受け取った値）
wrangler d1 execute sozoro --remote --command "SELECT COUNT(*) FROM destinations;"
```

**トークンはリポジトリにも Slack にも貼らない。** 漏れたら代表者がダッシュボードから
その場で失効させる。

---

## やってはいけないこと

- **`wrangler d1 execute ... --remote --file=db/schema.sql` を単独で流さない。**
  schema.sql は `DROP TABLE` から始まる。seed.sql を続けて流し損ねると、
  本番のデータベースが空になる（一度やらかした）。必ず2つ続けて、`yes |` を付けて流す
- `main` に直接 push しない
- Google マップのキーをコードに書かない（Workers の secret に置く）
