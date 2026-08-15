// 目的地を1つ選ぶ。
//
// データソースは引数で受け取る（source.fetchPois を呼ぶだけ）。
// SOZORO 本体では台東区のオープンデータ（食品衛生営業施設・文化財）を返す
// 別のソースに差し替える想定で、ここのロジックは変えずに済むようにしてある。

import { distanceMeters, randomPointWithin } from './geo.js';

/** 同じ地点を node と way の両方で拾ってしまうことがあるので座標で寄せる。 */
function dedupe(pois) {
  const seen = new Set();
  return pois.filter((poi) => {
    const key = `${poi.lat.toFixed(5)},${poi.lon.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * @param {object} options
 * @param {{lat:number, lon:number}} options.origin 現在地
 * @param {number} options.radius 探索半径（m）
 * @param {number} options.minDistance これより近い候補は選ばない（m）
 * @param {string[]} options.categories 使うカテゴリ
 * @param {{fetchPois: Function}} options.source データソース
 * @param {Set<string>} options.exclude 直前までに出した目的地の id
 * @returns {Promise<{lat:number, lon:number, name:string|null, kind:string, id:string}>}
 */
export async function pickDestination({
  origin,
  radius,
  minDistance,
  categories,
  source,
  exclude = new Set(),
}) {
  let pois = [];
  try {
    pois = dedupe(await source.fetchPois({ ...origin, radius, categories }));
  } catch (error) {
    // 通信できなくても散歩は始められるようにする。
    console.warn('目的地候補の取得に失敗したため、ランダムな地点にします', error);
  }

  const withinRange = (min) =>
    pois.filter((poi) => {
      if (exclude.has(poi.id)) return false;
      const d = distanceMeters(origin, poi);
      return d >= min && d <= radius;
    });

  // 近すぎる候補を避ける。候補が尽きたら制限を緩める。
  let candidates = withinRange(minDistance);
  if (candidates.length === 0) candidates = withinRange(0);

  if (candidates.length > 0) {
    return pickRandom(candidates);
  }

  // 候補が1つも無いとき＝Wherewalk でいう「なんでもない場所」。
  const point = randomPointWithin(origin, minDistance, radius);
  return { ...point, name: null, kind: 'なんでもない場所', id: `mystery/${Date.now()}` };
}
