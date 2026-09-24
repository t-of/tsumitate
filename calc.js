// 積立投資シミュレーターの中身。画面（DOM）に触らない部分をここに集める。
// main.js（ブラウザ）と test.mjs（node）の両方から読む。

// 制度の数値はここだけ。毎年 12 月と 4 月ごろに金融庁の NISA 特設ウェブサイトと見比べる（仕様 §3）。
export const RULE = { asOf: '2026-09', lifetimeCap: 18_000_000, monthlyMax: 300_000 }; // 成年の NISA（2024 年〜）

// 毎月の額のスライダーの 27 段（仕様 §3「入力」）
export const MONTHLY_STEPS = [
  ...range(1_000, 10_000, 1_000),
  ...range(15_000, 50_000, 5_000),
  ...range(60_000, 100_000, 10_000),
  ...range(150_000, RULE.monthlyMax, 50_000),
];
function range(a, b, d) { const out = []; for (let x = a; x <= b; x += d) out.push(x); return out; }

export const LIMITS = {
  monthly: { min: 1_000, max: RULE.monthlyMax },
  rate: { min: 0, max: 10 },
  years: { min: 1, max: 50 },
  age: { min: 0, max: 99 },
};
export const DEFAULTS = { v: 1, monthly: 10_000, rate: 3, years: 30, age: null, cap: true };

// ---- 計算（仕様 §3「計算」。試作と同じ） ----
// 入力 → 年ごとの残高 bal[y]・入れたお金 paid[y]（y = 0..years、y = 0 は 0）、上限に届いた月 capMonth（届かなければ null）
export function simulate({ monthly, rate, years, cap }) {
  const i = rate / 100 / 12;
  let b = 0, p = 0, capMonth = null;
  const bal = [0], paid = [0];
  for (let k = 1; k <= years * 12; k++) {
    b *= 1 + i;                                   // 先に 1 か月ぶん増える
    if (!cap || p < RULE.lifetimeCap) {
      const a = cap ? Math.min(monthly, RULE.lifetimeCap - p) : monthly;
      b += a; p += a;                             // 月の終わりに入れる
      if (cap && p >= RULE.lifetimeCap && capMonth == null) capMonth = k;
    }
    if (k % 12 === 0) { bal.push(b); paid.push(p); }
  }
  return { bal, paid, capMonth };
}

// 取り崩しの目安: 年 rate % でふえ続けたとして、残高を減らさずに毎月使える額（円、四捨五入）
export const withdrawal = (balance, rate) => Math.round(balance * rate / 100 / 12);

// ---- 表示 ----
const num = (n) => n.toLocaleString('ja-JP');

// 10 万円以上は万円に、1 億円以上は「1 億 2,345 万円」、10 万円未満は 100 円単位（仕様 §3「表示の決まり」）。「約」は付けない
export function yen(x) {
  if (x < 100_000) return `${num(Math.round(x / 100) * 100)} 円`;
  const man = Math.round(x / 10_000);
  if (man < 10_000) return `${num(man)} 万円`;
  const oku = Math.floor(man / 10_000), rest = man % 10_000;
  return rest ? `${num(oku)} 億 ${num(rest)} 万円` : `${num(oku)} 億円`;
}

export const capTime = (m) => `${Math.floor(m / 12)} 年 ${m % 12} か月`;

// ---- 入力 ----
const clamp = (x, { min, max }) => Math.min(max, Math.max(min, x));

// 数字の入力欄の文字 → 毎月の額。100 円単位に丸め、範囲の端に寄せる。読めなければ prev のまま
export function parseMonthly(text, prev) {
  const s = String(text).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[,，\s円]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return prev;
  return clamp(Math.round(Number(s) / 100) * 100, LIMITS.monthly);
}

// − / ＋ で 1 段動かす。段の間の値（タップで入れた額）からは、となりの段へ
export function stepMonthly(value, dir) {
  if (dir > 0) return MONTHLY_STEPS.find((s) => s > value) ?? RULE.monthlyMax;
  return MONTHLY_STEPS.findLast((s) => s < value) ?? MONTHLY_STEPS[0];
}

// スライダーの位置（0..26）。段の間の値はいちばん近い段に置く
export function monthlyIndex(value) {
  let best = 0;
  MONTHLY_STEPS.forEach((s, i) => { if (Math.abs(s - value) < Math.abs(MONTHLY_STEPS[best] - value)) best = i; });
  return best;
}

// 保存してあった値を確かめる。読めない・範囲の外のものは最初の値に戻す
export function sanitize(o) {
  const d = DEFAULTS;
  if (!o || typeof o !== 'object' || o.v !== 1) return { ...d };
  const inRange = (x, lim) => Number.isFinite(x) && x >= lim.min && x <= lim.max;
  return {
    v: 1,
    monthly: inRange(o.monthly, LIMITS.monthly) && o.monthly % 100 === 0 ? o.monthly : d.monthly,
    rate: inRange(o.rate, LIMITS.rate) ? Math.round(o.rate * 10) / 10 : d.rate,
    years: inRange(o.years, LIMITS.years) && Number.isInteger(o.years) ? o.years : d.years,
    age: o.age === null || (inRange(o.age, LIMITS.age) && Number.isInteger(o.age)) ? o.age : d.age,
    cap: typeof o.cap === 'boolean' ? o.cap : d.cap,
  };
}
