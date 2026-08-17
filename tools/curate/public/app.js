// SOZORO 物件選別ツール（チーム共有版）
//
// 採用状態は D1 に置く。5人が同時に開いて、互いの採用がすぐ見える。
// 4秒ごとに /api/state を取りに行くだけの素朴な作りにしてある。
// WebSocket や Durable Objects でもできるが、選別が終われば捨てる道具なので
// 一番壊れにくいやり方を選んだ。
//
// 地図の鍵はサーバ（Worker のシークレット）に置いてあり、合言葉を通ると /api/config で
// 配られる。メンバー側の設定は要らない。写真は出さないので Place Photo は使わない
// ＝ 課金に触るのは地図の読み込みだけ（Maps JS・Essentials・月10,000回無料）。

const LS = {
  name: 'sozoro.curate.name',
  pass: 'sozoro.curate.pass',
};
const MAX_ROWS = 400;      // リストに一度に描く上限
const MAX_PINS = 1200;     // 地図に置くピンの上限
const POLL_MS = 4000;
const UENO = { lat: 35.7156, lng: 139.7745 };

const $ = (id) => document.getElementById(id);
const state = {
  items: [], byId: new Map(),
  picks: new Map(),          // item_id -> 採った人の名前
  map: null, markers: new Map(), shown: [],
  me: '', pass: '',
};

// --- サーバとのやりとり -----------------------------------------------------

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { ...(opts.headers || {}), 'x-curate-password': state.pass,
               ...(opts.body ? { 'content-type': 'application/json' } : {}) },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

async function pull() {
  try {
    const s = await api('/state');
    state.picks = new Map(s.picks.map((p) => [p.item_id, p.by]));
    $('c-bunkazai').textContent = s.counts['文化財'] ?? 0;
    $('c-inshoku').textContent = s.counts['飲食店'] ?? 0;
    $('c-members').textContent = Object.entries(s.byMember)
      .map(([k, v]) => `${k} ${v}`).join(' / ') || '　';
    $('c-sync').textContent = '同期 ' + new Date().toLocaleTimeString('ja-JP');
    $('c-sync').classList.remove('bad');
    repaintPicks();
  } catch (e) {
    $('c-sync').textContent = '同期できない: ' + e.message;
    $('c-sync').classList.add('bad');
  }
}

/** 他の人の採用も反映されるので、描き直さず印だけ塗り替える。 */
function repaintPicks() {
  for (const li of document.querySelectorAll('#list li')) {
    const id = li.dataset.id;
    const by = state.picks.get(id);
    li.classList.toggle('picked', by != null);
    li.classList.toggle('by-other', by != null && by !== state.me);
    const cb = li.querySelector('input[type=checkbox]');
    if (cb) cb.checked = by != null;
    const tag = li.querySelector('.by');
    if (tag) tag.textContent = by ? `採用: ${by}` : '';
  }
  for (const [id, m] of state.markers) {
    const it = state.byId.get(id);
    if (it) m.setIcon(markerIcon(it));
  }
}

// --- 表示のための小道具 -----------------------------------------------------

function starText(it) {
  const g = it.google;
  if (!g) return '未照合';
  if (g.rating == null) return '評価なし';
  return `★${g.rating.toFixed(1)} (${g.reviews ?? 0})`;
}

// --- 絞り込み ---------------------------------------------------------------

function applyFilter() {
  const f = {
    bunkazai: $('f-bunkazai').checked, inshoku: $('f-inshoku').checked,
    congestion: $('f-congestion').checked, congm: parseInt($('f-congm').value, 10),
    rating: parseFloat($('f-rating').value), reviews: parseInt($('f-reviews').value, 10),
    unmatched: $('f-unmatched').checked,
    dmin: parseInt($('f-dmin').value, 10), dmax: parseInt($('f-dmax').value, 10),
    picked: $('f-picked').checked, q: $('q').value.trim().toLowerCase(),
    sort: $('sort').value,
  };

  const out = state.items.filter((it) => {
    if (it.kind === '文化財' && !f.bunkazai) return false;
    if (it.kind === '飲食店' && !f.inshoku) return false;
    if (f.picked && !state.picks.has(it.id)) return false;
    if (it.dist_ueno_m < f.dmin || it.dist_ueno_m > f.dmax) return false;
    if (f.q && !it.name.toLowerCase().includes(f.q)) return false;

    // 誰かが採ったものは、フィルタを変えても消えないほうが作業しやすい
    if (state.picks.has(it.id)) return true;

    // 混雑コアの中に人を送り込むのは SOZORO の目的と逆なので既定で外す
    if (f.congestion && it.congestion_m <= f.congm) return false;

    const g = it.google;
    if (!g || g.rating == null) return f.unmatched;
    if (g.rating < f.rating) return false;
    if ((g.reviews ?? 0) < f.reviews) return false;
    return true;
  });

  out.sort({
    rating: (a, b) => (b.google?.rating ?? 0) - (a.google?.rating ?? 0),
    reviews: (a, b) => (b.google?.reviews ?? 0) - (a.google?.reviews ?? 0),
    cong: (a, b) => b.congestion_m - a.congestion_m,
    dist: (a, b) => b.dist_ueno_m - a.dist_ueno_m,
    machiaza: (a, b) => (a.machiaza || '').localeCompare(b.machiaza || '', 'ja')
                       || (b.google?.rating ?? 0) - (a.google?.rating ?? 0),
  }[f.sort]);
  state.shown = out;
  return out;
}

// --- リスト -----------------------------------------------------------------

function badge(text, cls) {
  const s = document.createElement('span');
  s.className = 'badge' + (cls ? ' ' + cls : '');
  s.textContent = text;
  return s;
}

function renderList() {
  const ul = $('list');
  ul.textContent = '';
  const frag = document.createDocumentFragment();

  for (const it of state.shown.slice(0, MAX_ROWS)) {
    const by = state.picks.get(it.id);
    const li = document.createElement('li');
    li.dataset.id = it.id;
    if (by) li.classList.add('picked');
    if (by && by !== state.me) li.classList.add('by-other');

    const row = document.createElement('div');
    row.className = 'row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = by != null;
    cb.onclick = (e) => { e.stopPropagation(); togglePick(it); };
    const nm = document.createElement('span');
    nm.className = 'name';
    nm.textContent = it.name;
    const st = document.createElement('span');
    st.className = 'star' + (it.google?.rating == null ? ' none' : '');
    st.textContent = starText(it);
    row.append(cb, nm, st);

    const meta = document.createElement('div');
    meta.className = 'meta';
    for (const b of [it.category, it.machiaza, `上野 ${it.dist_ueno_m}m`]) {
      if (b) meta.append(badge(b));
    }
    meta.append(badge(`${it.congestion_near} ${it.congestion_m}m`,
                      it.congestion_m <= 500 ? 'hot' : ''));
    if (it.coord_quality === 'chome') meta.append(badge('座標が丁目代表点', 'chome'));
    if (it.google?.name && it.google.name !== it.name) {
      meta.append(badge(`Google: ${it.google.name}（${it.google.offset_m}m差）`));
    }
    const who = document.createElement('span');
    who.className = 'by';
    who.textContent = by ? `採用: ${by}` : '';
    meta.append(who);

    li.append(row, meta);
    li.onclick = () => openDetail(it, li);
    frag.append(li);
  }
  ul.append(frag);

  $('more').hidden = state.shown.length <= MAX_ROWS;
  $('more').textContent =
    `該当 ${state.shown.length}件のうち ${MAX_ROWS}件だけ出している。絞り込みを強めること。`;
  $('c-shown').textContent = state.shown.length;
}

/** 行を開く。写真は出さない方針なので、地図を寄せてリンクを足すだけ。 */
function openDetail(it, li) {
  document.querySelectorAll('#list li.active').forEach((e) => e.classList.remove('active'));
  li.classList.add('active');
  if (state.map) {
    state.map.panTo({ lat: it.lat, lng: it.lon });
    if (state.map.getZoom() < 16) state.map.setZoom(16);
  }
  if (li.querySelector('.detail')) return;

  const d = document.createElement('div');
  d.className = 'detail';
  li.append(d);

  const g = it.google;
  const q = encodeURIComponent(`${it.name} ${it.address || ''}`);
  const a = document.createElement('a');
  a.href = g?.maps_url || `https://www.google.com/maps/search/${q}`;
  a.target = '_blank'; a.rel = 'noopener';
  a.textContent = 'Google マップで開く';
  a.onclick = (e) => e.stopPropagation();
  d.append(a);

  if (!g) { d.append(badge('Google に照合できていない')); return; }
  d.append(badge(`${it.address || ''}`));
  if (g.type) d.append(badge(g.type));
  if (g.status && g.status !== 'OPERATIONAL') d.append(badge(g.status, 'hot'));
}

// --- 採用 -------------------------------------------------------------------

async function togglePick(it) {
  const had = state.picks.has(it.id);
  // まず手元を書き換えて、すぐ反応するようにする。失敗したら戻す
  if (had) state.picks.delete(it.id); else state.picks.set(it.id, state.me);
  repaintPicks();
  try {
    if (had) {
      await api('/pick?id=' + encodeURIComponent(it.id), { method: 'DELETE' });
    } else {
      await api('/pick', {
        method: 'POST',
        body: JSON.stringify({
          item_id: it.id, kind: it.kind, name: it.name, category: it.category,
          lat: it.lat, lon: it.lon, coord_quality: it.coord_quality,
          address: it.address, ward: it.ward, machiaza: it.machiaza,
          google_place_id: it.google?.place_id ?? null,
          google_rating: it.google?.rating ?? null,
          google_reviews: it.google?.reviews ?? null,
          google_lat: it.google?.lat ?? null,
          google_lon: it.google?.lon ?? null,
          picked_by: state.me,
        }),
      });
    }
    await pull();
  } catch (e) {
    if (had) state.picks.set(it.id, state.me); else state.picks.delete(it.id);
    repaintPicks();
    alert('保存できなかった: ' + e.message);
  }
}

// --- 地図 -------------------------------------------------------------------

/** 地図は「採用済みか、まだか」の2色だけ。誰が採ったかは地図では区別しない
 *  （進み具合を一目で見るための画面なので、色を増やすと読めなくなる）。
 *  星の高低は一覧の ★ で見る。 */
function markerIcon(it) {
  const picked = state.picks.has(it.id);
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: picked ? '#dc2626' : '#a8a29e',
    fillOpacity: picked ? 1 : 0.7,
    strokeColor: '#fff',
    strokeWeight: picked ? 2 : 1,
    scale: picked ? 8 : (it.kind === '文化財' ? 6 : 4.5),
  };
}

function renderMap() {
  for (const m of state.markers.values()) m.setMap(null);
  state.markers.clear();
  const pins = state.shown.slice(0, MAX_PINS);
  $('c-pins').textContent = state.shown.length > MAX_PINS
    ? `ピン ${pins.length}（${state.shown.length}件中・多すぎるので上限）`
    : `ピン ${pins.length}`;
  for (const it of pins) {
    const m = new google.maps.Marker({
      position: { lat: it.lat, lng: it.lon }, map: state.map,
      title: `${it.name}  ${starText(it)}`, icon: markerIcon(it), optimized: true,
    });
    m.addListener('click', () => {
      const li = document.querySelector(`#list li[data-id="${CSS.escape(it.id)}"]`);
      if (li) { li.scrollIntoView({ block: 'center' }); openDetail(it, li); }
      else state.map.panTo({ lat: it.lat, lng: it.lon });
    });
    state.markers.set(it.id, m);
  }
}

function loadMaps(key) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`
          + '&v=weekly&loading=async&language=ja&region=JP&callback=__mapsReady';
    s.async = true;
    window.__mapsReady = resolve;
    s.onerror = () => reject(new Error('Google マップを読み込めなかった。鍵を確認すること'));
    document.head.append(s);
  });
}

// --- 起動 -------------------------------------------------------------------

function refresh() { applyFilter(); renderList(); if (state.map) renderMap(); }

function gate() {
  return new Promise((resolve) => {
    $('g-name').value = localStorage.getItem(LS.name) || '';
    $('g-pass').value = localStorage.getItem(LS.pass) || '';
    $('g-go').onclick = async () => {
      const name = $('g-name').value.trim();
      const pass = $('g-pass').value;
      if (!name || !pass) return;
      $('g-err').hidden = true;
      try {
        state.pass = pass;
        await api('/login', { method: 'POST', body: '{}' });
      } catch (e) {
        $('g-err').textContent = e.message;
        $('g-err').hidden = false;
        return;
      }
      state.me = name;
      localStorage.setItem(LS.name, name);
      localStorage.setItem(LS.pass, pass);
      $('gate').hidden = true;
      resolve();
    };
  });
}

async function main() {
  const res = await fetch('data/curation.json');
  if (!res.ok) {
    document.body.textContent =
      'data/curation.json が無い。先に python3 scripts/curate_match.py を実行すること。';
    return;
  }
  state.items = (await res.json()).items;
  state.byId = new Map(state.items.map((i) => [i.id, i]));
  $('c-total').textContent = state.items.length;
  $('n-bunkazai').textContent = state.items.filter((i) => i.kind === '文化財').length;
  $('n-inshoku').textContent = state.items.filter((i) => i.kind === '飲食店').length;

  await gate();
  $('app').hidden = false;
  $('me').textContent = state.me;

  // Google をまだ取っていないと下限フィルタで全件消える。空画面は壊れて見えるので倒しておく
  if (!state.items.some((i) => i.google?.rating != null)) $('f-unmatched').checked = true;

  const ids = ['f-bunkazai', 'f-inshoku', 'f-congestion', 'f-congm', 'f-rating',
               'f-reviews', 'f-unmatched', 'f-dmin', 'f-dmax', 'f-picked', 'sort', 'q'];
  for (const id of ids) {
    $(id).addEventListener('input', () => {
      $('v-cong').textContent = $('f-congm').value;
      $('v-rating').textContent = $('f-rating').value;
      $('v-reviews').textContent = $('f-reviews').value;
      $('v-dmin').textContent = $('f-dmin').value;
      $('v-dmax').textContent = $('f-dmax').value;
      refresh();
    });
  }
  // 書き出しは合言葉が要るので、その場で取ってから保存させる
  for (const [id, file] of [['ex-csv', 'export.csv'], ['ex-json', 'export.json'],
                            ['ex-sql', 'export.sql']]) {
    $(id).onclick = async (e) => {
      e.preventDefault();
      const r = await fetch('/api/' + file, { headers: { 'x-curate-password': state.pass } });
      if (!r.ok) return alert('書き出せなかった');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await r.blob());
      a.download = file.replace('export', 'curated');
      a.click();
      URL.revokeObjectURL(a.href);
    };
  }

  await pull();
  refresh();
  setInterval(pull, POLL_MS);

  // 鍵はサーバから受け取る。メンバーは何も設定しない
  try {
    const { mapsKey } = await api('/config');
    if (!mapsKey) {
      $('map').textContent =
        'サーバに GOOGLE_MAPS_KEY が入っていないので地図が出せない。'
        + '（wrangler secret put GOOGLE_MAPS_KEY）リストだけなら作業できる。';
      return;
    }
    await loadMaps(mapsKey);
    state.map = new google.maps.Map($('map'), {
      center: UENO, zoom: 15, mapTypeControl: false, streetViewControl: false,
    });
    new google.maps.Marker({
      position: UENO, map: state.map, title: '上野公園（起点）',
      icon: { path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW, scale: 5,
              fillColor: '#0ea5e9', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
    });
    renderMap();
  } catch (e) {
    $('map').textContent = e.message;
  }
}

main();
