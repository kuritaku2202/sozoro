// SOZORO の API を叩く。中身は Cloudflare Workers + D1（台東区のオープンデータ）。

/** 現地での滞在時間の見込み。往復だけで持ち時間を使い切らせない。 */
export const STAY_MINUTES = 10;

/**
 * 持ち時間から片道の探索半径を出す。
 * 往復ぶんと滞在時間を引き、さらに直線距離へ落とす（道のりは直線の約1.25倍）。
 * ここを間違えると「30分で戻れる」という約束が破れるので、
 * returnTimeText と同じ前提（80m/分・1.25倍・滞在10分）で計算する。
 */
export function radiusForMinutes(minutes, stay = STAY_MINUTES) {
  const walkable = Math.max(minutes - stay, 10);   // 往復に使える時間
  const oneWayMinutes = walkable / 2;
  // Worker 側も 3000m で頭打ちにしているので、表示と実際をそろえる
  return Math.min(Math.round((oneWayMinutes * 80) / 1.25), 3000);
}

/**
 * 3案を取ってくる。
 * @param {{lat:number, lon:number}} origin
 * @param {string} layer '食べる' | '街を見る' | '体験する'
 * @param {number} minutes 次の予定までの時間
 */
export async function fetchProposals(origin, layer, minutes) {
  const radius = radiusForMinutes(minutes);
  const url = `/api/destinations?lat=${origin.lat}&lon=${origin.lon}&r=${radius}&layer=${encodeURIComponent(layer)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return { ...data, radius };
}

/**
 * 正体を明かさないティーザー文。
 *
 * 文そのものは手元で作って DB に入れてある（scripts/write_teasers.py）。
 * ここでは、万一入っていなかったときの受け皿だけ持つ。
 */
export function teaserOf(dest) {
  const teaser = (dest.teaser ?? '').trim();
  if (teaser) return teaser;
  return dest.category ? `この先にある${dest.category}` : 'まだ名前を伏せています';
}

/** 出発してから戻ってこられる時刻。 */
export function returnTimeText(walkMinutes, stayMinutes = STAY_MINUTES, from = new Date()) {
  const back = new Date(from.getTime() + (walkMinutes * 2 + stayMinutes) * 60000);
  return `${back.getHours()}時${String(back.getMinutes()).padStart(2, '0')}分`;
}

/** 到着した場所のまわりに何があるかを取る。ここは伏せない。 */
export async function fetchNearby(origin, excludeId, radius = 400) {
  const url = `/api/nearby?lat=${origin.lat}&lon=${origin.lon}&r=${radius}&exclude=${excludeId ?? -1}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

/**
 * 演出のための最低待ち時間。
 * 抽選が速すぎると「選ばれた感」が消えるので、最低これだけは見せる。
 */
export function atLeast(promise, ms) {
  return Promise.all([promise, new Promise((r) => setTimeout(r, ms))]).then(([value]) => value);
}
