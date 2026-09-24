// node test.mjs — 画面を使わない部分のテスト（仕様 §3 の値の表・閉じた式・表示・入力・保存）
import assert from 'node:assert/strict';
import * as C from './calc.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok ${name}`); };
const last = (r) => ({ b: r.bal.at(-1), p: r.paid.at(-1) });

test('値の表 1: 毎月 1 万・3 %・42 年・上限オン', () => {
  const r = C.simulate({ monthly: 10_000, rate: 3, years: 42, cap: true });
  // 仕様の表は「約 10,079,529 円」。閉じた式でも 10,079,530.16 円なので、2 円の幅で見る
  assert.ok(Math.abs(last(r).b - 10_079_529) < 2, String(last(r).b));
  assert.equal(last(r).p, 5_040_000);
  assert.equal(r.capMonth, null);
});

test('値の表 2: 毎月 30 万・0 %・10 年・上限オン → 60 か月目で届く', () => {
  const r = C.simulate({ monthly: 300_000, rate: 0, years: 10, cap: true });
  assert.equal(last(r).b, 18_000_000);
  assert.equal(last(r).p, 18_000_000);
  assert.equal(r.capMonth, 60);
  assert.equal(C.capTime(r.capMonth), '5 年 0 か月');
});

test('値の表 3: 毎月 30 万・0 %・10 年・上限オフ', () => {
  const r = C.simulate({ monthly: 300_000, rate: 0, years: 10, cap: false });
  assert.equal(last(r).b, 36_000_000);
  assert.equal(last(r).p, 36_000_000);
  assert.equal(r.capMonth, null);
});

test('値の表 4: 毎月 1 万・0 %・1 年・上限オン', () => {
  const r = C.simulate({ monthly: 10_000, rate: 0, years: 1, cap: true });
  assert.deepEqual(r.bal, [0, 120_000]);
  assert.deepEqual(r.paid, [0, 120_000]);
  assert.equal(r.capMonth, null);
});

test('上限に届かないときは閉じた式と 1 円以内', () => {
  for (const [m, rate, y] of [[10_000, 3, 30], [50_000, 7.5, 25], [1_000, 10, 50], [250_000, 0.1, 5]]) {
    const i = rate / 100 / 12, k = y * 12;
    const r = C.simulate({ monthly: m, rate, years: y, cap: true });
    assert.ok(last(r).p < C.RULE.lifetimeCap);
    assert.ok(Math.abs(last(r).b - m * ((1 + i) ** k - 1) / i) < 1, `${m} ${rate} ${y}`);
  }
});

test('上限に届いたあとは入れずにふえるだけ・年ごとに年数 + 1 点', () => {
  const r = C.simulate({ monthly: 150_000, rate: 5, years: 20, cap: true });
  assert.equal(r.bal.length, 21);
  assert.equal(r.capMonth, 120);
  assert.equal(r.paid[10], 18_000_000);
  assert.equal(r.paid[20], 18_000_000);
  assert.ok(Math.abs(r.bal[20] - r.bal[10] * (1 + 0.05 / 12) ** 120) < 1e-3);
  // 端数の月: 毎月 7 万 → 257 回で 1,799 万、258 回目は 1 万だけ
  const s = C.simulate({ monthly: 70_000, rate: 0, years: 30, cap: true });
  assert.equal(s.capMonth, 258);
  assert.equal(s.paid.at(-1), 18_000_000);
});

test('取り崩しの目安', () => {
  const r = C.simulate({ monthly: 10_000, rate: 3, years: 30, cap: true });
  assert.equal(C.yen(r.bal.at(-1)), '583 万円');           // 仕様 §4 の例
  assert.equal(C.yen(C.withdrawal(r.bal.at(-1), 3)), '14,600 円');
  assert.equal(C.withdrawal(1_000_000, 0), 0);
});

test('金額の表示', () => {
  assert.equal(C.yen(0), '0 円');
  assert.equal(C.yen(14_567), '14,600 円');
  assert.equal(C.yen(99_949), '99,900 円');
  assert.equal(C.yen(100_000), '10 万円');
  assert.equal(C.yen(10_079_529), '1,008 万円');
  assert.equal(C.yen(99_995_000), '1 億円');               // 万に丸めて 1 億になるもの
  assert.equal(C.yen(123_450_000), '1 億 2,345 万円');
  assert.equal(C.yen(5_200_010_000), '52 億 1 万円');
});

test('毎月の額の入力', () => {
  assert.equal(C.MONTHLY_STEPS.length, 27);
  assert.equal(C.parseMonthly('12,345', 1), 12_300);
  assert.equal(C.parseMonthly('１２３４５円', 1), 12_300);
  assert.equal(C.parseMonthly('5', 1), 1_000);
  assert.equal(C.parseMonthly('9999999', 1), 300_000);
  assert.equal(C.parseMonthly('', 7), 7);
  assert.equal(C.parseMonthly('abc', 7), 7);
  assert.equal(C.parseMonthly('-100', 7), 7);
  assert.equal(C.stepMonthly(10_000, 1), 15_000);
  assert.equal(C.stepMonthly(12_300, 1), 15_000);
  assert.equal(C.stepMonthly(12_300, -1), 10_000);
  assert.equal(C.stepMonthly(300_000, 1), 300_000);
  assert.equal(C.stepMonthly(1_000, -1), 1_000);
  assert.equal(C.MONTHLY_STEPS[C.monthlyIndex(12_300)], 10_000);
  assert.equal(C.MONTHLY_STEPS[C.monthlyIndex(13_000)], 15_000);
});

test('保存した値の確かめ', () => {
  assert.deepEqual(C.sanitize(null), C.DEFAULTS);
  assert.deepEqual(C.sanitize({ v: 2, monthly: 20_000 }), C.DEFAULTS);
  const ok = { v: 1, monthly: 12_300, rate: 4.5, years: 12, age: 40, cap: false };
  assert.deepEqual(C.sanitize(ok), ok);
  assert.deepEqual(C.sanitize({ v: 1, monthly: 500, rate: 11, years: 0.5, age: 120, cap: 'yes' }), C.DEFAULTS);
  assert.equal(C.sanitize({ ...ok, age: null }).age, null);
});

console.log(`${n} 件 ok`);
