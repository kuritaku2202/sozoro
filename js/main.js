// 画面遷移と状態管理。
import { distanceMeters, bearingDegrees, formatDistance, bearingToCompassLabel } from './geo.js';
import { createCompass } from './compass.js';
import { pickDestination } from './destination.js';
import * as overpass from './sources/overpass.js';

const SEARCH_RADIUS_M = 500; // Wherewalk と同じ「周囲500m内を目処に」
const MIN_DISTANCE_M = 150;  // 近すぎる目的地は散歩にならないので下限を設ける
const ARRIVAL_KEY = 'sozoro.arrivalRadius';

const $ = (id) => document.getElementById(id);

const el = {
  screens: {
    start: $('screen-start'),
    nav: $('screen-nav'),
    arrived: $('screen-arrived'),
  },
  startStatus: $('start-status'),
  btnStart: $('btn-start'),
  btnRepick: $('btn-repick'),
  btnQuit: $('btn-quit'),
  btnAgain: $('btn-again'),
  btnHome: $('btn-home'),
  radiusStart: $('radius-start'),
  radiusStartValue: $('radius-start-value'),
  radiusNav: $('radius-nav'),
  radiusNavValue: $('radius-nav-value'),
  navCaption: $('nav-caption'),
  navSub: $('nav-sub'),
  navArrow: $('nav-arrow'),
  navDistance: $('nav-distance'),
  arrivedName: $('arrived-name'),
  arrivedKind: $('arrived-kind'),
  arrivedMeta: $('arrived-meta'),
  arrivedMap: $('arrived-map'),
  error: $('error'),
};

const state = {
  position: null,      // 現在地 {lat, lon}
  origin: null,        // 今回の出発地
  destination: null,
  heading: null,       // 端末の向き。取れないときは null
  arrivalRadius: 50,
  visited: new Set(),
  watchId: null,
  compass: null,
  rotation: 0,         // 矢印の連続回転量。近い方向へ回すために保持する
};

/* ---------- 画面 ---------- */

function show(name) {
  for (const [key, node] of Object.entries(el.screens)) {
    node.hidden = key !== name;
  }
}

function showError(message) {
  el.error.textContent = message;
  el.error.hidden = !message;
}

/* ---------- 到着判定距離 ---------- */

function setArrivalRadius(value) {
  state.arrivalRadius = Number(value);
  const label = `${state.arrivalRadius} m`;
  el.radiusStart.value = state.arrivalRadius;
  el.radiusNav.value = state.arrivalRadius;
  el.radiusStartValue.value = label;
  el.radiusNavValue.value = label;
  localStorage.setItem(ARRIVAL_KEY, String(state.arrivalRadius)); // 位置情報ではないので保存してよい
  if (state.destination) checkArrival();
}

/* ---------- 現在地 ---------- */

function geoErrorMessage(error) {
  if (error.code === error.PERMISSION_DENIED) {
    return '位置情報の利用が許可されていません。ブラウザの設定で許可してください。';
  }
  if (error.code === error.POSITION_UNAVAILABLE) return '現在地を取得できませんでした。';
  return '現在地の取得に時間がかかっています。屋外で試してください。';
}

function locateOnce() {
  if (!navigator.geolocation) {
    el.startStatus.dataset.state = 'error';
    el.startStatus.textContent = 'この端末では位置情報が使えません。';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.position = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      el.startStatus.dataset.state = 'ready';
      el.startStatus.textContent = '現在地を確認しました。いつでも歩き出せます。';
      el.btnStart.disabled = false;
    },
    (error) => {
      el.startStatus.dataset.state = 'error';
      el.startStatus.textContent = geoErrorMessage(error);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
  );
}

function startWatching() {
  if (state.watchId !== null) return;
  state.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      state.position = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      showError(''); // 測位が復帰したら、直前の一時的なエラー表示を消す
      render();
      checkArrival();
    },
    (error) => showError(geoErrorMessage(error)),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 2000 }
  );
}

function stopWatching() {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
}

/* ---------- 描画 ---------- */

/** 矢印は近いほうへ回す。359度→1度で一周させないため。 */
function rotateArrowTo(target) {
  const delta = ((target - state.rotation) % 360 + 540) % 360 - 180;
  state.rotation += delta;
  el.navArrow.style.setProperty('--rotation', `${state.rotation}deg`);
}

function render() {
  if (!state.position || !state.destination) return;

  const remaining = distanceMeters(state.position, state.destination);
  const bearing = bearingDegrees(state.position, state.destination);

  el.navDistance.textContent = formatDistance(remaining);

  if (state.heading === null) {
    // コンパスが使えない端末。北を上に固定して方位を数字と言葉で伝える。
    rotateArrowTo(bearing);
    el.navCaption.textContent = `${bearingToCompassLabel(bearing)}（${Math.round(bearing)}°）の方角です`;
    el.navSub.textContent = '画面の上が北です。まっすぐ行かなくてかまいません。';
  } else {
    rotateArrowTo(bearing - state.heading);
    el.navCaption.textContent = 'こっちの方角です';
    el.navSub.textContent = 'まっすぐ行かなくてかまいません。';
  }
}

/* ---------- 到着 ---------- */

function checkArrival() {
  if (!state.position || !state.destination) return;
  if (distanceMeters(state.position, state.destination) > state.arrivalRadius) return;

  const dest = state.destination;
  stopWatching();
  state.compass?.stop();
  showError('');

  el.arrivedName.textContent = dest.name ?? 'なんでもない場所';
  el.arrivedKind.textContent = dest.name ? dest.kind : 'ここには名前がありません';

  const walked = state.origin ? distanceMeters(state.origin, dest) : null;
  el.arrivedMeta.textContent = walked
    ? `出発地から直線で ${formatDistance(walked)} の場所です。`
    : '';

  el.arrivedMap.href =
    `https://www.openstreetmap.org/?mlat=${dest.lat}&mlon=${dest.lon}#map=18/${dest.lat}/${dest.lon}`;

  state.destination = null;
  show('arrived');
}

/* ---------- 目的地を決める ---------- */

async function newDestination() {
  if (!state.position) {
    showError('現在地がまだ取れていません。');
    return;
  }
  showError('');
  el.navDistance.textContent = '…';
  el.navCaption.textContent = '行き先を決めています';

  state.origin = { ...state.position };
  try {
    state.destination = await pickDestination({
      origin: state.origin,
      radius: SEARCH_RADIUS_M,
      minDistance: MIN_DISTANCE_M,
      categories: Object.keys(overpass.CATEGORIES), // 今回は3カテゴリ全部を1プールに混ぜる
      source: overpass,
      exclude: state.visited,
    });
  } catch (error) {
    showError('行き先を決められませんでした。もう一度お試しください。');
    console.error(error);
    return;
  }
  state.visited.add(state.destination.id);
  render();
  checkArrival(); // 判定距離が大きいと出発地点で即到着することがある
}

async function beginWalk() {
  show('nav');
  state.compass = createCompass((heading) => {
    state.heading = heading;
    render();
  });
  // iOS の許可要求はユーザー操作の中で呼ぶ必要があるため、ここで start する。
  await state.compass.start();
  startWatching();
  await newDestination();
}

function goHome() {
  stopWatching();
  state.compass?.stop();
  state.destination = null;
  state.heading = null;
  showError('');
  show('start');
  locateOnce();
}

/* ---------- 起動 ---------- */

el.radiusStart.addEventListener('input', (e) => setArrivalRadius(e.target.value));
el.radiusNav.addEventListener('input', (e) => setArrivalRadius(e.target.value));
el.btnStart.addEventListener('click', beginWalk);
el.btnRepick.addEventListener('click', newDestination);
el.btnQuit.addEventListener('click', goHome);
el.btnHome.addEventListener('click', goHome);
el.btnAgain.addEventListener('click', async () => {
  show('nav');
  await state.compass?.start();
  startWatching();
  await newDestination();
});

setArrivalRadius(localStorage.getItem(ARRIVAL_KEY) ?? 50);
locateOnce();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((error) => console.warn('SW 登録失敗', error));
  });
}
