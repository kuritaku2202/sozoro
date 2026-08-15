// ランドマークの混雑を推定する。
//
// リアルタイムの混雑データは公開されていない（東京都カタログを検索しても
// 使えるものは無い）。そこでオープンデータから統計的に推定する。
//
//   混雑スコア = エリア基礎値 × 時間帯係数 × 曜日係数 × 季節係数 × 天候係数
//
// エリア基礎値と季節係数は実測（台東区来訪者アンケート／デジタル観光統計）。
// 時間帯係数は台東区の公式記述に合わせた二次情報。曜日係数は公式の根拠が
// 取れなかったので 1.0 で無効化してある。どちらも ODPT の駅時刻表で差し替える。
// data/congestion.json の provisional フラグがその区別を持っている。

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

let model = null;

// デモ用の時刻上書き。審査で触ってもらうとき、閑散期・夕方だと「混んでいます」が
// 出ずに中核の体験が見えないので、日時を動かせるようにしておく。
// null のときは実時刻を使う（＝実運用の挙動）。
let clockOverride = null;

/** デモ用に「いま」を上書きする。null を渡すと実時刻に戻る。 */
export function setDemoTime(date) {
  clockOverride = date ? new Date(date) : null;
}

/** 上書きされているかどうか。画面に「デモ表示中」を出すために使う。 */
export function isDemoTime() {
  return clockOverride !== null;
}

/** いまの日時。デモ上書きがあればそちらを返す。 */
export function now() {
  return clockOverride ? new Date(clockOverride) : new Date();
}

/** 係数ファイルを読み込む。1度読んだらメモリに残す。 */
export async function loadModel(url = './data/congestion.json') {
  if (!model) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`混雑モデルを読めない: ${res.status}`);
    model = await res.json();
  }
  return model;
}

/** テスト用。読み込み済みのモデルを直接差し込む。 */
export function setModel(m) {
  model = m;
}

/** モデルが持っているランドマークの一覧（座標つき）。 */
export function landmarks() {
  return model.landmarks;
}

function levelOf(score) {
  return model.levels.find((l) => score <= l.max) ?? model.levels.at(-1);
}

/**
 * 1つのランドマークの混雑を推定する。
 * @param {object} landmark  model.landmarks の要素
 * @param {Date}   at        推定したい日時
 * @param {string} weather   '晴' | 'くもり' | '雨' | '雪'
 */
export function estimate(landmark, at = now(), weather = '晴') {
  const hour = model.hour.value[at.getHours()] ?? 1;
  const dow = model.dow.value[DOW[at.getDay()]] ?? 1;
  const month = model.month.value[at.getMonth() + 1] ?? 1;
  const wx = model.weather.value[weather] ?? 1;

  const score = landmark.base * hour * dow * month * wx;
  const level = levelOf(score);
  return {
    id: landmark.id,
    name: landmark.name,
    score: Math.round(score * 1000) / 1000,
    label: level.label,
    color: level.color,
    peakRange: model.peak_range,
    // 実測でないエリアは画面上でも断定を避けたいので持ち回す
    estimated: Boolean(landmark.estimated),
  };
}

/** 全ランドマークを推定して、混んでいる順に返す。 */
export function estimateAll(at = now(), weather = '晴') {
  return model.landmarks
    .map((lm) => estimate(lm, at, weather))
    .sort((a, b) => b.score - a.score);
}

/**
 * いま混雑しているランドマークのうち、最も混んでいるものを返す。
 * ホーム画面で「今、雷門は混んでいます」を出すかどうかの判定に使う。
 */
export function mostCrowded(at = now(), weather = '晴') {
  const top = estimateAll(at, weather)[0];
  return top && top.label === '混雑' ? top : null;
}

/**
 * その日のうち、いま以降でスコアが最も下がる時刻を返す（オフピークの提案用）。
 * 「ピークは14時ごろ」「17時以降は落ち着きます」のような文言に使う。
 */
export function offPeakHint(landmark, at = now(), weather = '晴') {
  const hours = [];
  for (let h = at.getHours() + 1; h <= 21; h += 1) {
    const t = new Date(at);
    t.setHours(h, 0, 0, 0);
    hours.push({ hour: h, ...estimate(landmark, t, weather) });
  }
  const [from, to] = model.peak_range;
  const peakText = `ピークは${from}〜${to}時ごろ`;
  if (hours.length === 0) {
    return { peakRange: model.peak_range, peakText, calmestHour: null, firstCalmHour: null };
  }
  const calm = hours.find((h) => h.label !== '混雑');
  return {
    peakRange: model.peak_range,
    peakText,
    calmestHour: hours.reduce((a, b) => (b.score < a.score ? b : a)).hour,
    firstCalmHour: calm ? calm.hour : null,
  };
}

/** 気象庁の予報APIから東京地方の天気を取る。鍵は要らない。 */
export async function fetchWeather() {
  const URL = 'https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json';
  try {
    const res = await fetch(URL);
    const text = (await res.json())[0].timeSeries[0].areas[0].weathers[0];
    if (text.includes('雪')) return '雪';
    if (text.includes('雨')) return '雨';
    if (text.includes('くもり') || text.includes('曇')) return 'くもり';
    return '晴';
  } catch {
    return '晴'; // 取れなくても推定は続ける
  }
}

/**
 * ホーム画面に出すカードを組み立てる。
 *
 * 混んでいるときは「不満の提示」から始める（SOZORO の入口）。
 * 混んでいないときは黙るのではなく、落ち着いている事実を伝えて散歩に誘う。
 * 常に「混んでいます」と言うアプリは信用されないので、ここは必ず出し分ける。
 */
export function homeCard(at = now(), weather = '晴') {
  const ranked = estimateAll(at, weather);
  const top = ranked[0];
  const hint = offPeakHint(model.landmarks.find((l) => l.id === top.id), at, weather);
  const quiet = ranked.filter((r) => r.label === '空いている').map((r) => r.name);

  if (top.label === '混雑') {
    const calm = hint.firstCalmHour;
    return {
      kind: 'crowded',
      landmark: top,
      title: `今、${top.name}は混んでいます`,
      body: calm ? `${calm}時ごろには落ち着きます。その時間、外しませんか` : 'その時間、外しませんか',
      cta: '空き時間で行ける場所を探す',
      quiet,
      demo: isDemoTime(),
    };
  }
  // ピークを過ぎた後に「混む前にどうぞ」と言うと嘘になるので、時間帯で言い分ける
  const [, peakEnd] = model.peak_range;
  const body =
    at.getHours() > peakEnd
      ? `${top.name}あたりも今なら歩けます。今日のピーク（${hint.peakText.replace('ピークは', '')}）は過ぎました`
      : `${top.name}あたりも今なら歩けます。${hint.peakText}なので、混む前にどうぞ`;
  return {
    kind: 'calm',
    landmark: top,
    title: '今は落ち着いています',
    body,
    cta: '空き時間で行ける場所を探す',
    quiet,
    demo: isDemoTime(),
  };
}
