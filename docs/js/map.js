// 地図の入口。Google マップが使えるならそちら、駄目なら Leaflet + 国土地理院。
//
// キーは Workers の secret に置き、/api/config 経由で受け取る。
// **キーが無い・読み込めない・キーが無効な場合は必ず Leaflet に落ちる。**
// 提出当日に地図が出ない、という事故を避けるための保険。

import * as leaflet from './map-leaflet.js';
import * as googleMaps from './map-google.js';

let impl = leaflet;
let which = 'leaflet';
let onFallback = null;

/** Leaflet に切り替え直す。Google が認証に失敗したときに使う。 */
function fallbackToLeaflet(reason) {
  if (which === 'leaflet') return;
  console.warn('Google マップを使えないので国土地理院に落とす:', reason);
  impl = leaflet;
  which = 'leaflet';
  document.body.dataset.map = 'leaflet';
  onFallback?.();
}

/**
 * どちらの地図を使うか決める。initMap より前に1度だけ呼ぶ。
 * @param {Function} rebuild Leaflet へ落ちたときに地図を作り直す処理
 */
export async function setupMap(rebuild) {
  onFallback = rebuild;

  // キーが無効・制限違反のとき、Google はこの関数を呼ぶ。
  // これを拾わないと、灰色の地図に警告が出たまま固まる。
  window.gm_authFailure = () => fallbackToLeaflet('キーが無効か、リファラー制限に合っていない');

  try {
    const res = await fetch('/api/config');
    const config = res.ok ? await res.json() : {};
    if (!config.mapsKey) return which;
    await googleMaps.load(config.mapsKey);
    impl = googleMaps;
    which = 'google';
  } catch (error) {
    fallbackToLeaflet(error);
  }
  return which;
}

/** いま使っている地図。出典表示の出し分けに使う。 */
export function mapProvider() {
  return which;
}

export const initMap = (...args) => impl.initMap(...args);
export const renderLandmarks = (...args) => impl.renderLandmarks(...args);
export const setHere = (...args) => impl.setHere(...args);
export const fitAll = (...args) => impl.fitAll(...args);
export const refreshMap = (...args) => impl.refreshMap(...args);
export const resetMap = (...args) => impl.resetMap(...args);
