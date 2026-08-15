// SOZORO のAPI。Cloudflare Workers + D1。
//
// フロントに出せないもの（ODPT のトークン）と、
// フロントに持たせたくないもの（7,946件の目的地マスタ）をここで扱う。

const LAYERS = ['食べる', '街を見る', '体験する', '静かに歩く'];

/** 度あたりの距離。緯度35度付近の概算。バウンディングボックスを作るのに使う。 */
const M_PER_DEG_LAT = 111000;
const M_PER_DEG_LON = 91000;

function haversine(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 混雑側の町字。分散が目的なので、ここへは送らない。 */
const CROWDED = ['浅草', '雷門', '花川戸', '西浅草', '上野', '上野公園', '東上野'];

// 台東区のオープンデータは CC BY 4.0。原著作者・ライセンス名・免責文・元URLの表示が義務。
const ATTRIBUTION = '台東区（CC BY 4.0）／本作品の内容について、台東区は一切保証しないものとする。';

/**
 * 3案を選ぶ。
 *
 * 優先順位は 加盟店枠 → 画像のあるもの → 残り。
 * 画像を先に出すのは、④の画面がモザイクで正体を隠す作りだから。
 * 画像が無いと記号しか出せず、3案を見比べる楽しみが消えてしまう。
 *
 * どの段でも「別々の町字から」を守るが、町字が足りない場所では
 * 案の数を優先して制約を外す（散らすための規則であって、数を削る理由ではない）。
 */
function choose(rows, n = 3) {
  const picked = [];
  const machiCount = new Map();

  // 同じ町字ばかりにならないように上限を持つ。
  // limit=1 なら全部ちがう町字、limit=2 まで許すと画像を優先しやすくなる。
  const pick = (pool, limit = 1) => {
    const cands = pool.filter((r) =>
      !picked.includes(r) && (machiCount.get(r.machiaza) ?? 0) < limit);
    if (cands.length === 0) return false;
    const total = cands.reduce((sum, r) => sum + (r.weight || 1), 0);
    let x = Math.random() * total;
    const hit = cands.find((r) => (x -= r.weight || 1) <= 0) ?? cands[0];
    picked.push(hit);
    machiCount.set(hit.machiaza, (machiCount.get(hit.machiaza) ?? 0) + 1);
    return true;
  };

  const withImage = rows.filter((r) => r.image_url);

  pick(rows.filter((r) => r.is_partner === 1));       // 加盟店枠（無ければ素通り）
  while (picked.length < n && pick(withImage, 1)) {}  // まず画像あり・別々の町字
  while (picked.length < n && pick(withImage, 2)) {}  // 画像を優先し、同じ町字も2件まで許す
  while (picked.length < n && pick(rows, 1)) {}       // 足りなければ画像なしも
  while (picked.length < n && pick(rows, 3)) {}       // それでも足りなければ町字の縛りを外す
  return picked;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // API 以外は静的ファイルに流す（index.html などは assets が持っている）
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    // 地図のキーをフロントに渡す。Maps JavaScript API のキーはブラウザに出る作りなので、
    // 秘密ではない。守りは Google Cloud 側の HTTP リファラ制限で行う。
    // ここに置くのは、リポジトリに直書きしないためと、差し替えを wrangler secret で済ませるため。
    if (url.pathname === '/api/config') {
      return Response.json({ mapsKey: env.GOOGLE_MAPS_KEY ?? null },
                           { headers: { 'cache-control': 'no-store' } });
    }

    if (url.pathname !== '/api/destinations' && url.pathname !== '/api/nearby') {
      return Response.json({ error: 'そのAPIは無い' }, { status: 404 });
    }

    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    const radius = Math.min(Number(url.searchParams.get('r')) || 1000, 3000);
    const layer = url.searchParams.get('layer');

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return Response.json({ error: 'lat と lon が要る' }, { status: 400 });
    }
    if (layer && !LAYERS.includes(layer)) {
      return Response.json({ error: `layer は ${LAYERS.join(' / ')} のどれか` }, { status: 400 });
    }

    // 到着後に「この近くには他に何があるか」を開示する。
    // こちらは伏せない。既に着いているので、名前も画像もそのまま出す。
    if (url.pathname === '/api/nearby') {
      const nr = Math.min(Number(url.searchParams.get('r')) || 400, 1000);
      const exclude = Number(url.searchParams.get('exclude')) || -1;
      const { results: near } = await env.DB.prepare(`
        SELECT id, layer, category, name, lat, lon, machiaza, image_url, image_credit, description
          FROM destinations
         WHERE status = 'active' AND coord_quality = 'point' AND id != ?
           AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
         LIMIT 300`)
        .bind(exclude, lat - nr / M_PER_DEG_LAT, lat + nr / M_PER_DEG_LAT,
              lon - nr / M_PER_DEG_LON, lon + nr / M_PER_DEG_LON)
        .all();
      const spots = near
        .map((r) => ({ ...r, distance: Math.round(haversine({ lat, lon }, r)) }))
        .filter((r) => r.distance <= nr)
        // 画像や解説を持っているものを先に見せる（見栄えと情報量のため）
        .sort((a, b) => (b.image_url ? 1 : 0) - (a.image_url ? 1 : 0) || a.distance - b.distance)
        .slice(0, 8);
      return Response.json({ count: spots.length, spots, attribution: ATTRIBUTION },
                           { headers: { 'cache-control': 'no-store' } });
    }

    const dLat = radius / M_PER_DEG_LAT;
    const dLon = radius / M_PER_DEG_LON;

    // 丁目代表点（coord_quality='chome'）は残り距離が嘘になるので抽選から外す
    const sql = `
      SELECT id, layer, category, name, name_en, lat, lon, address, machiaza,
             image_url, image_credit, teaser, description, is_partner, weight
        FROM destinations
       WHERE status = 'active'
         AND coord_quality = 'point'
         AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
         ${layer ? 'AND layer = ?' : ''}
         AND (machiaza IS NULL OR machiaza NOT IN (${CROWDED.map(() => '?').join(',')}))
       LIMIT 500`;
    const args = [lat - dLat, lat + dLat, lon - dLon, lon + dLon,
                  ...(layer ? [layer] : []), ...CROWDED];

    const { results } = await env.DB.prepare(sql).bind(...args).all();

    // バウンディングボックスは四角なので、円で絞り直す
    const within = results
      .map((r) => ({ ...r, distance: Math.round(haversine({ lat, lon }, r)) }))
      .filter((r) => r.distance <= radius);

    const proposals = choose(within).map((r) => ({
      ...r,
      walkMinutes: Math.round((r.distance * 1.25) / 80),  // 道のり補正 1.25倍
    }));

    return Response.json({
      count: within.length,
      proposals,
      attribution: ATTRIBUTION,
    }, { headers: { 'cache-control': 'no-store' } });
  },
};
