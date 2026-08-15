# SOZORO

行き先を伏せた散歩アプリ。いまいる場所から半径 500m のどこかを勝手に決め、
**方角と残り距離だけ**を案内する。道は歩く人が決める。着いて初めて、そこが何かわかる。

[Wherewalk](https://wherewalk-app.carrd.co/)（iPhone / Apple Watch）の中核体験を
Web（PWA）で再現したもの。都知事杯オープンデータ・ハッカソン2026 に出す
SOZORO 本体（台東区のオーバーツーリズム対策）の土台にあたる。

## 動かす

```sh
python3 -m http.server 8080
# → http://localhost:8080
```

Geolocation と DeviceOrientation は secure context でしか動かない。
`localhost` は secure context なので開発はこれでよい。
**実機（スマホ）で試すときは HTTPS 配信が必要**。

### 手元のブラウザで試す

現在地がないと何も起きないので、Chrome DevTools で位置を上書きする。

1. DevTools → 右上の ⋮ → More tools → **Sensors**
2. Location に緯度経度を入れる（例: 浅草 `35.7148, 139.7967`）
3. Orientation を Custom orientation にすると、矢印が端末の向きに追従する挙動を確認できる

## 作りの説明

| ファイル | 役割 |
|---|---|
| `index.html` | 画面3枚（スタート／ナビ／到着）を `hidden` の切り替えで出し分ける |
| `app.css` | ライト・ダーク両対応。屋外で片手で見る前提の大きめの文字 |
| `js/main.js` | 画面遷移と状態管理 |
| `js/geo.js` | Haversine 距離 / 方位角 / 半径内のランダム座標 |
| `js/compass.js` | 端末の向き。Android は `deviceorientationabsolute`、iOS は `requestPermission` + `webkitCompassHeading` |
| `js/destination.js` | 目的地の抽選。**データソースは引数で受け取る** |
| `js/sources/overpass.js` | OpenStreetMap（Overpass API）から目的地候補を取る |
| `sw.js` | アプリシェルのみキャッシュ。目的地データはキャッシュしない |

### 再現した Wherewalk の4機能

1. **周囲500m以内からランダムに目的地** — 候補が1つも無いときは半径内のランダム座標にする（＝「なんでもない場所」）
2. **案内は方角と残り距離だけ** — 経路は出さない
3. **到着とみなす距離を可変**（10〜200m）— 敷地の広い場所・道から奥まった場所に対応。Wherewalk のデジタルクラウン相当
4. **位置情報を外部保存しない** — 目的地検索のため Overpass に座標を送るだけ。端末にも残さない

### SOZORO 本体へ伸ばすための切り込み

- `js/destination.js` はデータソースを引数で受け取る。台東区のオープンデータ
  （食品衛生営業施設 7,676件・文化財 190件）を返す `js/sources/taito.js` を足せば差し替わる
- `js/sources/overpass.js` の `CATEGORIES` は **食べる / 街を見る / 静かに歩く** の3つに分けてある。
  「気分を選ぶ」UI はこの定数を選ばせるだけで載る
- 混雑推定モデルと3案提示は**未実装**（意図的にスコープ外）

## 制約と注意

- **Overpass API はレート制限が厳しい。** 起動1回につきリクエスト1回に抑え、
  結果を `sessionStorage` に置いている。同じ場所で「引き直す」を連打しても API は叩かない
- 混雑時は 504 が返る。1エンドポイントあたり12秒で見切り、次のミラーへ回す。
  全滅しても「なんでもない場所」にフォールバックして散歩は始められる
- **ミラーは 2026-08-15 に実測して選んだ**（浅草500mの本番クエリで比較）。

  | エンドポイント | 結果 |
  |---|---|
  | `overpass-api.de` | **約5秒 / 250件**。第1候補 |
  | `overpass.private.coffee` | **約8秒 / 250件**。第2候補 |
  | `overpass.kumi.systems` | 60秒たっても返らず。**不採用** |
  | `overpass.osm.jp` | 接続不可。**不採用** |
  | `overpass.osm.ch` | 200 だが0件（スイス限定の抽出）。**不採用** |

- **Service Worker はネットワーク優先**。キャッシュは圏外で開くための保険であって、
  高速化のためではない。キャッシュ優先にすると、修正した JS が端末に届かなくなるため
- コンパスが取れない端末（PC など）では**北を上に固定**し、方位を「北東（42°）」の形で文字表示する
- UI は日本語のみ。Overpass から `name:en` は取得済みなので、多言語化はそこから始められる

## 動作確認の記録（2026-08-15）

Chromium（Playwright）に浅草 `35.7148, 139.7967` を与えて通しで確認した。

- 起動から最初の目的地提示まで **3.5秒**（Overpass 1回・候補250件）
- 「引き直す」では **API を叩かない**（`sessionStorage` のキャッシュを使う）
- 手前70mでは到着せず、判定距離を100mに広げた瞬間に到着画面へ遷移
- 到着で実在の店名が開示される（例: ときわ食堂／舟和／ice tokyo）
- 東京湾のまん中（`35.57, 139.86`）では候補0件 → **「なんでもない場所」** に落ちる
- 測位が一時的に失敗してもエラー表示は復帰時に自動で消える
- 圏外にしてリロードしても、アプリシェル（HTML/CSS/JS）はキャッシュから開く
- manifest は `display: standalone`、アイコン3件、Service Worker は active

## 出典

目的地データ: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)（ODbL）
