// Google マップ版の地図。map.js から差し替えて使う。
//
// キーはブラウザに出る（Maps JavaScript API はそういう作り）。
// **Google Cloud コンソールで HTTP リファラ制限をかけること**が前提。
// 制限をかけないと、他所のサイトから使われて請求が来る。

const POI_OFF = [
  // 「詳細な地図にはしない」方針に合わせ、店や施設のラベルを落とす。
  // SOZORO が見せたいのは自前の混雑マーカーだけ。
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#7a6a60' }] },
];

let map = null;
let markers = [];
let hereMarker = null;

/** 作り直せるように状態を捨てる。 */
export function resetMap() {
  map = null;
  markers = [];
  hereMarker = null;
}

/** Maps JavaScript API を読み込む。1度だけ。 */
export function load(key) {
  if (window.google?.maps) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&language=ja&region=JP&callback=__sozoroMapsReady`;
    script.async = true;
    window.__sozoroMapsReady = () => resolve();
    script.onerror = () => reject(new Error('Google マップを読み込めなかった'));
    document.head.append(script);
  });
}

export function initMap(elementId, center = { lat: 35.7136, lon: 139.7859 }, onPick) {
  if (map) return map;
  map = new google.maps.Map(document.getElementById(elementId), {
    center: { lat: center.lat, lng: center.lon },
    zoom: 14,
    styles: POI_OFF,
    disableDefaultUI: true,
    zoomControl: true,
    zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
    gestureHandling: 'greedy',   // 1本指でも動かせる（スマホ前提）
    clickableIcons: false,
  });
  if (onPick) {
    map.addListener('click', (event) =>
      onPick({ lat: event.latLng.lat(), lon: event.latLng.lng() }));
  }
  return map;
}

export function renderLandmarks(estimates) {
  if (!map) return;
  for (const marker of markers) marker.setMap(null);
  markers = estimates.map((e) => {
    const lm = e.landmark ?? e;
    return new google.maps.Marker({
      map,
      position: { lat: lm.lat, lng: lm.lon },
      title: `${e.name}：${e.label}${e.estimated ? '（推定）' : ''}`,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: e.label === '混雑' ? 13 : 10,
        fillColor: e.color,
        fillOpacity: 0.9,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      },
    });
  });
}

export function setHere(position) {
  if (!map) return;
  const latLng = { lat: position.lat, lng: position.lon };
  if (!hereMarker) {
    hereMarker = new google.maps.Marker({
      map,
      position: latLng,
      title: 'いまここ',
      zIndex: 999,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 7,
        fillColor: '#2f6fe0',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 3,
      },
    });
  } else {
    hereMarker.setPosition(latLng);
  }
}

export function fitAll(points) {
  if (!map || points.length === 0) return;
  const bounds = new google.maps.LatLngBounds();
  for (const p of points) bounds.extend({ lat: p.lat, lng: p.lon });
  map.fitBounds(bounds, 40);
}

/** 入れ物のサイズが変わったときに中心を保ったまま作り直す。 */
export function refreshMap() {
  if (!map) return;
  const center = map.getCenter();
  google.maps.event.trigger(map, 'resize');
  if (center) map.setCenter(center);
}
