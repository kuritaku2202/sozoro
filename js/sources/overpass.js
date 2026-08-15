// 目的地プールを OpenStreetMap（Overpass API）から取得する。
// Overpass は Access-Control-Allow-Origin: * を返すため、静的配信のまま直接叩ける。
//
// ここで定義する CATEGORIES は、のちの SOZORO 本体で「気分を選ぶ」
// （食べる／街を見る／静かに歩く）UI にそのまま対応させるための単位。
// 今回のクローンでは3カテゴリ全部を1つのプールに混ぜて使う。

export const CATEGORIES = {
  eat: {
    label: '食べる',
    filters: [
      '["amenity"~"^(cafe|restaurant|fast_food|bar|pub|ice_cream)$"]',
      '["shop"~"^(bakery|confectionery|greengrocer)$"]',
    ],
  },
  see: {
    label: '街を見る',
    filters: [
      '["tourism"~"^(attraction|artwork|viewpoint|museum|gallery)$"]',
      '["historic"~"^(monument|memorial|ruins|castle|city_gate|archaeological_site|building|shrine|temple)$"]',
      '["amenity"="place_of_worship"]',
    ],
  },
  quiet: {
    label: '静かに歩く',
    filters: ['["leisure"~"^(park|garden)$"]'],
  },
};

// 2026-08-15 に実測して選んだ順。overpass-api.de が 約5秒、private.coffee が 約8秒。
// overpass.kumi.systems は同じクエリで60秒たっても返らず、overpass.osm.jp は接続不可、
// overpass.osm.ch はスイス限定の抽出で0件だったため、いずれも使わない。
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// 1エンドポイントあたりの待ち時間。全滅しても合計25秒で「なんでもない場所」へ抜ける。
const REQUEST_TIMEOUT_MS = 12000;

const KIND_LABELS = {
  cafe: 'カフェ', restaurant: '飲食店', fast_food: '軽食', bar: 'バー',
  pub: 'パブ', ice_cream: 'アイスクリーム', bakery: 'パン屋',
  confectionery: '菓子店', greengrocer: '八百屋', attraction: '見どころ',
  artwork: 'アート', viewpoint: '眺めのいい場所', museum: '博物館',
  gallery: 'ギャラリー', place_of_worship: '寺社・教会', park: '公園',
  garden: '庭園',
};

function buildQuery(lat, lon, radius, categoryKeys) {
  const around = `around:${radius},${lat.toFixed(5)},${lon.toFixed(5)}`;
  const parts = categoryKeys
    .flatMap((key) => CATEGORIES[key]?.filters ?? [])
    .map((filter) => `nwr${filter}(${around});`)
    .join('');
  return `[out:json][timeout:20];(${parts});out center 250;`;
}

function toPoi(element) {
  const tags = element.tags ?? {};
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;

  const kindKey =
    tags.amenity ?? tags.shop ?? tags.tourism ?? tags.leisure ??
    (tags.historic ? 'attraction' : null);

  return {
    id: `${element.type}/${element.id}`,
    name: tags.name ?? null,
    nameEn: tags['name:en'] ?? null, // 多言語対応で使う
    kind: KIND_LABELS[kindKey] ?? 'スポット',
    lat,
    lon,
  };
}

/** 同じ場所での引き直しで Overpass を叩き直さないためのキャッシュキー。 */
function cacheKey(lat, lon, radius, categoryKeys) {
  // 約11m グリッドに丸める。歩き出す前の微小な位置変動でキャッシュを外さないため。
  return `sozoro.pois.${lat.toFixed(4)},${lon.toFixed(4)},${radius},${categoryKeys.join('+')}`;
}

async function post(endpoint, query) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }),
    // 応答しないミラーで散歩が始められなくなるのを防ぐ。
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Overpass ${response.status}`);
  return response.json();
}

/**
 * 現在地の周囲から目的地候補を取得する。
 * Overpass はレート制限が厳しいので、1回の起動で1リクエストに抑え、
 * 結果は sessionStorage に置く（位置情報を永続化しないため localStorage は使わない）。
 */
export async function fetchPois({ lat, lon, radius, categories = Object.keys(CATEGORIES) }) {
  const key = cacheKey(lat, lon, radius, categories);
  const cached = sessionStorage.getItem(key);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      sessionStorage.removeItem(key);
    }
  }

  const query = buildQuery(lat, lon, radius, categories);
  let lastError = null;
  for (const endpoint of ENDPOINTS) {
    try {
      const data = await post(endpoint, query);
      const pois = (data.elements ?? []).map(toPoi).filter(Boolean);
      sessionStorage.setItem(key, JSON.stringify(pois));
      return pois;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('Overpass に接続できませんでした');
}
