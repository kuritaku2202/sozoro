// ホーム画面の地図。ライブラリはここに閉じ込める（差し替えを安くするため）。
//
// タイルは国土地理院の淡色地図。鍵も課金も要らず、出典表示だけで使える。
// もともとグレー基調で情報量が少ないので、「詳細な地図にはしない」という
// 方針に合う。この上に混雑を色分けしたランドマークだけを置く。

const GSI_PALE = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
const GSI_ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';

let map = null;
let layer = null;      // ランドマークのマーカー群
let hereMarker = null;

/** 地図を作る。1度だけ呼ぶ。 */
export function initMap(elementId, center = { lat: 35.7136, lon: 139.7859 }) {
  if (map) return map;
  map = L.map(elementId, {
    center: [center.lat, center.lon],
    zoom: 14,
    zoomControl: false,
    attributionControl: true,
  });
  L.tileLayer(GSI_PALE, { maxZoom: 18, attribution: GSI_ATTR }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  layer = L.layerGroup().addTo(map);
  return map;
}

/**
 * ランドマークを混雑度で塗り分けて置く。
 * @param {Array} estimates congestion.js の estimateAll() の戻り
 */
export function renderLandmarks(estimates) {
  if (!layer) return;
  layer.clearLayers();
  for (const e of estimates) {
    const lm = e.landmark ?? e;
    const marker = L.circleMarker([lm.lat, lm.lon], {
      radius: e.label === '混雑' ? 13 : 10,
      color: '#ffffff',
      weight: 2,
      fillColor: e.color,
      fillOpacity: 0.9,
    });
    marker.bindTooltip(
      `${e.name}<br><b>${e.label}</b>${e.estimated ? '（推定）' : ''}`,
      { direction: 'top', offset: [0, -6] }
    );
    marker.addTo(layer);
  }
}

/** 現在地を置く。地図の中心も寄せる。 */
export function setHere(position) {
  if (!map) return;
  const latlng = [position.lat, position.lon];
  if (!hereMarker) {
    hereMarker = L.circleMarker(latlng, {
      radius: 7, color: '#ffffff', weight: 3,
      fillColor: '#2f6fe0', fillOpacity: 1,
    }).addTo(map);
    hereMarker.bindTooltip('いまここ', { direction: 'top', offset: [0, -6] });
  } else {
    hereMarker.setLatLng(latlng);
  }
}

/** ランドマークと現在地が全部入るように寄せる。 */
export function fitAll(points) {
  if (!map || points.length === 0) return;
  map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lon])), {
    padding: [40, 40], maxZoom: 15,
  });
}
