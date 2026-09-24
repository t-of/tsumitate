// 画面・操作・グラフの描画。計算は calc.js。
import * as C from './calc.js';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'tsumitate.' で始める。
const STORE = 'tsumitate.';

function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても使える */ }
}

WebAppKit.init({ title: '積立投資シミュレーター', text: '毎月の積み立て、何年後にいくら。仮の条件での計算です。' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// ---- 音（RULES.md §5「音」） ----
// 音を使うときは、鳴らす前と音の設定を切り替えたときにこれを呼ぶ。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}

let soundOn = load('sound', true) !== false;
let ctx = null;
let lastTick = 0;

// 短い「コッ」。height 0..1 で音程を変える（値が大きいほど高く）
function tick(height = 0.5) {
  if (!soundOn) return;
  const now = performance.now();
  if (now - lastTick < 45) return;   // スライダーを速く動かしても鳴りすぎない
  lastTick = now;
  try {
    setAudioSession(true);
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = 440 * 2 ** (height * 2);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.07);
  } catch { /* 音が出せなくても使える */ }
}

const $ = (id) => document.getElementById(id);
const soundBtn = $('soundBtn');
function showSound() {
  soundBtn.textContent = soundOn ? '音 オン' : '音 オフ';
  soundBtn.setAttribute('aria-pressed', String(soundOn));
}
soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  save('sound', soundOn);
  setAudioSession(soundOn);
  showSound();
  tick(0.7);
});
showSound();

// ---- 入力 ----
let st = C.sanitize(load('inputs', null));
let res = null;       // 計算の結果
let focusYear = null; // グラフをなぞっている年（null = 最後の年）

const el = {
  monthly: $('monthly'), monthlyText: $('monthlyText'),
  rate: $('rate'), rateText: $('rateText'),
  years: $('years'), yearsText: $('yearsText'),
  age: $('age'), cap: $('cap'),
};

for (let a = C.LIMITS.age.min; a <= C.LIMITS.age.max; a++) el.age.add(new Option(`${a} 歳`, String(a)));

const [ay, am] = C.RULE.asOf.split('-').map(Number);
$('capNote').textContent = `${ay} 年 ${am} 月時点の NISA の生涯の枠`;
$('capHelp').innerHTML = `上限 1,800 万円は ${ay} 年 ${am} 月時点の NISA の生涯の枠です。制度は変わることがあります。最新の内容は <a href="https://www.fsa.go.jp/policy/nisa2/" target="_blank" rel="noopener">金融庁の NISA 特設ウェブサイト</a> で確かめてください。`;

function set(patch) {
  st = { ...st, ...patch };
  save('inputs', st);
  update();
  // 結果が大きいほど高い音
  tick(Math.min(1, Math.log10(1 + res.bal.at(-1) / 1e6) / 2.5));
}

// つまみ 1 段ぶん
function step(knob, dir) {
  if (knob === 'monthly') set({ monthly: C.stepMonthly(st.monthly, dir) });
  if (knob === 'rate') set({ rate: Math.min(10, Math.max(0, Math.round((st.rate + dir * 0.1) * 10) / 10)) });
  if (knob === 'years') set({ years: Math.min(50, Math.max(1, st.years + dir)) });
}

el.monthly.addEventListener('input', () => set({ monthly: C.MONTHLY_STEPS[Number(el.monthly.value)] }));
el.rate.addEventListener('input', () => set({ rate: Number(el.rate.value) }));
el.years.addEventListener('input', () => set({ years: Number(el.years.value) }));
el.age.addEventListener('change', () => set({ age: el.age.value === '' ? null : Number(el.age.value) }));
el.cap.addEventListener('change', () => set({ cap: el.cap.checked }));

// 金額の数字をタップすると、ちょうどの額を入れられる
el.monthlyText.addEventListener('focus', () => { el.monthlyText.value = String(st.monthly); el.monthlyText.select(); });
el.monthlyText.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.monthlyText.blur(); });
el.monthlyText.addEventListener('blur', () => set({ monthly: C.parseMonthly(el.monthlyText.value, st.monthly) }));

// − / ＋。押すと 1 段、長押しで続けて動く。キーボードの Enter / Space は click で 1 段
document.querySelectorAll('.step').forEach((b) => {
  const knob = b.dataset.knob, dir = Number(b.dataset.dir);
  let timer = null;
  const stop = () => { clearTimeout(timer); timer = null; };
  const repeat = (wait) => { timer = setTimeout(() => { step(knob, dir); repeat(70); }, wait); };
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    step(knob, dir);
    repeat(400);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => b.addEventListener(t, stop));
  b.addEventListener('click', (e) => { if (e.detail === 0) step(knob, dir); });
  b.addEventListener('contextmenu', (e) => e.preventDefault());   // 長押しでメニューを出さない
});

// ---- 表示 ----
const about = (x) => (x === 0 ? C.yen(x) : `約 ${C.yen(x)}`);   // 0 円のときは「約」を付けない
const ageOf = (y) => (st.age == null ? '' : `（${st.age + y} 歳）`);

function update() {
  res = C.simulate(st);

  el.monthly.value = String(C.monthlyIndex(st.monthly));
  if (document.activeElement !== el.monthlyText) el.monthlyText.value = st.monthly.toLocaleString('ja-JP');
  el.rate.value = String(st.rate);
  el.rateText.textContent = `${st.rate.toFixed(1)} %`;
  el.years.value = String(st.years);
  el.yearsText.textContent = `${st.years} 年`;
  el.age.value = st.age == null ? '' : String(st.age);
  el.cap.checked = st.cap;

  const b = res.bal.at(-1);
  $('withdraw').innerHTML = `年 ${st.rate.toFixed(1)} % でふえ続けたとして、残高を減らさずに毎月使える額の目安 <b>${about(C.withdrawal(b, st.rate))}</b>`;
  const capAt = $('capAt');
  capAt.hidden = !st.cap;
  if (res.capMonth != null) {
    const age = st.age == null ? '' : `（${st.age + Math.floor(res.capMonth / 12)} 歳ごろ）`;
    capAt.innerHTML = `始めてから <b>${C.capTime(res.capMonth)}</b> で上限に届く${age}`;
  } else {
    capAt.textContent = `${st.years} 年では上限 1,800 万円に届かない`;
  }

  $('shareBtn').dataset.wakText =
    `積立投資シミュレーターで計算: 毎月 ${st.monthly.toLocaleString('ja-JP')} 円・年 ${st.rate.toFixed(1)} %・${st.years} 年 → ${about(b)}（入れたお金 ${about(res.paid.at(-1))}）。仮の条件での計算です。`;

  focusYear = null;
  showYear();
  draw();
}

// 結果の欄（なぞっている年、なければ最後の年）
function showYear() {
  const y = focusYear ?? st.years;
  const b = res.bal[y], p = res.paid[y], g = b - p;
  $('when').textContent = `${y} 年後${ageOf(y)}`;
  $('total').textContent = about(b);
  $('paid').textContent = about(p);
  $('gain').textContent = about(g);
  $('barPaid').style.flexGrow = String(b ? p / b : 1);
  $('barGain').style.flexGrow = String(b ? g / b : 0);
  announceResult(y, b);
}

// スライダーを動かしている間・グラフをなぞっている間は読み上げず、止まってから 1 回だけ短く読ませる
// （aria-live をつまみの動きのたびに更新すると、動かすたびに読み上げが続いてしまうため）
let announceTimer = null;
function announceResult(y, b) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    $('srResult').textContent = `${y} 年後${ageOf(y)}、${about(b)}になる計算`;
  }, 500);
}

// ---- グラフ（自前の SVG。年ごとの積み上げ棒） ----
const svg = $('svg');
const NS = 'http://www.w3.org/2000/svg';
const H = 220, PAD = { r: 8, t: 22, b: 24 };
let geo = null;   // なぞるときに使う棒の位置

function node(tag, attrs, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  svg.appendChild(e);
  return e;
}

// 目盛りの間隔: 1・2・5 × 10^k で、4 本前後になるもの
function niceStep(max) {
  const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
}
const manLabel = (v) => (v / 1e4).toLocaleString('ja-JP', { maximumFractionDigits: 1 });

function draw() {
  const W = Math.max(200, svg.clientWidth || 358);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();
  const n = st.years, top = Math.max(...res.bal) || 1;
  const stepV = niceStep(top), maxV = Math.ceil(top / stepV) * stepV;
  const ticks = [];
  for (let i = 0; i * stepV <= maxV + 1e-6; i++) ticks.push(i * stepV);

  // 目盛りの文字幅を測り、いちばん長いもの（例: 「600,000」）が切れないよう左の余白を合わせる
  const probe = node('text', { class: 'tick', x: -999, y: -999 });
  let maxW = 0;
  for (const v of ticks) { probe.textContent = manLabel(v); maxW = Math.max(maxW, probe.getComputedTextLength()); }
  probe.remove();
  const padL = Math.max(34, Math.ceil(maxW) + 10);

  const pw = W - padL - PAD.r, ph = H - PAD.t - PAD.b;
  const Y = (v) => PAD.t + ph - (v / maxV) * ph;
  const slot = pw / n, bw = Math.max(1, slot * (n > 30 ? 0.72 : 0.62));
  geo = { x0: padL, slot, n };

  // 横の目盛り（万円）
  for (const v of ticks) {
    node('line', { x1: padL, x2: W - PAD.r, y1: Y(v), y2: Y(v), class: v ? 'grid' : 'axis' });
    node('text', { x: padL - 6, y: Y(v) + 4, class: 'tick', 'text-anchor': 'end' }, manLabel(v));
  }
  node('text', { x: 2, y: 12, class: 'unit' }, '万円');

  // 棒（下 = 入れたお金、上 = ふえたぶん）
  const hi = focusYear ?? n;
  for (let y = 1; y <= n; y++) {
    const x = padL + slot * (y - 0.5) - bw / 2;
    const on = y === hi ? ' is-on' : '';
    node('rect', { x, y: Y(res.paid[y]), width: bw, height: Y(0) - Y(res.paid[y]), class: 'bar-paid' + on });
    node('rect', { x, y: Y(res.bal[y]), width: bw, height: Math.max(0, Y(res.paid[y]) - Y(res.bal[y])), class: 'bar-gain' + on });
  }

  // 横軸（年後、年齢があれば歳）
  const every = [1, 2, 5, 10].find((k) => n / k <= 6);
  for (let y = every; y <= n; y += every) {
    node('text', { x: padL + slot * (y - 0.5), y: H - 8, class: 'tick', 'text-anchor': 'middle' }, String(st.age == null ? y : st.age + y));
  }
  node('text', { x: 2, y: H - 8, class: 'unit' }, st.age == null ? '年後' : '歳');

  // 上限に届いた年に点線
  if (res.capMonth != null) {
    const x = padL + slot * (Math.ceil(res.capMonth / 12) - 0.5);
    node('line', { x1: x, x2: x, y1: PAD.t - 4, y2: Y(0), class: 'cap-line' });
    const right = x > W - 70;
    node('text', { x: right ? x - 4 : x + 4, y: PAD.t - 8, class: 'cap-label', 'text-anchor': right ? 'end' : 'start' }, '上限に届く');
  }
}

// なぞると、その年の棒を強めて結果の欄をその年の値に。離すと最後の年に戻る
function scrub(e) {
  const r = svg.getBoundingClientRect();
  const x = (e.clientX - r.left) * (svg.viewBox.baseVal.width / r.width);
  const y = Math.min(geo.n, Math.max(1, Math.floor((x - geo.x0) / geo.slot) + 1));
  if (y === (focusYear ?? st.years)) return;
  focusYear = y;
  tick(0.25 + 0.5 * y / geo.n);
  showYear();
  draw();
}
function release() {
  if (focusYear == null) return;
  focusYear = null;
  showYear();
  draw();
}
svg.addEventListener('pointerdown', scrub);
svg.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) scrub(e); });
['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => svg.addEventListener(t, release));

window.addEventListener('resize', draw);

// ---- 計算のしかた・注意（下から出るシート） ----
const help = $('help');
$('helpBtn').addEventListener('click', () => { help.showModal(); tick(0.6); });
help.addEventListener('click', (e) => { if (e.target === help) help.close(); });   // 外をタップで閉じる

update();
