/* Petal – a private period tracker. All data lives in this device's localStorage. No accounts, no server. */
(function () {
  'use strict';
  const E = window.Engine;
  const KEY = 'petal.v1';
  const $app = document.getElementById('app');
  const $ov = document.getElementById('overlay');
  const $toasts = document.getElementById('toasts');

  const SYMPTOMS = [['cramps', 'Cramps'], ['headache', 'Headache'], ['bloating', 'Bloating'], ['tender', 'Breast tenderness'], ['acne', 'Acne'], ['fatigue', 'Fatigue'], ['backache', 'Back pain'], ['nausea', 'Nausea'], ['cravings', 'Cravings'], ['insomnia', 'Trouble sleeping'], ['dizzy', 'Dizziness']];
  const MOODS = [['happy', 'Happy'], ['calm', 'Calm'], ['energetic', 'Energetic'], ['sensitive', 'Sensitive'], ['irritable', 'Irritable'], ['anxious', 'Anxious'], ['sad', 'Sad'], ['stressed', 'Stressed']];
  const FLOWS = [['spotting', 'Spotting'], ['light', 'Light'], ['medium', 'Medium'], ['heavy', 'Heavy']];
  const DISCHARGE = [['dry', 'Dry'], ['sticky', 'Sticky'], ['creamy', 'Creamy'], ['watery', 'Watery'], ['eggwhite', 'Egg white']];
  const SEX = [['protected', 'Protected'], ['unprotected', 'Unprotected']];
  const LABEL = {};
  [SYMPTOMS, MOODS].forEach((l) => l.forEach(([k, v]) => { LABEL[k] = v; }));
  const PHASES = {
    period: { name: 'Period', tip: 'Be gentle with yourself. Warmth, rest and iron-rich foods can help.' },
    follicular: { name: 'Follicular phase', tip: 'Energy often builds as your period ends.' },
    fertile: { name: 'Fertile window', tip: 'Pregnancy is possible on these days.' },
    ovulation: { name: 'Ovulation day', tip: 'An egg is likely released today or very soon.' },
    luteal: { name: 'Luteal phase', tip: 'PMS symptoms can show up in the days before your period.' },
    late: { name: 'Period is late', tip: 'Cycles shift with stress, travel, illness and more.' }
  };
  const PHASE_WORDS = { period: 'your period', follicular: 'the days after your period', fertile: 'your fertile window', luteal: 'the days before your period' };

  /* ---------- state ---------- */
  let S = load() || defaults();
  let A = null, tab = 'today', calMonth = null, locked = false, ob = null, deferredInstall = null, hiddenAt = 0;

  function defaults() {
    return { v: 1, profile: { name: '', goal: 'track', cycleLen: 28, periodLen: 5, lutealLen: 14, irregular: false, weekStart: 0, tempUnit: 'F', theme: 'auto', pin: null, onboarded: false, tipsDismissed: false }, logs: {}, dismissed: {}, lastBackup: null };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw), b = defaults();
      return Object.assign(b, d, { profile: Object.assign(b.profile, d.profile || {}), logs: d.logs || {}, dismissed: d.dismissed || {} });
    } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); return true; }
    catch (e) { toast('Could not save. Storage may be full or blocked.'); return false; }
  }

  /* ---------- tiny helpers ---------- */
  const today = () => E.todayStr();
  function h(tag, attrs) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    const kids = [].slice.call(arguments, 2);
    (function put(list) { list.forEach((c) => { if (Array.isArray(c)) return put(c); if (c == null || c === false) return; el.append(c.nodeType ? c : document.createTextNode(String(c))); }); })(kids);
    return el;
  }
  const fmt = (s, o) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, o || { month: 'short', day: 'numeric' }); };
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function toast(msg) {
    const t = h('div', { class: 'toast' }, msg);
    $toasts.append(t);
    setTimeout(() => t.remove(), 2600);
  }
  function applyTheme() {
    const t = S.profile.theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  }
  const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const toC = (v) => (S.profile.tempUnit === 'F' ? ((v - 32) * 5) / 9 : v);
  const fromC = (c) => (S.profile.tempUnit === 'F' ? (c * 9) / 5 + 32 : c);
  const isEmptyLog = (l) => !l.period && !l.flow && !(l.symptoms && l.symptoms.length) && !(l.moods && l.moods.length) && !l.discharge && !l.sex && !l.lh && typeof l.temp !== 'number' && !l.notes;

  const ICONS = {
    today: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
    insights: '<path d="M5 20v-8M12 20V5M19 20v-5"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'
  };

  /* ---------- sheets ---------- */
  function closeSheet() { $ov.innerHTML = ''; document.body.classList.remove('noscroll'); }
  function sheet(title, content, onClose) {
    function close() { closeSheet(); if (onClose) onClose(); }
    $ov.innerHTML = '';
    $ov.append(
      h('div', { class: 'backdrop', onclick: close }),
      h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'grab' }),
        h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'x', 'aria-label': 'Close', onclick: close }, '✕')),
        h('div', { class: 'sheet-body' }, content))
    );
    document.body.classList.add('noscroll');
    return { close };
  }

  /* ---------- render ---------- */
  function render() {
    applyTheme();
    $app.innerHTML = '';
    if (locked) return void $app.append(viewLock());
    if (!S.profile.onboarded) return void $app.append(viewOnboarding());
    A = E.analyze(S, today());
    const body = tab === 'today' ? viewToday() : tab === 'calendar' ? viewCalendar() : tab === 'insights' ? viewInsights() : viewSettings();
    $app.append(h('main', { class: 'screen' }, body), tabbar());
  }
  function setTab(t) { tab = t; render(); window.scrollTo(0, 0); }
  function tabbar() {
    const items = [['today', 'Today'], ['calendar', 'Calendar'], ['insights', 'Insights'], ['settings', 'Settings']];
    return h('nav', { class: 'tabbar', 'aria-label': 'Main' }, h('div', { class: 'tabbar-in' },
      items.map(([k, label]) => h('button', { class: 'tab' + (tab === k ? ' on' : ''), 'aria-current': tab === k ? 'page' : null, onclick: () => setTab(k) },
        h('span', { html: '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[k] + '</svg>' }), label))));
  }

  /* ---------- data actions ---------- */
  function patchLog(date, fn) {
    const l = S.logs[date] ? JSON.parse(JSON.stringify(S.logs[date])) : {};
    fn(l);
    ['symptoms', 'moods'].forEach((k) => { if (l[k] && !l[k].length) delete l[k]; });
    ['notes', 'flow', 'discharge', 'sex'].forEach((k) => { if (!l[k]) delete l[k]; });
    if (!l.period) delete l.period;
    if (!l.lh) delete l.lh;
    if (isEmptyLog(l)) delete S.logs[date]; else S.logs[date] = l;
    save();
  }
  function markPeriodToday() {
    const t = today();
    const pd = E.derivePeriods(S.logs);
    const last = pd[pd.length - 1];
    if (last && E.diff(t, last.end) > 3 && E.diff(t, last.start) < 15) {
      if (!confirm('That is only ' + plural(E.diff(t, last.start), 'day') + ' after your last period started. Is this a new period (not spotting)?')) return;
    }
    patchLog(t, (l) => { l.period = true; });
    render();
  }

  /* =====================================================================
     TODAY
     ===================================================================== */
  function viewToday() {
    const t = today(), p = S.profile, log = S.logs[t] || {};
    const hr = new Date().getHours();
    const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const out = [h('header', { class: 'top' }, h('div', {}, h('p', { class: 'eyebrow' }, fmt(t, { weekday: 'long', month: 'long', day: 'numeric' })), h('h1', {}, p.name ? greet + ', ' + p.name : greet)))];

    if (!p.tipsDismissed) out.push(tipsCard());
    if (!A.hasData) {
      out.push(h('section', { class: 'card' }, h('h2', {}, 'Let’s get your first prediction'),
        h('p', { class: 'muted' }, 'Log the first day of your last period and Petal will start predicting. The more periods you log, the better it gets.'),
        h('button', { class: 'btn primary block', onclick: () => openDay(t) }, 'Log a period')));
      return out;
    }
    const a = A;
    if (a.ongoingGuess) out.push(stillBleeding());
    out.push(ringCard());
    out.push(quickLog(log));
    out.push(fertilityCard());
    out.push(upcomingCard());
    const hu = headsUp();
    if (hu) out.push(hu);
    if (a.flags.length) out.push(h('section', { class: 'card soft-amber' }, h('h2', {}, 'Worth knowing'), a.flags.map((f) => h('p', {}, f)),
      h('p', { class: 'small muted' }, 'Petal can’t diagnose anything. This is only a nudge based on the numbers you logged.')));
    const bu = backupNudge();
    if (bu) out.push(bu);
    const ins = installNudge();
    if (ins) out.push(ins);
    out.push(h('p', { class: 'small muted center' }, 'Predictions are estimates, and Petal is not birth control.'));
    return out;
  }

  function tipsCard() {
    return h('section', { class: 'card soft-rose' }, h('h2', {}, 'Quick tips'),
      h('div', { class: 'list' },
        h('div', { class: 'item' }, h('div', {}, h('div', { class: 't' }, 'Log in two taps'), h('div', { class: 's' }, 'Use “My period is here” below, or tap any past day in Calendar.'))),
        h('div', { class: 'item' }, h('div', {}, h('div', { class: 't' }, 'It learns you'), h('div', { class: 's' }, 'Predictions sharpen after about 3 logged periods. Ovulation tests and temperatures sharpen them even more.'))),
        h('div', { class: 'item' }, h('div', {}, h('div', { class: 't' }, 'Back up now and then'), h('div', { class: 's' }, 'Your data only lives on this phone. Settings → Back up data.')))),
      h('button', { class: 'btn sm', onclick: () => { S.profile.tipsDismissed = true; save(); render(); } }, 'Got it'));
  }

  function stillBleeding() {
    const t = today();
    return h('section', { class: 'card soft-rose' }, h('h2', {}, '🩸 Still bleeding today?'),
      h('p', { class: 'muted' }, 'Your period usually lasts about ' + A.periodLen + ' days, and you’re on day ' + A.periodDay + '.'),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn primary grow', onclick: () => {
          for (let d = E.num(A.last.end) + 1; d <= E.num(t); d++) patchLog(E.str(d), (l) => { l.period = true; });
          render();
        } }, 'Yes'),
        h('button', { class: 'btn grow', onclick: () => { S.dismissed[t] = 1; save(); render(); } }, 'No, it ended')));
  }

  function ringCard() {
    const a = A, R = 90, C = 2 * Math.PI * R, frac = Math.min(1, a.cycleDay / a.predLen);
    const ph = PHASES[a.phase];
    const svg = '<svg viewBox="0 0 224 224" class="ring" aria-hidden="true"><circle cx="112" cy="112" r="' + R + '" class="ring-bg"/><circle cx="112" cy="112" r="' + R + '" class="ring-fg ' + a.phase + '" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - frac)).toFixed(1) + '" transform="rotate(-90 112 112)"/></svg>';
    const pill = a.phase === 'period' ? 'rose' : a.phase === 'fertile' || a.phase === 'ovulation' ? 'teal' : a.phase === 'late' ? 'amber' : '';
    const goalLine = (a.phase === 'fertile' || a.phase === 'ovulation')
      ? (S.profile.goal === 'conceive' ? 'These are good days to try.' : S.profile.goal === 'avoid' ? 'Pregnancy is more likely right now. Petal can’t prevent pregnancy, so use protection.' : ph.tip)
      : a.phase === 'late' ? 'If you could be pregnant, a home test is reliable from about the day of a missed period.' : ph.tip;
    let headline, sub;
    if (a.phase === 'late') { headline = 'Period is ' + plural(a.late, 'day') + ' late'; sub = 'It was expected ' + fmt(a.nextStart) + '.'; }
    else {
      const n = E.diff(a.nextStart, a.today);
      headline = n === 0 ? 'Period expected today' : n === 1 ? 'Period expected tomorrow' : 'Period in ' + n + ' days';
      sub = 'Expected ' + fmt(a.nextStart, { weekday: 'short', month: 'short', day: 'numeric' }) + (a.unc ? ' (±' + a.unc + ')' : '');
    }
    return h('section', { class: 'card hero' },
      h('div', { class: 'ringwrap' }, h('div', { html: svg, style: 'position:absolute;inset:0' }),
        h('div', { class: 'ringtext' }, h('span', { class: 'lbl' }, a.phase === 'period' ? 'Period day' : 'Cycle day'), h('span', { class: 'big' }, a.phase === 'period' ? a.periodDay : a.cycleDay), h('span', { class: 'pill ' + pill }, ph.name))),
      h('div', {}, h('p', { class: 'headline' }, headline), h('p', { class: 'muted' }, sub)),
      h('p', { class: 'muted small' }, goalLine));
  }

  function quickLog(log) {
    const t = today();
    const bits = [];
    if (log.flow) bits.push(cap(log.flow) + ' flow');
    (log.symptoms || []).forEach((k) => bits.push(LABEL[k]));
    (log.moods || []).forEach((k) => bits.push(LABEL[k]));
    return h('section', { class: 'card' }, h('h2', {}, 'Today'),
      h('div', { class: 'row gap wrap' },
        log.period
          ? h('button', { class: 'btn primary grow', onclick: () => { patchLog(t, (l) => { l.period = false; if (['light', 'medium', 'heavy'].includes(l.flow)) delete l.flow; }); render(); } }, '✓ Period day · tap to undo')
          : h('button', { class: 'btn primary grow', onclick: markPeriodToday }, '🩸 My period is here'),
        h('button', { class: 'btn grow', onclick: () => openDay(t) }, '＋ Log how I feel')),
      bits.length ? h('div', { class: 'chips' }, bits.map((b) => h('span', { class: 'pill' }, b))) : h('p', { class: 'small muted' }, 'Nothing logged yet today.'));
  }

  function fertilityCard() {
    const a = A;
    const map = { low: ['Low', ''], high: ['High', 'teal'], peak: ['Peak', 'teal'], unknown: ['Unclear', 'amber'] };
    const [txt, cls] = map[a.chance];
    const how = a.ovMethod === 'lh' ? 'based on your positive ovulation test' : a.ovMethod === 'bbt' ? 'confirmed by your temperature shift' : a.learned.lutealN >= 3 ? 'based on your own cycle and luteal-phase history' : 'estimated from your cycle length';
    const passed = a.ovDate < a.today;
    return h('section', { class: 'card' }, h('div', { class: 'row between' }, h('h2', {}, 'Chance of pregnancy today'), h('span', { class: 'pill ' + cls }, txt)),
      h('div', { class: 'list' },
        h('div', { class: 'item' }, h('div', {}, h('div', { class: 't' }, 'Fertile window'), h('div', { class: 's' }, fmt(a.fertStart) + ' – ' + fmt(a.fertEnd))), h('span', { class: 'dot teal' })),
        h('div', { class: 'item' }, h('div', {}, h('div', { class: 't' }, a.ovConfirmed ? 'Ovulation (confirmed)' : passed ? 'Ovulation (estimated, passed)' : 'Ovulation (estimated)'), h('div', { class: 's' }, fmt(a.ovDate, { weekday: 'short', month: 'short', day: 'numeric' }))), h('span', { class: 'dot teal' }))),
      h('p', { class: 'small muted' }, 'Window ' + how + '. ' + (S.profile.irregular || (a.learned.sd != null && a.learned.sd > 4) ? 'Your cycle varies, so treat this window as rough. ' : '') + 'Sperm can survive up to 5 days.'),
      a.ovMethod ? null : h('button', { class: 'linkbtn', style: 'text-align:left', onclick: () => openDay(today()) }, 'Log an ovulation test or temperature to sharpen this →'));
  }

  function upcomingCard() {
    const a = A, n = a.next[0], n2 = a.next[1];
    return h('section', { class: 'card' }, h('h2', {}, 'Coming up'),
      h('div', { class: 'list' },
        h('div', { class: 'item' }, h('div', {}, h('div', { class: 't' }, 'Next period'), h('div', { class: 's' }, fmt(n.start) + ' – ' + fmt(n.end) + (a.unc ? ' · could shift ±' + a.unc + ' days' : ''))), h('span', { class: 'dot rose' })),
        h('div', { class: 'item' }, h('div', {}, h('div', { class: 't' }, 'Following period'), h('div', { class: 's' }, fmt(n2.start) + ' – ' + fmt(n2.end))), h('span', { class: 'dot rose' })),
        h('div', { class: 'item' }, h('div', {}, h('div', { class: 't' }, 'Next fertile window'), h('div', { class: 's' }, fmt(n2.fertStart) + ' – ' + fmt(n2.fertEnd))), h('span', { class: 'dot teal' }))),
      h('p', { class: 'small muted' }, 'Using a ' + a.predLen + '-day cycle' + (a.learned.n >= 3 ? ' learned from your last ' + a.learned.n + ' cycles.' : a.learned.n ? ' (blending your estimate with ' + plural(a.learned.n, 'logged cycle') + ').' : ' based on your setup. Log more periods to personalize it.')));
  }

  function headsUp() {
    const a = A;
    if (!['period', 'follicular', 'fertile', 'ovulation', 'luteal'].includes(a.phase)) return null;
    const ph = a.phase === 'ovulation' ? 'fertile' : a.phase;
    const ins = E.insights(S, a.today, a);
    const hits = ins.symptoms.filter((s) => s.count >= 4 && s.cycles >= 2 && s.topPhase === ph && s.share >= 0.6).slice(0, 3);
    if (!hits.length) return null;
    return h('section', { class: 'card soft-lav' }, h('h2', {}, '💡 Your pattern'),
      h('p', {}, 'You often log ' + hits.map((x) => LABEL[x.key].toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' and $1') + ' during ' + PHASE_WORDS[ph] + '.'));
  }
  function backupNudge() {
    const days = Object.keys(S.logs).length;
    const stale = !S.lastBackup || E.diff(today(), S.lastBackup) > 30;
    if (days < 10 || !stale) return null;
    return h('section', { class: 'card soft-amber' }, h('h2', {}, 'Back up your data'), h('p', {}, 'Everything lives on this phone only. If you lose or reset it, the history is gone. A backup takes 5 seconds.'),
      h('button', { class: 'btn sm', onclick: exportData }, 'Back up now'));
  }
  function installNudge() {
    if (isStandalone() || S.profile.installDismissed) return null;
    return h('section', { class: 'card soft-teal' }, h('h2', {}, 'Install Petal'), installHelp(),
      h('button', { class: 'linkbtn', onclick: () => { S.profile.installDismissed = true; save(); render(); } }, 'Hide this'));
  }

  /* =====================================================================
     DAY SHEET
     ===================================================================== */
  function openDay(date) {
    const t = today();
    if (date > t) return openFuture(date);
    const content = h('div', { class: 'sheet-body', style: 'padding:0;overflow:visible' });
    const sh = sheet(fmt(date, { weekday: 'long', month: 'long', day: 'numeric' }), content, render);
    const patch = (fn, redraw) => { patchLog(date, fn); if (redraw !== false) draw(); };
    function chips(items, selected, onToggle, cls) {
      return h('div', { class: 'chips' }, items.map(([k, label]) => h('button', { type: 'button', class: 'chip' + (selected.indexOf(k) >= 0 ? ' on ' + (cls || '') : ''), 'aria-pressed': selected.indexOf(k) >= 0 ? 'true' : 'false', onclick: () => onToggle(k) }, label)));
    }
    const multi = (field) => (k) => patch((l) => { const arr = l[field] || []; const i = arr.indexOf(k); if (i >= 0) arr.splice(i, 1); else arr.push(k); l[field] = arr; });
    const single = (field) => (k) => patch((l) => { l[field] = l[field] === k ? '' : k; });
    const sw = (label, on, fn, sub) => h('div', { class: 'switch' }, h('div', {}, h('div', { class: 't', style: 'font-weight:600' }, label), sub ? h('div', { class: 'small muted' }, sub) : null), h('button', { type: 'button', class: 'toggle' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label, onclick: () => fn(!on) }));

    function draw() {
      content.innerHTML = '';
      const l = S.logs[date] || {};
      const a = E.analyze(S, t);
      const pf = a.hasData ? E.phaseForDate(date, a) : null;
      const info = pf ? 'Cycle day ' + (pf.offset + 1) : null;
      const pl = a.hasData ? a.periodLen : S.profile.periodLen;
      const canFill = l.period && E.diff(t, date) >= 1;
      const tempVal = typeof l.temp === 'number' ? String(Math.round(fromC(l.temp) * 100) / 100) : '';
      content.append(
        info ? h('p', { class: 'muted' }, info) : null,
        h('section', { class: 'sec' }, h('h3', {}, 'Period'),
          sw('Period day', !!l.period, (v) => patch((x) => { x.period = v; if (!v && ['light', 'medium', 'heavy'].includes(x.flow)) delete x.flow; })),
          chips(FLOWS, l.flow ? [l.flow] : [], (k) => patch((x) => { if (x.flow === k) { x.flow = ''; return; } x.flow = k; if (k !== 'spotting') x.period = true; })),
          canFill ? h('button', { class: 'btn sm', onclick: () => { for (let i = 1; i < pl; i++) { const d = E.add(date, i); if (d <= t) patchLog(d, (x) => { x.period = true; }); } draw(); toast('Marked ' + plural(Math.min(pl, E.diff(t, date) + 1), 'day') + ' as period'); } }, 'Mark the next ' + (pl - 1) + ' days as period too') : null),
        h('section', { class: 'sec' }, h('h3', {}, 'Symptoms'), chips(SYMPTOMS, l.symptoms || [], multi('symptoms'))),
        h('section', { class: 'sec' }, h('h3', {}, 'Mood'), chips(MOODS, l.moods || [], multi('moods'), 'lav')),
        h('section', { class: 'sec' }, h('h3', {}, 'Cervical fluid'), chips(DISCHARGE, l.discharge ? [l.discharge] : [], single('discharge'), 'teal')),
        h('section', { class: 'sec' }, h('h3', {}, 'Sex'), chips(SEX, l.sex ? [l.sex] : [], single('sex'))),
        h('section', { class: 'sec' }, h('h3', {}, 'Ovulation & temperature'),
          sw('Positive ovulation (LH) test', !!l.lh, (v) => patch((x) => { x.lh = v; }), 'Helps Petal pin down ovulation'),
          h('label', { class: 'field' }, 'Morning temperature (°' + S.profile.tempUnit + ')',
            h('input', { type: 'number', step: '0.01', inputmode: 'decimal', placeholder: S.profile.tempUnit === 'F' ? 'e.g. 97.6' : 'e.g. 36.4', value: tempVal, oninput: (e) => {
              const v = parseFloat(e.target.value), c = toC(v);
              patch((x) => { if (isNaN(v) || c < 34 || c > 40) delete x.temp; else x.temp = Math.round(c * 100) / 100; }, false);
            } }))),
        h('section', { class: 'sec' }, h('h3', {}, 'Notes'),
          h('textarea', { placeholder: 'Anything else worth remembering…', oninput: (e) => patch((x) => { x.notes = e.target.value; }, false) }, l.notes || '')),
        h('button', { class: 'btn primary block', onclick: sh.close }, 'Done'));
    }
    draw();
  }

  function openFuture(date) {
    const m = A.marks[date] || {};
    const lines = [];
    if (m.pred) lines.push('🩸 Your period is predicted around this day.');
    if (m.ov || m.ovc) lines.push('🥚 Estimated ovulation day.');
    if (m.fertile) lines.push('🌱 Inside your predicted fertile window.');
    if (!lines.length) lines.push('Nothing special is predicted for this day.');
    sheet(fmt(date, { weekday: 'long', month: 'long', day: 'numeric' }), h('div', { class: 'sec' }, lines.map((x) => h('p', {}, x)), h('p', { class: 'small muted' }, 'You can log symptoms once the day arrives. Predictions further out are less certain.')));
  }

  /* =====================================================================
     CALENDAR
     ===================================================================== */
  function viewCalendar() {
    const t = today();
    if (!calMonth) { const [y, m] = t.split('-').map(Number); calMonth = { y, m: m - 1 }; }
    const { y, m } = calMonth, ws = S.profile.weekStart;
    const first = new Date(y, m, 1), dim = new Date(y, m + 1, 0).getDate();
    const lead = (first.getDay() - ws + 7) % 7;
    const dows = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((_, i) => ['S', 'M', 'T', 'W', 'T', 'F', 'S'][(i + ws) % 7]);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h('div', { class: 'day blank' }));
    for (let d = 1; d <= dim; d++) {
      const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const l = S.logs[ds], mk = A.marks[ds] || {};
      const cls = ['day'];
      if (ds > t) cls.push('future');
      if (mk.fertile) cls.push('fertile');
      if (mk.pred && !(l && l.period)) cls.push('pred');
      if (mk.ov) cls.push('ov');
      if (mk.ovc) cls.push('ovc');
      if (l && l.period) cls.push('period');
      if (ds === t) cls.push('today');
      const hasLog = l && (l.symptoms || l.moods || l.notes || l.flow || l.lh || l.sex || l.discharge || typeof l.temp === 'number');
      cells.push(h('button', { class: cls.join(' '), 'aria-label': fmt(ds, { weekday: 'long', month: 'long', day: 'numeric' }) + (l && l.period ? ', period' : ''), onclick: () => openDay(ds) }, String(d), hasLog ? h('i', { class: 'has' }) : null));
    }
    const go = (dm) => { let nm = m + dm, ny = y; if (nm < 0) { nm = 11; ny--; } if (nm > 11) { nm = 0; ny++; } calMonth = { y: ny, m: nm }; render(); };
    return [
      h('header', { class: 'top' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Calendar'), h('h1', {}, 'Your cycle'))),
      h('section', { class: 'card' },
        h('div', { class: 'calhead' }, h('button', { class: 'iconbtn', 'aria-label': 'Previous month', onclick: () => go(-1) }, '‹'),
          h('h2', {}, first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
          h('button', { class: 'iconbtn', 'aria-label': 'Next month', onclick: () => go(1) }, '›')),
        h('div', { class: 'cal' }, dows.map((d) => h('div', { class: 'dow' }, d)), cells),
        h('div', { class: 'legend' },
          h('span', {}, h('i', { class: 'sw period' }), 'Period'), h('span', {}, h('i', { class: 'sw pred' }), 'Predicted'),
          h('span', {}, h('i', { class: 'sw fertile' }), 'Fertile'), h('span', {}, h('i', { class: 'sw ovc' }), 'Ovulation')),
        h('button', { class: 'linkbtn', onclick: () => { calMonth = null; render(); } }, 'Jump to today')),
      h('p', { class: 'small muted center' }, 'Tap any day to log it. Forgot to log a period? Tap its days or use “Mark the next days as period too.”')
    ];
  }

  /* =====================================================================
     INSIGHTS
     ===================================================================== */
  function barChart(hist, avg) {
    const W = 320, H = 150, padL = 8, padB = 22, padT = 18, n = hist.length;
    const max = Math.max.apply(null, hist.map((c) => c.length).concat([avg || 0, 30])) + 4;
    const slot = (W - padL * 2) / n, bw = Math.min(30, slot - 6);
    const y = (v) => padT + (H - padT - padB) * (1 - v / max);
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cycle length history">';
    hist.forEach((c, i) => {
      const x = padL + slot * i + (slot - bw) / 2;
      s += '<rect class="b" x="' + x.toFixed(1) + '" y="' + y(c.length).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (H - padB - y(c.length)).toFixed(1) + '" rx="4"/>';
      s += '<text class="v" x="' + (x + bw / 2).toFixed(1) + '" y="' + (y(c.length) - 4).toFixed(1) + '" text-anchor="middle">' + c.length + '</text>';
      s += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + fmt(c.start, { month: 'short' }) + '</text>';
    });
    if (avg) s += '<line class="avg" x1="' + padL + '" x2="' + (W - padL) + '" y1="' + y(avg).toFixed(1) + '" y2="' + y(avg).toFixed(1) + '"/>';
    return h('div', { html: s + '</svg>' });
  }
  function barList(items, cls) {
    const max = items.length ? items[0].count : 1;
    return h('div', { class: 'bars' }, items.map((s) => h('div', { class: 'bar ' + (cls || '') },
      h('span', {}, LABEL[s.key] || s.key), h('span', { class: 'muted small' }, s.count + '×' + (s.topPhase && s.count >= 3 ? ' · mostly ' + PHASE_WORDS[s.topPhase].replace('your ', '').replace('the days ', 'days ') : '')),
      h('div', { class: 'track' }, h('div', { class: 'fill', style: 'width:' + Math.round((s.count / max) * 100) + '%' })))));
  }
  function viewInsights() {
    const out = [h('header', { class: 'top' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Insights'), h('h1', {}, 'Your patterns')))];
    if (!A.hasData) { out.push(h('section', { class: 'card' }, h('p', { class: 'muted' }, 'Log a period to start seeing patterns.'))); return out; }
    const i = E.insights(S, A.today, A);
    if (i.nCycles < 1) {
      out.push(h('section', { class: 'card' }, h('h2', {}, 'Building your picture'), h('p', { class: 'muted' }, 'Insights unlock once Petal has seen the start of two periods. Until then, predictions use the numbers you entered during setup. Logged days so far: ' + i.loggedDays + '.')));
    } else {
      out.push(h('section', { class: 'card' }, h('h2', {}, 'Your cycle'),
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('div', { class: 'n' }, i.avgCycle ? Math.round(i.avgCycle * 10) / 10 : '–'), h('div', { class: 'l' }, 'Average cycle (days)')),
          h('div', { class: 'stat' }, h('div', { class: 'n' }, i.avgPeriod ? Math.round(i.avgPeriod * 10) / 10 : '–'), h('div', { class: 'l' }, 'Average period (days)')),
          h('div', { class: 'stat' }, h('div', { class: 'n' }, i.minCycle != null ? i.minCycle + '–' + i.maxCycle : '–'), h('div', { class: 'l' }, 'Shortest – longest')),
          h('div', { class: 'stat' }, h('div', { class: 'n', style: 'font-size:19px;padding-top:5px' }, i.regularity || 'Need 3+ cycles'), h('div', { class: 'l' }, 'Regularity'))),
        i.history.length ? [h('h3', {}, 'Cycle length history'), barChart(i.history, i.avgCycle)] : null));
      if (i.backtest) {
        const b = i.backtest;
        out.push(h('section', { class: 'card soft-lav' }, h('h2', {}, 'How accurate is Petal for you?'),
          h('p', {}, 'Looking back at your ' + plural(b.n, 'past period') + ', predictions made from earlier data were off by ' + (Math.round(b.mae * 10) / 10) + ' days on average, and within 2 days ' + Math.round(b.within2 * 100) + '% of the time.'),
          h('p', { class: 'small muted' }, 'This score updates every time you log a new period.')));
      }
    }
    const sy = i.symptoms.slice(0, 6), mo = i.moods.slice(0, 5);
    out.push(h('section', { class: 'card' }, h('h2', {}, 'Common symptoms'), sy.length ? barList(sy) : h('p', { class: 'muted' }, 'Log symptoms on the Today or Calendar tab and your patterns will show up here.')));
    if (mo.length) out.push(h('section', { class: 'card' }, h('h2', {}, 'Common moods'), barList(mo, 'lav')));
    out.push(h('section', { class: 'card' }, h('h2', {}, 'What Petal has learned'),
      h('div', { class: 'list' },
        h('div', { class: 'item' }, h('div', {}, h('div', { class: 't' }, 'Cycle length used'), h('div', { class: 's' }, A.predLen + ' days' + (A.learned.n >= 3 ? ' (from your history)' : ' (still blending with your estimate)'))), null),
        h('div', { class: 'item' }, h('div', {}, h('div', { class: 't' }, 'Period length used'), h('div', { class: 's' }, A.periodLen + ' days')), null),
        h('div', { class: 'item' }, h('div', {}, h('div', { class: 't' }, 'Luteal phase used'), h('div', { class: 's' }, A.lutealLen + ' days' + (A.learned.lutealN ? ' (learned from ' + plural(A.learned.lutealN, 'cycle') + ' with ovulation data)' : ' (default; log ovulation tests to personalize)'))), null))));
    return out;
  }

  /* =====================================================================
     SETTINGS
     ===================================================================== */
  function stepper(val, min, max, onChange, unit) {
    let v = val;
    const out = h('span', { class: 'val' }, v + (unit ? ' ' + unit : ''));
    const bump = (d) => () => { v = Math.min(max, Math.max(min, v + d)); out.textContent = v + (unit ? ' ' + unit : ''); onChange(v); };
    return h('div', { class: 'stepper' }, h('button', { type: 'button', 'aria-label': 'Decrease', onclick: bump(-1) }, '−'), out, h('button', { type: 'button', 'aria-label': 'Increase', onclick: bump(1) }, '+'));
  }
  function setRow(title, sub, control) { return h('div', { class: 'item' }, h('div', {}, h('div', { class: 't' }, title), sub ? h('div', { class: 's' }, sub) : null), control); }
  function select(opts, val, on) { const s = h('select', { style: 'width:auto;min-height:40px;padding:6px 10px', onchange: (e) => on(e.target.value) }, opts.map(([k, l]) => h('option', { value: k, selected: k === val }, l))); return s; }

  function viewSettings() {
    const P = S.profile;
    const upd = (fn) => { fn(); save(); };
    return [
      h('header', { class: 'top' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Settings'), h('h1', {}, 'Make it yours'))),
      h('section', { class: 'card' }, h('h2', {}, 'You'),
        h('label', { class: 'field' }, 'Name', h('input', { type: 'text', value: P.name, placeholder: 'Optional', autocomplete: 'off', oninput: (e) => upd(() => { P.name = e.target.value.trim(); }) })),
        h('div', { class: 'list' },
          setRow('Goal', 'Changes the wording Petal uses', select([['track', 'Understand my cycle'], ['conceive', 'Trying to conceive'], ['avoid', 'Avoiding pregnancy']], P.goal, (v) => upd(() => { P.goal = v; })))),
        h('p', { class: 'small muted' }, 'Petal is not birth control. Fertile windows are estimates, even with ovulation tests.')),
      h('section', { class: 'card' }, h('h2', {}, 'Your cycle'),
        h('p', { class: 'small muted' }, 'These are only starting guesses. Petal switches to your real history as you log periods.'),
        h('div', { class: 'list' },
          setRow('Typical cycle', 'First day to first day', stepper(P.cycleLen, 18, 60, (v) => upd(() => { P.cycleLen = v; }), 'days')),
          setRow('Typical period', null, stepper(P.periodLen, 1, 10, (v) => upd(() => { P.periodLen = v; }), 'days')),
          setRow('Luteal phase', 'Ovulation to next period. 14 is typical', stepper(P.lutealLen, 8, 18, (v) => upd(() => { P.lutealLen = v; }), 'days'))),
        h('div', { class: 'switch' }, h('div', {}, h('div', { class: 't', style: 'font-weight:600' }, 'My cycles are irregular'), h('div', { class: 'small muted' }, 'Widens prediction windows')),
          h('button', { class: 'toggle' + (P.irregular ? ' on' : ''), role: 'switch', 'aria-checked': P.irregular ? 'true' : 'false', 'aria-label': 'Irregular cycles', onclick: () => { upd(() => { P.irregular = !P.irregular; }); render(); } }))),
      h('section', { class: 'card' }, h('h2', {}, 'Display'),
        h('div', { class: 'list' },
          setRow('Theme', null, select([['auto', 'Match phone'], ['light', 'Light'], ['dark', 'Dark']], P.theme, (v) => { upd(() => { P.theme = v; }); applyTheme(); })),
          setRow('Week starts on', null, select([['0', 'Sunday'], ['1', 'Monday']], String(P.weekStart), (v) => upd(() => { P.weekStart = +v; }))),
          setRow('Temperature unit', 'For basal body temperature', select([['F', '°F'], ['C', '°C']], P.tempUnit, (v) => upd(() => { P.tempUnit = v; }))))),
      h('section', { class: 'card' }, h('h2', {}, 'Privacy'),
        h('p', { class: 'small muted' }, 'Your data is stored only on this phone. There is no account and no server. A PIN keeps casual snoopers out; it is not encryption.'),
        P.pin
          ? h('div', { class: 'row gap' }, h('button', { class: 'btn grow', onclick: () => pinSheet(true) }, 'Change PIN'), h('button', { class: 'btn danger grow', onclick: removePin }, 'Remove PIN'))
          : h('button', { class: 'btn block', onclick: () => pinSheet(false) }, 'Set a 4-digit PIN')),
      h('section', { class: 'card' }, h('h2', {}, 'Your data'),
        h('p', { class: 'small muted' }, 'Last backup: ' + (S.lastBackup ? fmt(S.lastBackup, { month: 'long', day: 'numeric', year: 'numeric' }) : 'never') + '. A backup file lets you move to a new phone or recover after a reset.'),
        h('div', { class: 'row gap wrap' }, h('button', { class: 'btn grow', onclick: exportData }, 'Back up data'),
          h('label', { class: 'btn grow center', style: 'display:flex;align-items:center;justify-content:center;cursor:pointer' }, 'Restore backup',
            h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: importData }))),
        h('button', { class: 'btn danger block', onclick: eraseAll }, 'Erase all data')),
      h('section', { class: 'card' }, h('h2', {}, 'Help'),
        h('button', { class: 'btn block', onclick: () => sheet('How Petal works', h('div', { class: 'sec' }, howList())) }, 'How to use Petal'),
        h('div', { class: 'list' }, h('div', { class: 'item' }, installHelp()))),
      h('p', { class: 'small muted center' }, 'Petal · made with care for one very specific person 💗')
    ];
  }

  function installHelp() {
    if (isStandalone()) return h('p', {}, '✓ Petal is installed on your home screen.');
    if (deferredInstall) return h('div', { class: 'sec' }, h('p', {}, 'Install Petal so it opens like a normal app, even offline.'), h('button', { class: 'btn primary', onclick: async () => { deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; render(); } }, 'Install app'));
    if (isIOS()) return h('p', {}, 'To install: open this page in Safari, tap the Share button, then “Add to Home Screen”. Open Petal from the new icon and set it up there.');
    return h('p', {}, 'To install: open this page in Chrome, tap the ⋮ menu, then “Install app” (or “Add to Home screen”). Open Petal from the new icon.');
  }

  /* ---------- PIN ---------- */
  async function hashPin(pin, salt) {
    const data = salt + ':' + pin;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let x = 5381; for (const ch of data) x = ((x << 5) + x + ch.charCodeAt(0)) | 0;
    return 'f' + x;
  }
  const newSalt = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  function pinSheet(isChange) {
    const err = h('p', { class: 'err' });
    const a = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '4', autocomplete: 'off' });
    const b = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '4', autocomplete: 'off' });
    const sh = sheet(isChange ? 'Change PIN' : 'Set a PIN', h('div', { class: 'sec' },
      h('label', { class: 'field' }, 'New 4-digit PIN', a), h('label', { class: 'field' }, 'Type it again', b), err,
      h('button', { class: 'btn primary block', onclick: async () => {
        if (!/^\d{4}$/.test(a.value)) { err.textContent = 'Use exactly 4 digits.'; return; }
        if (a.value !== b.value) { err.textContent = 'The PINs don’t match.'; return; }
        const salt = newSalt();
        S.profile.pin = { salt, hash: await hashPin(a.value, salt) };
        save(); sh.close(); toast('PIN saved');
      } }, 'Save PIN')));
  }
  function removePin() { if (confirm('Remove your PIN? Anyone who opens the app will see your data.')) { S.profile.pin = null; save(); render(); } }
  function viewLock() {
    let entry = '';
    const dots = h('div', { class: 'dots' });
    const msg = h('p', { class: 'muted' }, 'Enter your PIN');
    const paint = () => { dots.innerHTML = ''; for (let i = 0; i < 4; i++) dots.append(h('i', { class: i < entry.length ? 'on' : '' })); };
    const press = async (d) => {
      if (entry.length >= 4) return;
      entry += d; paint();
      if (entry.length === 4) {
        const ok = (await hashPin(entry, S.profile.pin.salt)) === S.profile.pin.hash;
        if (ok) { locked = false; render(); }
        else { entry = ''; msg.textContent = 'That PIN is wrong. Try again.'; dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); paint(); }
      }
    };
    paint();
    const keys = h('div', { class: 'keys' });
    '123456789'.split('').forEach((d) => keys.append(h('button', { 'aria-label': d, onclick: () => press(d) }, d)));
    keys.append(h('button', { class: 'ghost', style: 'font-size:13px', onclick: () => { if (confirm('Forgot your PIN? The only way in is to erase all data on this device. You can then restore from a backup file.')) { S = defaults(); localStorage.removeItem(KEY); locked = false; render(); } } }, 'Forgot?'),
      h('button', { 'aria-label': '0', onclick: () => press('0') }, '0'),
      h('button', { class: 'ghost', 'aria-label': 'Delete', onclick: () => { entry = entry.slice(0, -1); paint(); } }, '⌫'));
    return h('div', { class: 'lock' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 72, height: 72, style: 'border-radius:20px' }), h('h1', {}, 'Petal'), msg, dots, keys);
  }

  /* ---------- backup / restore ---------- */
  async function exportData() {
    const payload = JSON.stringify({ app: 'petal', version: 1, exported: new Date().toISOString(), data: S }, null, 2);
    const name = 'petal-backup-' + today() + '.json';
    let shared = false;
    try {
      const file = new File([payload], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Petal backup' }); shared = true; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    if (!shared) {
      const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
      const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    }
    S.lastBackup = today(); save(); toast('Backup ready. Keep it somewhere safe (Drive, iCloud, email).');
    if (tab === 'settings') render();
  }
  function sanitize(d) {
    d = d && d.data ? d.data : d;
    if (!d || typeof d !== 'object' || typeof d.logs !== 'object') throw new Error('bad');
    const base = defaults(), logs = {};
    Object.keys(d.logs).forEach((k) => { if (/^\d{4}-\d{2}-\d{2}$/.test(k) && d.logs[k] && typeof d.logs[k] === 'object') logs[k] = d.logs[k]; });
    return Object.assign(base, { profile: Object.assign(base.profile, d.profile || {}, { onboarded: true }), logs, lastBackup: d.lastBackup || null });
  }
  function importData(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const next = sanitize(JSON.parse(r.result));
        if (!confirm('Replace everything on this phone with the backup (' + Object.keys(next.logs).length + ' logged days)?')) return;
        S = next; save(); toast('Backup restored'); render();
      } catch (err) { toast('That file doesn’t look like a Petal backup.'); }
    };
    r.readAsText(f);
    e.target.value = '';
  }
  function eraseAll() {
    if (!confirm('Erase ALL Petal data from this phone? This cannot be undone.')) return;
    if (!confirm('Really erase everything? Consider backing up first.')) return;
    localStorage.removeItem(KEY); S = defaults(); ob = null; tab = 'today'; locked = false; render();
  }

  /* =====================================================================
     ONBOARDING
     ===================================================================== */
  function viewOnboarding() {
    if (!ob) ob = { step: 0, name: '', goal: 'track', last: '', periodLen: 5, cycleLen: 28, unsure: false, earlier: ['', '', ''], pin: '', pin2: '', err: '' };
    const steps = [obWelcome, obHow, obAbout, obLast, obCycle, obFinish];
    return h('div', { class: 'ob' },
      h('div', { class: 'ob-dots' }, steps.map((_, i) => h('i', { class: i === ob.step ? 'on' : i < ob.step ? 'done' : '' }))),
      steps[ob.step]());
  }
  const go = (d) => { ob.step += d; ob.err = ''; render(); window.scrollTo(0, 0); };
  function nav(nextLabel, onNext, opts) {
    opts = opts || {};
    return h('div', { class: 'ob-nav' },
      ob.step > 0 ? h('button', { class: 'btn ghost back', onclick: () => go(-1) }, 'Back') : null,
      h('button', { class: 'btn primary', id: 'ob-next', disabled: opts.disabled, onclick: onNext }, nextLabel));
  }
  function obWelcome() {
    return h('div', { class: 'ob-body' },
      h('div', { class: 'ob-body ob-hero' }, h('img', { class: 'ob-logo', src: 'icons/icon-192.png', alt: '' }), h('h1', {}, 'Welcome to Petal'),
        h('p', { class: 'lead' }, 'A period tracker that’s free, private, and learns your cycle.')),
      nav('Get started', () => go(1)));
  }
  function howList() {
    const f = (e, t, s) => h('div', { class: 'feat' }, h('div', { class: 'e' }, e), h('div', {}, h('b', {}, t), h('span', {}, s)));
    return [
      f('🔒', 'Private by design', 'Your data stays on this phone. No account, no cloud, nobody else can see it.'),
      f('🧠', 'It learns you', 'Predictions start from your setup, then adapt to your real cycles as you log them. Ovulation tests and temperatures make them sharper.'),
      f('👆', 'Logging is quick', 'Tap “My period is here” on the Today tab, or tap any day in the Calendar to add symptoms, mood and more.'),
      f('🎯', 'Honest about accuracy', 'Insights show how close Petal’s past predictions were. Predictions are estimates, and Petal is not birth control.'),
      f('💾', 'Back up sometimes', 'Settings → Back up data saves a file you can restore on a new phone.')
    ];
  }
  function obHow() {
    return h('div', { class: 'ob-body' },
      h('div', {}, h('h1', {}, 'How Petal works'), h('p', { class: 'lead', style: 'margin-top:6px' }, 'The short version.')),
      howList(),
      nav('Next', () => go(1)));
  }
  function obAbout() {
    const opt = (k, e, t, s) => h('button', { class: 'opt' + (ob.goal === k ? ' on' : ''), onclick: () => { ob.goal = k; render(); } }, h('span', { class: 'e' }, e), h('span', {}, h('b', {}, t), h('span', {}, s)));
    return h('div', { class: 'ob-body' },
      h('div', {}, h('h1', {}, 'About you'), h('p', { class: 'lead', style: 'margin-top:6px' }, 'This only tweaks wording. You can change it later.')),
      h('label', { class: 'field' }, 'What should Petal call you?', h('input', { type: 'text', placeholder: 'Name (optional)', value: ob.name, autocomplete: 'off', oninput: (e) => { ob.name = e.target.value; } })),
      h('div', { class: 'sec' }, h('h3', {}, 'What brings you here?'),
        opt('track', '🌸', 'Understand my cycle', 'Know what to expect and spot patterns'),
        opt('conceive', '🌱', 'Trying to conceive', 'Highlight fertile days'),
        opt('avoid', '🛡️', 'Avoiding pregnancy', 'Awareness only. Petal is not birth control')),
      nav('Next', () => go(1)));
  }
  function obLast() {
    const t = today();
    const next = h('button', { class: 'btn primary', id: 'ob-next', disabled: !ob.last, onclick: () => { if (!ob.last || ob.last > t) { ob.err = 'Pick a date that is today or earlier.'; render(); return; } go(1); } }, 'Next');
    return h('div', { class: 'ob-body' },
      h('div', {}, h('h1', {}, 'Your last period'), h('p', { class: 'lead', style: 'margin-top:6px' }, 'When did it start? Your best guess is fine.')),
      h('label', { class: 'field' }, 'First day of your last period', h('input', { type: 'date', max: t, value: ob.last, oninput: (e) => { ob.last = e.target.value; next.disabled = !ob.last; } })),
      h('div', { class: 'chips' }, h('button', { class: 'chip', onclick: () => { ob.last = t; render(); } }, 'It started today'), h('button', { class: 'chip', onclick: () => { ob.last = E.add(t, -7); render(); } }, 'About a week ago')),
      h('div', { class: 'row between' }, h('div', {}, h('b', {}, 'How long do periods usually last?'), h('div', { class: 'small muted' }, 'Days of bleeding')), stepper(ob.periodLen, 1, 10, (v) => { ob.periodLen = v; }, 'days')),
      ob.err ? h('p', { class: 'err' }, ob.err) : null,
      h('div', { class: 'ob-nav' }, ob.step > 0 ? h('button', { class: 'btn ghost back', onclick: () => go(-1) }, 'Back') : null, next));
  }
  function obCycle() {
    const t = today();
    const inputs = ob.earlier.map((v, i) => h('input', { type: 'date', max: ob.last || t, value: v, 'aria-label': 'Earlier period ' + (i + 1), oninput: (e) => { ob.earlier[i] = e.target.value; } }));
    return h('div', { class: 'ob-body' },
      h('div', {}, h('h1', {}, 'Your cycle'), h('p', { class: 'lead', style: 'margin-top:6px' }, 'From the first day of one period to the first day of the next. 21 to 35 days is typical.')),
      h('div', { class: 'row between' }, h('div', {}, h('b', {}, 'Typical cycle length'), h('div', { class: 'small muted' }, ob.unsure ? 'A rough guess is fine' : '')), stepper(ob.cycleLen, 18, 60, (v) => { ob.cycleLen = v; }, 'days')),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ob.unsure, onchange: (e) => { ob.unsure = e.target.checked; render(); } }), h('span', {}, 'I’m not sure, or my cycles vary a lot. Petal will use wider prediction windows.')),
      h('div', { class: 'sec' }, h('h3', {}, 'Optional: earlier periods'), h('p', { class: 'small muted' }, 'If you remember the start dates of up to 3 earlier periods, add them. Petal will learn your real pattern right away.'), inputs),
      ob.err ? h('p', { class: 'err' }, ob.err) : null,
      nav('Next', () => {
        const ds = ob.earlier.filter(Boolean).sort();
        const all = ds.concat([ob.last]);
        for (let i = 0; i < all.length - 1; i++) {
          const g = E.diff(all[i + 1], all[i]);
          if (g < 15) { ob.err = 'Two of those dates are only ' + plural(g, 'day') + ' apart. Periods usually start at least 3 weeks apart. Check the dates.'; render(); return; }
          if (g > 90) { ob.err = 'Those dates are far apart. Leave out any period you aren’t sure about.'; render(); return; }
        }
        ob.earlier = ds.concat(['', '', '']).slice(0, 3); go(1);
      }));
  }
  function obFinish() {
    const a = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '4', autocomplete: 'off', placeholder: '4 digits', value: ob.pin, oninput: (e) => { ob.pin = e.target.value; } });
    const b = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '4', autocomplete: 'off', placeholder: 'Repeat PIN', value: ob.pin2, oninput: (e) => { ob.pin2 = e.target.value; } });
    return h('div', { class: 'ob-body' },
      h('div', {}, h('h1', {}, 'Almost done'), h('p', { class: 'lead', style: 'margin-top:6px' }, 'Two quick things.')),
      h('div', { class: 'card' }, h('h2', {}, '🔒 Lock Petal (optional)'), h('p', { class: 'small muted' }, 'A 4-digit PIN keeps it private if someone picks up your phone. Leave blank to skip.'), a, b),
      h('div', { class: 'card soft-teal' }, h('h2', {}, '📲 Put it on your home screen'), installHelp(), !isStandalone() ? h('p', { class: 'small muted' }, 'Tip: install first, then finish setup in the installed app. The installed app keeps its own copy of your data.') : null),
      ob.err ? h('p', { class: 'err' }, ob.err) : null,
      nav('Start using Petal', async () => {
        if (ob.pin || ob.pin2) {
          if (!/^\d{4}$/.test(ob.pin)) { ob.err = 'A PIN needs exactly 4 digits, or leave both boxes empty.'; render(); return; }
          if (ob.pin !== ob.pin2) { ob.err = 'The PINs don’t match.'; render(); return; }
        }
        await finishOnboarding();
      }));
  }
  async function finishOnboarding() {
    const t = today(), P = S.profile;
    P.name = ob.name.trim(); P.goal = ob.goal; P.cycleLen = ob.cycleLen; P.periodLen = ob.periodLen; P.irregular = ob.unsure; P.onboarded = true;
    if (ob.pin) { const salt = newSalt(); P.pin = { salt, hash: await hashPin(ob.pin, salt) }; }
    ob.earlier.filter(Boolean).concat([ob.last]).forEach((s) => {
      for (let i = 0; i < ob.periodLen; i++) { const d = E.add(s, i); if (d <= t) S.logs[d] = Object.assign({}, S.logs[d], { period: true }); }
    });
    save(); ob = null; tab = 'today';
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    render(); window.scrollTo(0, 0);
  }

  /* ---------- boot ---------- */
  function boot() {
    if (S.profile.pin) locked = true;
    render();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (S.profile.pin && !locked && S.profile.onboarded && Date.now() - hiddenAt > 30000) { closeSheet(); locked = true; render(); }
      else if (!locked && S.profile.onboarded && !$ov.childElementCount) render(); // picks up a new day
    });
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if (!locked && (tab === 'settings' || !S.profile.onboarded || tab === 'today') && !$ov.childElementCount) render(); });
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }
  window.__petal = { get state() { return S; }, render, analyze: () => A };
  boot();
})();
