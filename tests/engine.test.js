const assert = require('assert');
const E = require('../engine.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}
const profile = (o) => Object.assign({ cycleLen: 28, periodLen: 5, lutealLen: 14, irregular: false }, o || {});
// Build logs from period start dates, each `len` days long
function logsFrom(starts, len) {
  const logs = {};
  starts.forEach((s) => { for (let i = 0; i < (len || 5); i++) logs[E.add(s, i)] = { period: true }; });
  return logs;
}
function starts(first, lens) { const out = [first]; lens.forEach((L) => out.push(E.add(out[out.length - 1], L))); return out; }

test('date math survives daylight-saving changes', () => {
  assert.strictEqual(E.diff('2026-03-09', '2026-03-08'), 1);
  assert.strictEqual(E.diff('2026-11-02', '2026-11-01'), 1);
  assert.strictEqual(E.add('2026-03-01', 30), '2026-03-31');
  assert.strictEqual(E.add('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(E.diff('2027-03-01', '2026-03-01'), 365);
});

test('period days group into periods, tolerating a 1-2 day gap', () => {
  const logs = { '2026-10-01': { period: true }, '2026-10-02': { period: true }, '2026-10-04': { period: true }, '2026-10-29': { period: true } };
  const p = E.derivePeriods(logs);
  assert.strictEqual(p.length, 2);
  assert.strictEqual(p[0].length, 4);
  assert.strictEqual(p[1].start, '2026-10-29');
});

test('regular 28-day cycles predict exactly 28 days ahead', () => {
  const st = starts('2026-06-01', [28, 28, 28, 28]); // last start 2026-09-21
  const a = E.analyze({ profile: profile(), logs: logsFrom(st) }, '2026-10-01');
  assert.strictEqual(a.nextStart, '2026-10-19');
  assert.strictEqual(a.cycleDay, 11);
  assert.strictEqual(a.unc, 2);
});

test('ovulation is ~14 days before the next period (cycle day 14 of a 28-day cycle)', () => {
  const st = starts('2026-06-01', [28, 28, 28, 28]);
  const a = E.analyze({ profile: profile(), logs: logsFrom(st) }, '2026-10-01');
  assert.strictEqual(E.diff(a.ovDate, a.last.start) + 1, 14);
  assert.strictEqual(a.fertStart, E.add(a.ovDate, -5));
  assert.strictEqual(a.fertEnd, E.add(a.ovDate, 1));
});

test('a single logged cycle blends with the user estimate instead of overreacting', () => {
  const st = starts('2026-08-01', [31]);
  const l = E.learn(E.derivePeriods(logsFrom(st)), profile({ cycleLen: 28 }), '2026-09-15', logsFrom(st));
  assert.ok(Math.abs(l.len - 29) < 0.01, 'expected ~29, got ' + l.len);
});

test('recent cycles weigh more than old ones', () => {
  const st = starts('2026-01-01', [35, 35, 35, 28, 28, 28]);
  const l = E.learn(E.derivePeriods(logsFrom(st)), profile(), '2026-09-01', logsFrom(st));
  assert.ok(l.len < 31.5 && l.len > 28, 'got ' + l.len);
});

test('one forgotten log (a 56-day "cycle") does not wreck the prediction', () => {
  const st = starts('2026-01-01', [28, 28, 56, 28, 28]);
  const l = E.learn(E.derivePeriods(logsFrom(st)), profile(), '2026-09-01', logsFrom(st));
  assert.ok(Math.abs(l.len - 28) < 0.5, 'got ' + l.len);
});

test('irregular cycles widen the uncertainty window', () => {
  const st = starts('2026-01-01', [24, 35, 27, 40, 30]);
  const a = E.analyze({ profile: profile(), logs: logsFrom(st) }, E.add(st[st.length - 1], 10));
  assert.ok(a.unc >= 5, 'unc ' + a.unc);
});

test('late period is detected', () => {
  const st = starts('2026-06-01', [28, 28, 28]);
  const a = E.analyze({ profile: profile(), logs: logsFrom(st) }, E.add(a0(st), 31));
  assert.strictEqual(a.late, 3);
  assert.strictEqual(a.phase, 'late');
  function a0(s) { return s[s.length - 1]; }
});

test('phase walks period -> follicular -> fertile -> luteal', () => {
  const st = starts('2026-06-01', [28, 28, 28]);
  const logs = logsFrom(st);
  const last = st[st.length - 1];
  const ph = (n) => E.analyze({ profile: profile(), logs }, E.add(last, n)).phase;
  assert.strictEqual(ph(1), 'period');
  assert.strictEqual(ph(7), 'follicular');
  assert.strictEqual(ph(10), 'fertile');
  assert.strictEqual(ph(13), 'ovulation');
  assert.strictEqual(ph(20), 'luteal');
});

test('an LH-positive test moves ovulation and tightens the next-period estimate', () => {
  const st = starts('2026-06-01', [28, 28, 28]);
  const logs = logsFrom(st);
  const last = st[st.length - 1];
  logs[E.add(last, 16)] = { lh: true }; // later than the calendar says
  const a = E.analyze({ profile: profile(), logs }, E.add(last, 18));
  assert.strictEqual(a.ovDate, E.add(last, 17));
  assert.strictEqual(a.nextStart, E.add(last, 17 + 14 + 1)); // ovulation + luteal + 1
  assert.strictEqual(a.unc, 2);
  assert.ok(a.ovConfirmed);
  assert.strictEqual(a.basis, 'lh');
});

test('luteal length is learned from past LH tests', () => {
  // three cycles where LH+1 = ovulation and the period came 12 days later
  const st = starts('2026-03-01', [28, 28, 28, 28]);
  const logs = logsFrom(st);
  for (let i = 0; i < 4; i++) {
    const nextStart = st[i + 1];
    const ov = E.add(nextStart, -13); // luteal = 12
    logs[E.add(ov, -1)] = Object.assign(logs[E.add(ov, -1)] || {}, { lh: true });
  }
  const l = E.learn(E.derivePeriods(logs), profile(), '2026-09-01', logs);
  assert.strictEqual(Math.round(l.lutealLen), 12);
  const a = E.analyze({ profile: profile(), logs }, E.add(st[4], 3));
  assert.strictEqual(a.lutealLen, 12);
  assert.strictEqual(a.ovDate, E.add(a.nextStart, -13));
});

test('temperature shift (3 over 6) is detected', () => {
  const logs = logsFrom(['2026-10-01']);
  const temps = [36.3, 36.4, 36.3, 36.35, 36.3, 36.4, 36.3, 36.35, 36.8, 36.85, 36.9];
  temps.forEach((t, i) => { logs[E.add('2026-10-08', i)] = { temp: t }; });
  const ov = E.detectOvulation(logs, '2026-10-01', '2026-11-01');
  assert.ok(ov && ov.method === 'bbt');
  assert.strictEqual(ov.date, E.add('2026-10-08', 7)); // day before first high reading (index 8 -> 7)
});

test('no false temperature shift on flat readings', () => {
  const logs = logsFrom(['2026-10-01']);
  for (let i = 0; i < 14; i++) logs[E.add('2026-10-08', i)] = { temp: 36.4 + (i % 2) * 0.05 };
  assert.strictEqual(E.detectOvulation(logs, '2026-10-01', '2026-11-01'), null);
});

test('"still bleeding?" guess appears only when it should', () => {
  const logs = { '2026-10-01': { period: true }, '2026-10-02': { period: true } };
  const base = { profile: profile(), logs, dismissed: {} };
  let a = E.analyze(base, '2026-10-03');
  assert.ok(a.ongoingGuess && a.phase === 'period');
  base.dismissed['2026-10-03'] = 1;
  a = E.analyze(base, '2026-10-03');
  assert.ok(!a.ongoingGuess);
  a = E.analyze({ profile: profile(), logs: Object.assign({}, logs, { '2026-10-03': { period: true } }), dismissed: {} }, '2026-10-03');
  assert.ok(!a.ongoingGuess && a.inPeriod);
});

test('backtest reports honest prediction error', () => {
  const st = starts('2026-01-01', [28, 28, 28, 28, 30, 28]);
  const bt = E.backtest(logsFrom(st), profile(), '2026-12-01');
  assert.ok(bt && bt.n >= 2 && bt.mae < 2.5);
});

test('symptom patterns tie to cycle phases', () => {
  const st = starts('2026-05-01', [28, 28, 28, 28]);
  const logs = logsFrom(st);
  st.forEach((s) => { logs[s].symptoms = ['cramps']; });
  const state = { profile: profile(), logs, dismissed: {} };
  const a = E.analyze(state, E.add(st[4], 6));
  const ins = E.insights(state, a.today, a);
  const c = ins.symptoms.find((x) => x.key === 'cramps');
  assert.strictEqual(c.topPhase, 'period');
  assert.strictEqual(c.cycles, 5);
});

test('no data: analysis is safe and empty', () => {
  const a = E.analyze({ profile: profile(), logs: {} }, '2026-10-01');
  assert.strictEqual(a.hasData, false);
});

test('flags: very short cycles are mentioned gently', () => {
  const st = starts('2026-01-01', [19, 19, 19, 19]);
  const a = E.analyze({ profile: profile(), logs: logsFrom(st) }, E.add(st[4], 5));
  assert.ok(a.flags.some((f) => /under 21/.test(f)));
});

console.log('\n' + passed + ' tests passed' + (process.exitCode ? ' (with failures)' : ''));
