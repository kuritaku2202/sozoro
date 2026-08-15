// 距離・方位の計算。外部ライブラリは使わない。
const EARTH_RADIUS_M = 6371000;

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/** 2点間の大円距離（メートル）。Haversine。 */
export function distanceMeters(from, to) {
  const dLat = toRad(to.lat - from.lat);
  const dLon = toRad(to.lon - from.lon);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** from から to を見たときの真北基準の方位角（0〜360度）。 */
export function bearingDegrees(from, to) {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLon = toRad(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * center から minM〜maxM の範囲にランダムな1点を返す。
 * 面積に対して一様になるよう距離は sqrt で分布させる。
 * Wherewalk でいう「なんでもない場所」を作るために使う。
 */
export function randomPointWithin(center, minM, maxM) {
  const bearing = toRad(Math.random() * 360);
  const t = Math.random();
  const dist = Math.sqrt(minM ** 2 + t * (maxM ** 2 - minM ** 2));
  const angular = dist / EARTH_RADIUS_M;
  const lat1 = toRad(center.lat);
  const lon1 = toRad(center.lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

/** 残り距離の表示文字列。 */
export function formatDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

/** 方位角を8方位の日本語に変換する（コンパスが使えない端末向け）。 */
const COMPASS_POINTS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
export function bearingToCompassLabel(deg) {
  const index = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return COMPASS_POINTS[index];
}
