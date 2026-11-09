/* Petal prediction engine.
 * Pure functions, no DOM. Works in the browser (window.Engine) and in Node (tests).
 * Dates are 'YYYY-MM-DD' strings in the user's local calendar; all math is done on
 * whole-day numbers so daylight-saving changes can never shift a prediction.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 86400000;
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  const num = (s) => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
  const str = (n) => { const d = new Date(n * DAY); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()); };
  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  const add = (s, n) => str(num(s) + n);
  const diff = (a, b) => num(a) - num(b);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const wmean = (a) => { let sw = 0, s = 0; a.forEach((v, i) => { sw += i + 1; s += (i + 1) * v; }); return s / sw; };
  const stdev = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

  /* ---- periods & cycles ------------------------------------------------ */

  // Every day flagged `period` is grouped into periods. Days up to 3 apart belong to the same period.
  function derivePeriods(logs) {
    const days = Object.keys(logs).filter((d) => logs[d] && logs[d].period).sort();
    const out = [];
    let cur = null;
    for (const d of days) {
      if (cur && diff(d, cur.end) <= 3) { cur.end = d; cur.days.push(d); }
      else { cur = { start: d, end: d, days: [d] }; out.push(cur); }
    }
    out.forEach((p) => { p.length = diff(p.end, p.start) + 1; });
    return out;
  }

  function cyclesFrom(periods) {
    const out = [];
    for (let i = 0; i < periods.length - 1; i++) {
      out.push({ start: periods[i].start, next: periods[i + 1].start, length: diff(periods[i + 1].start, periods[i].start), periodLength: periods[i].length });
    }
    return out;
  }

  // Drop cycles that are wildly off the typical value (usually a forgotten log), keep order.
  function robust(lens) {
    if (lens.length < 4) return lens;
    const m = median(lens);
    const tol = Math.max(10, m * 0.4);
    const kept = lens.filter((L) => Math.abs(L - m) <= tol);
    return kept.length >= 3 ? kept : lens;
  }

  /* ---- ovulation evidence (LH test or temperature shift) ---------------- */

  // Returns {date, method} for the ovulation day inside [start, endExcl), or null.
  function detectOvulation(logs, start, endExcl) {
    const s = num(start), e = num(endExcl);
    let lh = null;
    const temps = [];
    for (let d = s; d < e; d++) {
      const k = str(d), l = logs[k];
      if (!l) continue;
      if (l.lh && lh === null) lh = k;
      if (typeof l.temp === 'number') temps.push({ k, t: l.temp });
    }
    if (lh) return { date: add(lh, 1), method: 'lh' }; // ovulation follows the first positive test by ~1 day
    // "3 over 6" rule: three readings above the previous six, the third >= 0.2 C above their highest.
    for (let i = 6; i + 2 < temps.length; i++) {
      if (diff(temps[i].k, start) < 7) continue;
      if (diff(temps[i + 2].k, temps[i - 6].k) > 14) continue;
      let cover = -Infinity;
      for (let j = i - 6; j < i; j++) cover = Math.max(cover, temps[j].t);
      if (temps[i].t > cover && temps[i + 1].t > cover && temps[i + 2].t >= cover + 0.2) {
        return { date: add(temps[i].k, -1), method: 'bbt' };
      }
    }
    return null;
  }

  /* ---- learning --------------------------------------------------------- */

  // Learns cycle length, period length and luteal length from history. Recent cycles weigh more.
  // With fewer than 3 data points, the user's own estimate counts as the missing points.
  function learn(periods, profile, today, logs) {
    const cycles = cyclesFrom(periods);
    const lens = cycles.map((c) => c.length).filter((L) => L >= 15 && L <= 90);
    const recent = robust(lens.slice(-6));
    const prior = profile.cycleLen || 28;
    const n = recent.length;
    let len = prior, sd = null;
    if (n) {
      const wm = wmean(recent);
      len = n >= 3 ? wm : (wm * n + prior * (3 - n)) / 3;
      if (n >= 3) sd = stdev(recent);
    }

    const priorP = profile.periodLen || 5;
    const pls = periods
      .filter((p, i) => i < periods.length - 1 || diff(today, p.end) > 3)
      .map((p) => p.length).filter((l) => l >= 2 && l <= 10).slice(-6);
    let periodLen = priorP;
    if (pls.length) {
      const wm = wmean(pls);
      periodLen = pls.length >= 3 ? wm : (wm * pls.length + priorP * (3 - pls.length)) / 3;
    }

    const priorL = profile.lutealLen || 14;
    const lut = [];
    const pastOv = [];
    for (const c of cycles) {
      const ov = detectOvulation(logs || {}, c.start, c.next);
      if (ov) {
        pastOv.push(ov);
        const L = diff(c.next, ov.date) - 1; // days between ovulation day and the next period
        if (L >= 8 && L <= 18) lut.push(L);
      }
    }
    const lr = lut.slice(-6);
    let lutealLen = priorL, lutealSd = null;
    if (lr.length) {
      const m = mean(lr);
      lutealLen = lr.length >= 3 ? m : (m * lr.length + priorL * (3 - lr.length)) / 3;
      if (lr.length >= 3) lutealSd = stdev(lr);
    }
    return { cycles, lens, len, sd, n, periodLen, lutealLen, lutealSd, lutealN: lut.length, pastOv };
  }

  /* ---- the main analysis ------------------------------------------------- */

  function analyze(state, today) {
    const profile = state.profile, logs = state.logs || {};
    const periods = derivePeriods(logs);
    const learned = learn(periods, profile, today, logs);
    const out = { today, periods, learned, hasData: periods.length > 0, marks: {}, next: [], flags: [] };
    if (!out.hasData) return out;

    const mark = (d, f) => { (out.marks[d] = out.marks[d] || {})[f] = true; };
    const last = periods[periods.length - 1];
    const predLen = clamp(Math.round(learned.len), 15, 90);
    const pl = clamp(Math.round(learned.periodLen), 2, 10);
    const L = clamp(Math.round(learned.lutealLen), 8, 18);
    const cd = Math.max(1, diff(today, last.start) + 1);
    const todayLog = logs[today] || {};
    const sinceEnd = diff(today, last.end);

    // Probably still bleeding: she logged recent days, hasn't logged today, and the period is shorter than usual so far.
    const ongoingGuess = !todayLog.period && sinceEnd >= 1 && sinceEnd <= 3 && cd <= pl + 2 && last.length < pl && !(state.dismissed && state.dismissed[today]);
    const inPeriod = !!todayLog.period || ongoingGuess;

    let nextStart = add(last.start, predLen);
    let unc = learned.sd != null ? clamp(Math.ceil(learned.sd), 2, 7) : (profile.irregular ? 5 : 3);
    if (profile.irregular) unc = Math.max(unc, 4);
    let basis = learned.n >= 3 ? 'history' : 'estimate';

    // Evidence from this cycle (LH test / temperature shift) sharpens the next-period prediction.
    const ovCur = detectOvulation(logs, last.start, add(today, 1));
    let ovDate, ovMethod = null;
    if (ovCur) {
      const ns = add(ovCur.date, L + 1);
      if (diff(ns, last.start) >= 15) {
        nextStart = ns;
        unc = learned.lutealN >= 3 && learned.lutealSd != null && learned.lutealSd <= 1 ? 1 : 2;
        basis = ovCur.method;
      }
      ovDate = ovCur.date;
      ovMethod = ovCur.method;
    } else {
      ovDate = add(nextStart, -(L + 1));
    }
    const ovConfirmed = !!ovCur && (ovCur.method === 'bbt' || ovCur.date <= today);
    const fertStart = add(ovDate, -5), fertEnd = add(ovDate, 1);
    const late = Math.max(0, diff(today, nextStart));

    // Upcoming cycles (6 months ahead)
    for (let i = 0; i < 6; i++) {
      const start = i === 0 ? nextStart : add(out.next[i - 1].start, predLen);
      const ov = i === 0 ? ovDate : add(start, -(L + 1));
      out.next.push({ start, end: add(start, pl - 1), ov, fertStart: add(ov, -5), fertEnd: add(ov, 1) });
    }
    out.next.forEach((c, i) => {
      for (let d = num(c.start); d <= num(c.end); d++) { const k = str(d); if (k >= today) mark(k, 'pred'); }
      for (let d = num(c.fertStart); d <= num(c.fertEnd); d++) { const k = str(d); if (i > 0 || k >= last.start) mark(k, 'fertile'); }
      mark(c.ov, i === 0 && ovConfirmed ? 'ovc' : 'ov');
    });
    (learned.pastOv || []).forEach((o) => mark(o.date, 'ovc'));

    let phase;
    if (inPeriod) phase = 'period';
    else if (late > 0) phase = 'late';
    else if (today === ovDate) phase = 'ovulation';
    else if (today >= fertStart && today <= fertEnd) phase = 'fertile';
    else if (today < fertStart) phase = 'follicular';
    else phase = 'luteal';

    let chance = 'low';
    if (phase === 'fertile' || phase === 'ovulation') chance = today >= add(ovDate, -2) && today <= ovDate ? 'peak' : 'high';
    if (phase === 'late') chance = 'unknown';
    if (todayLog.lh) chance = 'peak';
    else if (todayLog.discharge === 'eggwhite' && (chance === 'low' || chance === 'unknown')) chance = 'high';

    // Gentle, non-diagnostic notes
    const lens12 = learned.lens.slice(-12);
    if (lens12.length >= 3) {
      const avg = mean(lens12);
      if (avg < 21) out.flags.push('Your cycles average under 21 days. That is shorter than typical and worth mentioning to a doctor.');
      if (avg > 35) out.flags.push('Your cycles average over 35 days. That is longer than typical and worth mentioning to a doctor.');
      if (stdev(lens12) > 7) out.flags.push('Your cycle length varies a lot from month to month. Predictions will be wide until a pattern shows up.');
    }
    const pAvg = periods.filter((p) => p.length >= 2).slice(-6).map((p) => p.length);
    if (pAvg.length >= 3 && mean(pAvg) > 7) out.flags.push('Your periods usually last more than 7 days. Worth mentioning to a doctor.');
    if (late > 14) out.flags.push('Your period is more than two weeks late. If that is unexpected, consider a pregnancy test or a check-in with a doctor.');

    Object.assign(out, { last, cycleDay: cd, predLen, periodLen: pl, lutealLen: L, nextStart, unc, basis, late, ovDate, ovMethod, ovConfirmed, fertStart, fertEnd, phase, chance, inPeriod, ongoingGuess, periodDay: diff(today, last.start) + 1 });
    return out;
  }

  /* ---- insights ---------------------------------------------------------- */

  // How well would Petal have predicted each past period using only the data before it?
  function backtest(logs, profile, today) {
    const periods = derivePeriods(logs), errs = [];
    for (let i = 3; i < periods.length; i++) {
      const sub = periods.slice(0, i);
      const lr = learn(sub, profile, today, logs);
      const actual = diff(periods[i].start, sub[sub.length - 1].start);
      if (actual < 15 || actual > 90) continue;
      errs.push(Math.abs(actual - Math.round(lr.len)));
    }
    if (!errs.length) return null;
    return { n: errs.length, mae: mean(errs), within1: errs.filter((e) => e <= 1).length / errs.length, within2: errs.filter((e) => e <= 2).length / errs.length };
  }

  function phaseForDate(date, a) {
    const periods = a.periods;
    let idx = -1;
    for (let i = 0; i < periods.length; i++) if (periods[i].start <= date) idx = i;
    if (idx < 0) return null;
    const p = periods[idx];
    const offset = diff(date, p.start);
    if (offset > 70) return null;
    const cyc = a.learned.cycles[idx];
    const len = cyc ? cyc.length : a.predLen;
    const pLen = p.length >= 2 ? p.length : a.periodLen;
    const ov = (a.learned.pastOv || []).find((o) => cyc && o.date >= cyc.start && o.date < cyc.next);
    const ovOff = ov ? diff(ov.date, p.start) : len - a.lutealLen - 1;
    let phase;
    if (offset < pLen) phase = 'period';
    else if (offset < ovOff - 5) phase = 'follicular';
    else if (offset <= ovOff + 1) phase = 'fertile';
    else phase = 'luteal';
    return { phase, idx, offset };
  }

  function tally(logs, field, a) {
    const m = {};
    for (const [date, l] of Object.entries(logs)) {
      const items = l && l[field];
      if (!items || !items.length) continue;
      const pf = a.hasData ? phaseForDate(date, a) : null;
      for (const k of items) {
        const e = (m[k] = m[k] || { key: k, count: 0, cycles: new Set(), phases: {} });
        e.count++;
        if (pf) { e.cycles.add(pf.idx); e.phases[pf.phase] = (e.phases[pf.phase] || 0) + 1; }
      }
    }
    return Object.values(m).map((e) => {
      const entries = Object.entries(e.phases).sort((x, y) => y[1] - x[1]);
      const total = entries.reduce((s, x) => s + x[1], 0);
      return { key: e.key, count: e.count, cycles: e.cycles.size, topPhase: entries.length ? entries[0][0] : null, share: total ? entries[0][1] / total : 0 };
    }).sort((x, y) => y.count - x.count);
  }

  function insights(state, today, a) {
    const lens = a.learned ? a.learned.lens.slice(-12) : [];
    const sd = lens.length >= 2 ? stdev(lens) : null;
    let regularity = null;
    if (sd != null && lens.length >= 3) regularity = sd <= 2 ? 'Very regular' : sd <= 4 ? 'Fairly regular' : sd <= 7 ? 'Somewhat irregular' : 'Irregular';
    const pls = a.periods.filter((p, i) => (i < a.periods.length - 1 || diff(today, p.end) > 3) && p.length >= 2).map((p) => p.length);
    return {
      nCycles: a.learned.cycles.length,
      avgCycle: lens.length ? mean(lens) : null,
      minCycle: lens.length ? Math.min.apply(null, lens) : null,
      maxCycle: lens.length ? Math.max.apply(null, lens) : null,
      sd, regularity,
      avgPeriod: pls.length ? mean(pls.slice(-6)) : null,
      history: a.learned.cycles.filter((c) => c.length >= 15 && c.length <= 90).slice(-12),
      loggedDays: Object.keys(state.logs).length,
      symptoms: tally(state.logs, 'symptoms', a),
      moods: tally(state.logs, 'moods', a),
      backtest: backtest(state.logs, state.profile, today),
      lutealLearned: a.learned.lutealN
    };
  }

  return { num, str, todayStr, add, diff, derivePeriods, cyclesFrom, learn, detectOvulation, analyze, insights, backtest, phaseForDate, mean, stdev, median };
});
