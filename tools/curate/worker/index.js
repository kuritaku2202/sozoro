// 選別ツールの API。5人が同時に採用チェックを付けられるようにする。
//
// 守り: 書き込みと書き出しは合言葉（CURATE_PASSWORD）が要る。
// 画面と候補データ自体はオープンデータなので、読めても困らない。
// 合言葉はヘッダで平文で送っている。内輪の作業台なのでこれで十分だが、
// **公開URLに置く以上、強い合言葉にすること**。選別が済んだらこの Worker は消す。

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

/** 長さで differ しないよう総当たりで比較する。 */
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authed(req, env) {
  const given = req.headers.get('x-curate-password') || '';
  return env.CURATE_PASSWORD && sameSecret(given, env.CURATE_PASSWORD);
}

/** 採用済みの全行。書き出しにも状態表示にも使う。 */
async function allPicks(env) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM curation_picks ORDER BY kind, picked_at`).all();
  return results ?? [];
}

const COLS = [
  'item_id', 'kind', 'name', 'category', 'lat', 'lon', 'coord_quality',
  'address', 'ward', 'machiaza', 'google_place_id', 'google_rating',
  'google_reviews', 'google_lat', 'google_lon', 'picked_by', 'picked_at', 'note',
];

function toCsv(rows, cols) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))]
    .join('\n') + '\n';
}

/** 採用行を destinations 互換の INSERT にする。sqlite3 に流せば DB ができる。 */
function toSql(rows) {
  const q = (v) => (v === null || v === undefined || v === ''
    ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'");
  const n = (v) => (v === null || v === undefined ? 'NULL' : String(v));
  const out = [
    '-- SOZORO 選別結果（sozoro-curate が生成）',
    `-- 生成 ${new Date().toISOString()} / ${rows.length}件`,
    'DROP TABLE IF EXISTS curated;',
    `CREATE TABLE curated (
  item_id TEXT PRIMARY KEY, kind TEXT, name TEXT, category TEXT,
  lat REAL, lon REAL, coord_quality TEXT, address TEXT, ward TEXT, machiaza TEXT,
  google_place_id TEXT, google_rating REAL, google_reviews INTEGER,
  google_lat REAL, google_lon REAL, picked_by TEXT, picked_at TEXT, note TEXT
);`,
    'BEGIN;',
  ];
  for (const r of rows) {
    out.push('INSERT INTO curated VALUES (' + [
      q(r.item_id), q(r.kind), q(r.name), q(r.category), n(r.lat), n(r.lon),
      q(r.coord_quality), q(r.address), q(r.ward), q(r.machiaza),
      q(r.google_place_id), n(r.google_rating), n(r.google_reviews),
      n(r.google_lat), n(r.google_lon), q(r.picked_by), q(r.picked_at), q(r.note),
    ].join(',') + ');');
  }
  out.push('COMMIT;');
  return out.join('\n') + '\n';
}

function download(body, filename, type) {
  return new Response(body, {
    headers: {
      'content-type': `${type}; charset=utf-8`,
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (!p.startsWith('/api/')) return env.ASSETS.fetch(req);

    // --- 合言葉の確認だけをするところ（画面の入口） ---
    if (p === '/api/login' && req.method === 'POST') {
      if (!env.CURATE_PASSWORD) {
        return json({ error: 'サーバに CURATE_PASSWORD が設定されていない' }, 500);
      }
      return authed(req, env)
        ? json({ ok: true })
        : json({ error: '合言葉が違う' }, 401);
    }

    // ここから下は全て合言葉が要る。
    // /api/state も含める（メンバーの名前と作業状況が出るため、外に見せない）。
    if (!authed(req, env)) return json({ error: '合言葉が要る' }, 401);

    // --- 状態。画面が数秒ごとに叩いて、5人ぶんの採用数を追いかける ---
    if (p === '/api/state' && req.method === 'GET') {
      const rows = await allPicks(env);
      const counts = { 文化財: 0, 飲食店: 0 };
      const byMember = {};
      for (const r of rows) {
        counts[r.kind] = (counts[r.kind] ?? 0) + 1;
        byMember[r.picked_by] = (byMember[r.picked_by] ?? 0) + 1;
      }
      return json({
        counts, byMember, total: rows.length,
        // 画面はこれを見て自分の表示に反映する。数百件なので毎回全部返してよい
        picks: rows.map((r) => ({ item_id: r.item_id, kind: r.kind, by: r.picked_by })),
        served_at: new Date().toISOString(),
      });
    }

    // --- 地図の鍵を配る ---
    // Maps JS API の鍵は、仕組み上どうせブラウザに出る（script の URL に載る）。
    // なので「隠す」ことは諦めて、次の2段で守る。
    //   1. 合言葉を通った人にしか配らない（ここ）
    //   2. Google Cloud 側でこの Worker のドメインに HTTP リファラ制限をかける ← 本命
    // これでチームは何も設定せずに地図が見られて、鍵はリポジトリにも入らない。
    if (p === '/api/config' && req.method === 'GET') {
      return json({ mapsKey: env.GOOGLE_MAPS_KEY ?? null });
    }

    // --- 採用する / 外す ---
    if (p === '/api/pick' && req.method === 'POST') {
      const b = await req.json();
      if (!b.item_id || !b.kind || !b.name || !b.picked_by) {
        return json({ error: 'item_id / kind / name / picked_by が要る' }, 400);
      }
      await env.DB.prepare(
        `INSERT INTO curation_picks
           (item_id,kind,name,category,lat,lon,coord_quality,address,ward,machiaza,
            google_place_id,google_rating,google_reviews,google_lat,google_lon,
            picked_by,picked_at,note)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)
         ON CONFLICT(item_id) DO UPDATE SET
           picked_by=excluded.picked_by, picked_at=excluded.picked_at,
           note=excluded.note`)
        .bind(b.item_id, b.kind, b.name, b.category ?? null, b.lat, b.lon,
              b.coord_quality ?? null, b.address ?? null, b.ward ?? null,
              b.machiaza ?? null, b.google_place_id ?? null, b.google_rating ?? null,
              b.google_reviews ?? null, b.google_lat ?? null, b.google_lon ?? null,
              b.picked_by, new Date().toISOString(), b.note ?? null)
        .run();
      return json({ ok: true });
    }

    if (p === '/api/pick' && req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'id が要る' }, 400);
      await env.DB.prepare('DELETE FROM curation_picks WHERE item_id = ?1').bind(id).run();
      return json({ ok: true });
    }

    // --- 書き出し。開発メンバーはここから落とす ---
    if (p === '/api/export.json') {
      const rows = await allPicks(env);
      return download(JSON.stringify({
        exported_at: new Date().toISOString(),
        counts: {
          文化財: rows.filter((r) => r.kind === '文化財').length,
          飲食店: rows.filter((r) => r.kind === '飲食店').length,
        },
        picked: rows,
      }, null, 1), 'curated.json', 'application/json');
    }

    if (p === '/api/export.csv') {
      return download(toCsv(await allPicks(env), COLS), 'curated.csv', 'text/csv');
    }

    if (p === '/api/export.sql') {
      return download(toSql(await allPicks(env)), 'curated.sql', 'application/sql');
    }

    return json({ error: 'not found' }, 404);
  },
};
