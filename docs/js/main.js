// 画面遷移と状態管理。
import { distanceMeters, bearingDegrees, formatDistance, bearingToCompassLabel } from './geo.js';
import { createCompass } from './compass.js';
import * as congestion from './congestion.js';
import { initMap, renderLandmarks, setHere, fitAll, refreshMap } from './map.js';
import { fetchProposals, teaserOf, returnTimeText, radiusForMinutes, fetchNearby, atLeast } from './api.js';

const ARRIVAL_KEY = 'sozoro.arrivalRadius';

const $ = (id) => document.getElementById(id);

const el = {
  screens: {
    home: $('screen-home'),
    mood: $('screen-mood'),
    loading: $('screen-loading'),
    proposals: $('screen-proposals'),
    journey: $('screen-journey'),
    nav: $('screen-nav'),
    arrived: $('screen-arrived'),
  },
  btnRepick: $('btn-repick'),
  btnQuit: $('btn-quit'),
  btnAgain: $('btn-again'),
  btnHome: $('btn-home'),
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
  arrivedImage: $('arrived-image'),
  arrivedDesc: $('arrived-desc'),
  arrivedCredit: $('arrived-credit'),
  nearby: $('nearby'),
  nearbyList: $('nearby-list'),
  nearbyCredit: $('nearby-credit'),
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
  demoPosition: null,  // デモモードで固定した現在地。null なら実測を使う
  walkTimer: null,     // 「歩く（早送り）」のタイマー
  rotation: 0,         // 矢印の連続回転量。近い方向へ回すために保持する
};

/* ---------- 地図に重なるシート ---------- */

// ⑤「運命の旅が始まる」より前の画面は、地図の上のシートに出す。
// ⑤以降は地図を隠して全画面にする（歩いている最中に地図は要らない）。
const SHEET_SCREENS = new Set(['home', 'mood', 'loading', 'proposals']);

const stage = $('stage');
const sheet = $('sheet');
const grip = $('sheet-grip');
const sheetBody = $('sheet-body');

/**
 * シートの3段階。Google マップと同じ考え方で、
 *   min  … つまみの横バーだけ見せる（地図を目一杯見たいとき）
 *   peek … カードの見出しとボタンが見える
 *   full … 中身を読む
 */
function detentOffsets() {
  const height = sheet.offsetHeight;
  return {
    full: 0,
    peek: Math.max(height - Math.round(stage.offsetHeight * 0.46), 0),
    min: Math.max(height - grip.offsetHeight, 0),
  };
}

function setDetent(name) {
  const offset = detentOffsets()[name] ?? detentOffsets().peek;
  sheet.dataset.detent = name;
  sheet.style.setProperty('--sheet-offset', `${offset}px`);
  grip.setAttribute('aria-expanded', String(name === 'full'));
  if (name !== 'full') sheetBody.scrollTop = 0;
}

/** いまの位置から、いちばん近い段階を選ぶ。 */
function nearestDetent(offset) {
  const offsets = detentOffsets();
  return Object.keys(offsets).reduce((best, key) =>
    Math.abs(offsets[key] - offset) < Math.abs(offsets[best] - offset) ? key : best, 'peek');
}

/** つまみを上下にドラッグして開閉する。指を離したら近い段階に吸い付く。 */
function enableSheetDrag() {
  let startY = 0;
  let startOffset = 0;
  let current = 0;
  let moved = 0;

  const onMove = (event) => {
    moved = event.clientY - startY;
    const limit = detentOffsets().min;
    current = Math.min(Math.max(startOffset + moved, 0), limit);
    sheet.style.setProperty('--sheet-offset', `${current}px`);
  };
  const onUp = () => {
    sheet.dataset.dragging = 'false';
    window.removeEventListener('pointermove', onMove);
    if (Math.abs(moved) < 6) {
      // 動いていない＝押しただけ。開いていれば畳み、畳んでいれば開く
      setDetent(sheet.dataset.detent === 'full' ? 'peek' : 'full');
      return;
    }
    setDetent(nearestDetent(current));
  };

  grip.addEventListener('pointerdown', (event) => {
    startY = event.clientY;
    startOffset = detentOffsets()[sheet.dataset.detent] ?? 0;
    current = startOffset;
    moved = 0;
    sheet.dataset.dragging = 'true';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  });

  window.addEventListener('resize', () => setDetent(sheet.dataset.detent ?? 'peek'));
}

/* ---------- 画面 ---------- */

function show(name) {
  const inSheet = SHEET_SCREENS.has(name);
  stage.hidden = !inSheet;
  for (const [key, node] of Object.entries(el.screens)) {
    node.hidden = key !== name;
  }
  if (inSheet) {
    // ホームは地図を見せたいので畳む。それ以外は内容を読ませたいので開く。
    setDetent(name === 'home' ? 'peek' : 'full');
    requestAnimationFrame(refreshMap);  // 入れ物のサイズが変わったことを Leaflet に教える
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
  el.radiusNav.value = state.arrivalRadius;
  el.radiusNavValue.value = label;
  localStorage.setItem(ARRIVAL_KEY, String(state.arrivalRadius)); // 位置情報ではないので保存してよい
  if (state.destination) checkArrival();
}

/* ---------- 現在地 ---------- */

/** 測位まわりの状況は「気分」画面に出す。 */
function setTripStatus(message, state_ = '') {
  const node = document.getElementById('mood-status');
  if (!node) return;
  node.dataset.state = state_;
  node.textContent = message;
}

function geoErrorMessage(error) {
  if (error.code === error.PERMISSION_DENIED) {
    return '位置情報の利用が許可されていません。ブラウザの設定で許可してください。';
  }
  if (error.code === error.POSITION_UNAVAILABLE) return '現在地を取得できませんでした。';
  return '現在地の取得に時間がかかっています。屋外で試してください。';
}

function locateOnce() {
  if (state.demoPosition) {
    updatePosition(state.demoPosition.lat, state.demoPosition.lon);
    setTripStatus('デモモードの場所を使っています。', 'ready');
    return;
  }
  if (!navigator.geolocation) {
    setTripStatus('この端末では位置情報が使えません。', 'error');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.position = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      setTripStatus('現在地を確認しました。', 'ready');
    },
    (error) => setTripStatus(geoErrorMessage(error), 'error'),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
  );
}

/** 現在地が更新されたときの共通処理。実測でもデモでもここを通す。 */
function updatePosition(lat, lon) {
  state.position = { lat, lon };
  setHere(state.position);
  render();
  checkArrival();
}

function startWatching() {
  // デモで場所を固定しているときは実測を見にいかない（上書きされてしまうため）
  if (state.demoPosition) return;
  if (state.watchId !== null) return;
  state.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      showError(''); // 測位が復帰したら、直前の一時的なエラー表示を消す
      updatePosition(pos.coords.latitude, pos.coords.longitude);
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

  // 伏せていたものを開く。画像も解説も無いことがあるので、その時は出さない。
  if (dest.image_url) {
    el.arrivedImage.src = dest.image_url;
    el.arrivedImage.alt = dest.name ?? '';
    el.arrivedImage.hidden = false;
  } else {
    el.arrivedImage.hidden = true;
    el.arrivedImage.removeAttribute('src');
  }
  el.arrivedDesc.hidden = !dest.description;
  el.arrivedDesc.textContent = dest.description ?? '';
  el.arrivedCredit.hidden = !dest.image_credit;
  el.arrivedCredit.textContent = dest.image_credit ?? '';

  el.arrivedMap.href =
    `https://www.openstreetmap.org/?mlat=${dest.lat}&mlon=${dest.lon}#map=18/${dest.lat}/${dest.lon}`;

  state.destination = null;
  show('arrived');
  loadNearby(dest);
}

/** 到着した場所のまわりに何があるかを開示する。ここは伏せない。 */
async function loadNearby(dest) {
  el.nearby.hidden = true;
  el.nearbyList.replaceChildren();
  if (!dest.id) return;                        // Overpass 由来の目的地には使えない
  try {
    const data = await fetchNearby(dest, dest.id);
    if (data.spots.length === 0) return;
    for (const spot of data.spots) {
      const li = document.createElement('li');
      li.className = 'nearby__item';
      if (spot.image_url) {
        const img = document.createElement('img');
        img.className = 'nearby__thumb';
        img.src = spot.image_url;
        img.alt = spot.name;
        img.loading = 'lazy';
        li.append(img);
      } else {
        const blank = document.createElement('div');
        blank.className = 'nearby__thumb nearby__thumb--blank';
        blank.textContent = LAYER_MARK[spot.layer] ?? '◍';
        li.append(blank);
      }
      const body = document.createElement('div');
      const name = document.createElement('p');
      name.className = 'nearby__name';
      name.textContent = spot.name;
      const meta = document.createElement('p');
      meta.className = 'nearby__meta';
      meta.textContent = `${spot.category ?? ''}・${formatDistance(spot.distance)}`;
      body.append(name, meta);
      li.append(body);
      el.nearbyList.append(li);
    }
    el.nearbyCredit.textContent = data.attribution;
    el.nearby.hidden = false;
  } catch (error) {
    console.warn('周辺スポットを取れなかった', error);
  }
}

function goHome() {
  stopWalking();
  stopWatching();
  state.compass?.stop();
  state.destination = null;
  state.heading = null;
  showError('');
  show('home');
  renderHome();
}

/* ---------- 起動 ---------- */

el.radiusNav.addEventListener('input', (e) => setArrivalRadius(e.target.value));
// 「引き直す」は3案の画面に戻す。台東区のオープンデータ以外は使わない。
el.btnRepick.addEventListener('click', () => show('proposals'));
el.btnQuit.addEventListener('click', goHome);
el.btnHome.addEventListener('click', goHome);
el.btnAgain.addEventListener('click', () => {
  stopWalking();
  // 旧 Overpass 経路には戻さない。台東区のオープンデータで選び直す。
  show('mood');
  trip.status.textContent = '';
  locateOnce();
});

/* ---------- ホーム画面（混雑の提示）---------- */

const home = {
  card: $('home-card'), title: $('home-title'), body: $('home-body'),
  quiet: $('home-quiet'), demo: $('home-demo'), cta: $('home-cta'),
  timeInput: $('demo-time'), weather: $('demo-weather'),
  apply: $('demo-apply'), reset: $('demo-reset'),
};

let weather = '晴';

/** 混雑を計算し直して、地図とカードを描く。 */
function renderHome() {
  const estimates = congestion.estimateAll(undefined, weather);
  const byId = new Map(congestion.landmarks().map((l) => [l.id, l]));
  // マーカーを押しても見出しは書き換えない。本文と食い違って
  // 「混んでいます」と「◯◯は空いています」が同時に出てしまうため。
  // ランドマーク個別の状態はツールチップ側で見せる。
  renderLandmarks(estimates.map((e) => ({ ...e, landmark: byId.get(e.id) })));

  const card = congestion.homeCard(undefined, weather, state.position);
  home.title.textContent = card.title;
  home.body.textContent = card.body;
  home.demo.hidden = !card.demo;
  if (card.quiet.length > 0) {
    home.quiet.hidden = false;
    home.quiet.textContent = `いま空いているのは ${card.quiet.join('・')}`;
  } else {
    home.quiet.hidden = true;
  }
}

async function startHome() {
  try {
    await congestion.loadModel();
  } catch (error) {
    home.title.textContent = '混雑を読み込めませんでした';
    home.body.textContent = '時間をおいて開き直してください。';
    console.warn(error);
    return;
  }
  enableSheetDrag();
  setDetent('peek');
  initMap('map', undefined, (latlon) => {
    // 地図を直接タップして「そこにいることにする」。プリセットより自由が利く
    demoUI.place.value = '';
    setDemoPlace(latlon);
  });
  fitAll(congestion.landmarks());
  weather = await congestion.fetchWeather();
  renderHome();
}

home.cta.addEventListener('click', () => {
  show('mood');
  trip.status.textContent = '';
  locateOnce();
});
home.apply.addEventListener('click', () => {
  if (home.timeInput.value) congestion.setDemoTime(new Date(home.timeInput.value));
  weather = home.weather.value;
  renderHome();
});
home.reset.addEventListener('click', async () => {
  congestion.setDemoTime(null);
  weather = await congestion.fetchWeather();
  home.weather.value = weather;
  renderHome();
});


/* ---------- デモモード（現地にいなくても試せるようにする）---------- */

const demoUI = {
  place: $('demo-place'),
  navBox: $('nav-demo'),
  walk: $('demo-walk'),
};

/** デモの場所を設定する。null を渡すと実測に戻る。 */
function setDemoPlace(latlon) {
  stopWalking();
  if (!latlon) {
    state.demoPosition = null;
    demoUI.navBox.hidden = true;
    locateOnce();
    return;
  }
  state.demoPosition = latlon;
  stopWatching();                 // 実測に上書きされないように止める
  demoUI.navBox.hidden = false;
  updatePosition(latlon.lat, latlon.lon);
  setTripStatus('デモモードの場所を使っています。', 'ready');
  renderHome();
}

function stopWalking() {
  if (state.walkTimer !== null) {
    clearInterval(state.walkTimer);
    state.walkTimer = null;
    demoUI.walk.textContent = '目的地に向かって歩く（早送り）';
  }
}

/**
 * 目的地に向かって少しずつ近づける。
 * 実際に歩かないと到着が試せないので、デモではここで距離を詰める。
 */
function startWalking() {
  if (!state.destination || !state.position) return;
  if (state.walkTimer !== null) { stopWalking(); return; }
  demoUI.walk.textContent = '歩くのをやめる';
  state.walkTimer = setInterval(() => {
    if (!state.destination || !state.position) { stopWalking(); return; }
    const { lat, lon } = state.position;
    const next = {
      lat: lat + (state.destination.lat - lat) * 0.28,
      lon: lon + (state.destination.lon - lon) * 0.28,
    };
    // デモ位置も更新しておく（到着後に引き直しても、いた場所から続く）
    state.demoPosition = next;
    updatePosition(next.lat, next.lon);
    if (!state.destination) stopWalking();   // checkArrival が到着させたら止まる
  }, 420);
}

demoUI.place.addEventListener('change', () => {
  const value = demoUI.place.value;
  if (!value) { setDemoPlace(null); return; }
  const [lat, lon] = value.split(',').map(Number);
  setDemoPlace({ lat, lon });
});
demoUI.walk.addEventListener('click', startWalking);

/* ---------- 気分・持ち時間 → 3案（②③④）---------- */

const trip = {
  moodButtons: [...document.querySelectorAll('.mood')],
  minutes: $('mood-minutes'),
  minutesValue: $('mood-minutes-value'),
  status: $('mood-status'),
  go: $('mood-go'),
  back: $('mood-back'),
  list: $('proposals'),
  listStatus: $('proposals-status'),
  listBack: $('proposals-back'),
};

const LAYER_MARK = { '食べる': '🍚', '街を見る': '⛩', '体験する': '🧵' };

let chosenLayer = null;

function selectMood(layer) {
  chosenLayer = layer;
  for (const b of trip.moodButtons) {
    b.setAttribute('aria-checked', String(b.dataset.layer === layer));
  }
  trip.go.disabled = false;
}

function renderProposals(data, minutes) {
  trip.list.replaceChildren();
  for (const p of data.proposals) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.className = 'proposal';
    button.type = 'button';

    const thumb = document.createElement('div');
    thumb.className = 'proposal__thumb';
    if (p.image_url) {
      const img = document.createElement('img');
      img.src = p.image_url;
      img.alt = '';           // 正体を伏せているので読み上げさせない
      thumb.append(img);
    } else {
      const mark = document.createElement('span');
      mark.textContent = LAYER_MARK[p.layer] ?? '◍';
      thumb.append(mark);
    }

    const body = document.createElement('div');
    const teaser = document.createElement('p');
    teaser.className = 'proposal__teaser';
    teaser.textContent = teaserOf(p);
    const meta = document.createElement('p');
    meta.className = 'proposal__meta';
    meta.textContent =
      `${formatDistance(p.distance)}・徒歩${p.walkMinutes}分・${returnTimeText(p.walkMinutes)}には戻れます`;
    body.append(teaser, meta);

    button.append(thumb, body);
    button.addEventListener('click', () => acceptProposal(p));
    li.append(button);
    trip.list.append(li);
  }
  trip.listStatus.textContent =
    `${data.count}件の候補から3つ選びました（片道${radiusForMinutes(minutes)}m以内・混雑している地区は外しています）`;
}

async function findProposals() {
  if (!state.position) {
    trip.status.textContent = '現在地がまだ取れていません。位置情報を許可してください。';
    return;
  }
  show('loading');
  try {
    const minutes = Number(trip.minutes.value);
    // 抽選が速すぎると「選ばれた感」が消えるので、最低1.6秒は見せる
    const data = await atLeast(fetchProposals(state.position, chosenLayer, minutes), 1600);
    if (data.proposals.length === 0) {
      show('mood');
      trip.status.textContent = 'この時間で行ける場所が見つかりませんでした。時間を伸ばすか、気分を変えてください。';
      return;
    }
    renderProposals(data, minutes);
    show('proposals');
  } catch (error) {
    show('mood');
    trip.status.textContent = '行き先を探せませんでした。もう一度お試しください。';
    console.error(error);
  }
}

/** 3案から1つ選んだら、既存のナビ画面へ渡す。 */
async function acceptProposal(proposal) {
  state.origin = { ...state.position };
  state.destination = { ...proposal, kind: proposal.category ?? '' };

  // ⑤ 運命の旅が始まる。コンパスの許可要求はユーザー操作の文脈で出す必要があるので、
  // 演出を見せている裏で先に start しておく。
  show('journey');
  state.compass = createCompass((heading) => { state.heading = heading; render(); });
  // iOS の許可ダイアログは、ユーザーが放置すると解決しない。
  // 演出の裏で走らせるが、待ち続けて画面が止まらないよう頭打ちにする。
  const ready = Promise.race([
    state.compass.start().catch(() => false),
    new Promise((r) => setTimeout(() => r(false), 4000)),
  ]);
  await new Promise((r) => setTimeout(r, 1800));
  await ready;

  show('nav');
  startWatching();
  render();
  checkArrival();
}

trip.moodButtons.forEach((b) => b.addEventListener('click', () => selectMood(b.dataset.layer)));
trip.minutes.addEventListener('input', () => {
  trip.minutesValue.textContent = `${trip.minutes.value} 分`;
});
trip.go.addEventListener('click', findProposals);
trip.back.addEventListener('click', () => { show('home'); renderHome(); });
trip.listBack.addEventListener('click', () => show('mood'));

setArrivalRadius(localStorage.getItem(ARRIVAL_KEY) ?? 50);
show('home');
startHome();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((error) => console.warn('SW 登録失敗', error));
  });
}
