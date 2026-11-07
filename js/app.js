/* えふいーさん — 基本情報技術者試験 対策アプリ
 * 学習効果を高める仕組み：
 *  - 間隔反復（SM-2をベースにした復習スケジューリング）
 *  - 想起練習（4択の前に自分で考え、解説で理由まで確認）
 *  - 確信度評価（「勘で当たった」は未習得として早めに再出題）
 *  - 交互学習（分野を混ぜて出題）
 *  - 弱点の重点化（習熟度が低く配点の高い分野から新しい問題を出す）
 */
(function () {
  'use strict';

  /* ---------- データ準備 ---------- */
  const CATS = window.FE_CATS;
  const CAT = {};
  CATS.forEach((c) => { CAT[c.id] = c; });
  CAT['b-algo'] = { id: 'b-algo', name: '科目B アルゴリズム', field: '科目B', w: 16 };
  CAT['b-sec'] = { id: 'b-sec', name: '科目B 情報セキュリティ', field: '科目B', w: 4 };
  const LABELS = ['ア', 'イ', 'ウ', 'エ'];
  const DAY = 86400000;

  const ITEMS = [];
  const BYID = {};
  window.FE_QA.forEach((q) => { const it = Object.assign({ kind: 'A' }, q); ITEMS.push(it); BYID[it.id] = it; });
  window.FE_QB.forEach((q) => { const it = Object.assign({ kind: 'B' }, q); ITEMS.push(it); BYID[it.id] = it; });
  const ITEMS_A = ITEMS.filter((i) => i.kind === 'A');
  const ITEMS_B = ITEMS.filter((i) => i.kind === 'B');
  const TERMS = window.FE_TERMS.map((t) => Object.assign({ id: 'term:' + t.t }, t));
  const DRILLS = window.FE_DRILLS;

  /* ---------- 保存 ---------- */
  const KEY = 'fesan-v1';
  function defaultState() {
    return { v: 1, items: {}, terms: {}, log: {}, drills: {}, exams: [], marks: {},
      settings: { examDate: '', goal: 20, includeB: true }, created: Date.now() };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        const d = defaultState();
        return Object.assign(d, s, { settings: Object.assign(d.settings, s.settings || {}) });
      }
    } catch (e) { /* 読めなければ初期状態 */ }
    return defaultState();
  }
  let S = load();
  let saveWarned = false;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {
      if (!saveWarned) { saveWarned = true; toast('この環境では学習記録を保存できません'); }
    }
  }

  /* ---------- ユーティリティ ---------- */
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pct = (x) => Math.round(x * 100);
  function dayKey(t) { const d = new Date(t == null ? Date.now() : t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function daysLeft() {
    if (!S.settings.examDate) return null;
    const ex = new Date(S.settings.examDate + 'T00:00:00').getTime();
    if (isNaN(ex)) return null;
    return Math.round((ex - startOfDay(Date.now())) / DAY);
  }
  function fmtMs(ms) { const s = Math.max(0, Math.round(ms / 1000)); const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); }
  function fmtDur(ms) { const m = Math.round(ms / 60000); return m < 60 ? m + '分' : Math.floor(m / 60) + '時間' + (m % 60) + '分'; }
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function relDays(due) {
    const d = Math.round((startOfDay(due) - startOfDay(Date.now())) / DAY);
    if (due - Date.now() < 3600000) return 'このあとすぐ';
    if (d <= 0) return '今日';
    if (d === 1) return '明日';
    return d + '日後';
  }

  /* ---------- 間隔反復（SRS） ---------- */
  // grade: 0=不正解, 1=正解だが勘, 2=正解だが迷った, 3=自信をもって正解
  function schedule(st, grade, now) {
    st = st || { n: 0, iv: 0, ef: 2.5, due: 0, lapses: 0, seen: 0, ok: 0, hist: [] };
    st.seen++;
    if (grade > 0) st.ok++;
    st.hist.push([now, grade]);
    if (st.hist.length > 12) st.hist.shift();
    if (grade === 0) {
      st.lapses++; st.n = 0; st.iv = 0; st.ef = Math.max(1.3, st.ef - 0.2);
      st.due = now + 10 * 60000; st.last = 'ng';
    } else if (grade === 1) {
      st.n = 0; st.iv = 1; st.ef = Math.max(1.3, st.ef - 0.15);
      st.due = startOfDay(now) + DAY; st.last = 'guess';
    } else {
      let iv;
      if (st.n === 0) iv = grade === 3 ? 3 : 1;
      else if (st.n === 1) iv = grade === 3 ? 7 : 3;
      else iv = Math.round(st.iv * st.ef * (grade === 3 ? 1 : 0.6));
      st.ef = grade === 3 ? Math.min(3.0, st.ef + 0.1) : Math.max(1.3, st.ef - 0.05);
      iv = Math.max(1, iv);
      const dl = daysLeft();
      if (dl !== null && dl > 2) iv = Math.min(iv, Math.max(1, Math.floor(dl / 2))); // 試験日までに必ずもう一度復習できるように
      st.n++; st.iv = iv; st.due = startOfDay(now) + iv * DAY; st.last = grade === 3 ? 'ok' : 'unsure';
    }
    return st;
  }
  // 0〜1 の定着度（未学習=0）
  function strength(st) {
    if (!st) return 0;
    let v;
    if (st.last === 'ng') v = 0.1;
    else if (st.last === 'guess') v = 0.3;
    else v = (st.last === 'ok' ? 0.6 : 0.45) + 0.4 * Math.min(st.iv, 21) / 21;
    if (Date.now() > st.due + DAY) v *= 0.85; // 復習期限切れは少し割引
    return Math.min(1, v);
  }
  const itemStrength = (it) => strength(S.items[it.id]);

  function catStats(catId) {
    const items = ITEMS.filter((i) => i.cat === catId);
    let m = 0, seen = 0, att = 0, ok = 0;
    items.forEach((it) => {
      const st = S.items[it.id];
      m += strength(st);
      if (st) { seen++; att += st.seen; ok += st.ok; }
    });
    return { total: items.length, seen, mastery: items.length ? m / items.length : 0, att, ok, acc: att ? ok / att : null };
  }
  function readiness() {
    let sw = 0, sm = 0;
    CATS.forEach((c) => { sw += c.w; sm += c.w * catStats(c.id).mastery; });
    const b = ITEMS_B.reduce((s, it) => s + itemStrength(it), 0) / ITEMS_B.length;
    return { a: sm / sw, b };
  }
  function dueItems() {
    const now = Date.now();
    return ITEMS.filter((it) => { const st = S.items[it.id]; return st && st.due <= now; });
  }
  function dueTerms() {
    const now = Date.now();
    return TERMS.filter((t) => { const st = S.terms[t.id]; return st && st.due <= now; });
  }

  function logAdd(field, v) {
    const k = dayKey();
    const d = S.log[k] || (S.log[k] = { n: 0, ok: 0, t: 0, ms: 0 });
    d[field] = (d[field] || 0) + v;
  }
  function today() { return S.log[dayKey()] || { n: 0, ok: 0, t: 0, ms: 0 }; }
  function streak() {
    let s = 0;
    const t = new Date(); t.setHours(12, 0, 0, 0);
    const active = (k) => { const d = S.log[k]; return d && (d.n > 0 || d.t > 0); };
    if (!active(dayKey(t.getTime()))) t.setDate(t.getDate() - 1);
    while (active(dayKey(t.getTime()))) { s++; t.setDate(t.getDate() - 1); }
    return s;
  }

  /* ---------- 出題の組み立て ---------- */
  // 同じ分野が続かないように並べ替える（交互学習）
  function interleave(list) {
    const rest = shuffle(list);
    const out = [];
    while (rest.length) {
      const prev = out.length ? out[out.length - 1].cat : null;
      let k = rest.findIndex((x) => x.cat !== prev);
      if (k < 0) k = 0;
      out.push(rest.splice(k, 1)[0]);
    }
    return out;
  }
  // 未学習の問題を「配点が高く、習熟度が低い分野」から優先して選ぶ
  function pickNew(unseen, n, maxB) {
    const groups = {};
    unseen.forEach((it) => { (groups[it.cat] = groups[it.cat] || []).push(it); });
    Object.keys(groups).forEach((k) => { groups[k] = shuffle(groups[k]); });
    const out = [];
    let b = 0;
    while (out.length < n) {
      const cands = Object.keys(groups).filter((k) => groups[k].length && (!k.startsWith('b-') || b < maxB));
      if (!cands.length) break;
      const weights = cands.map((k) => {
        const w = k === 'b-algo' ? 3 : k === 'b-sec' ? 1 : CAT[k].w;
        return w * (1.15 - catStats(k).mastery);
      });
      let r = Math.random() * weights.reduce((a, x) => a + x, 0);
      let idx = 0;
      while (idx < weights.length - 1 && r >= weights[idx]) { r -= weights[idx]; idx++; }
      const it = groups[cands[idx]].pop();
      if (it.kind === 'B') b++;
      out.push(it);
    }
    return out;
  }
  function buildDaily() {
    const size = S.settings.goal;
    const pool = ITEMS.filter((it) => it.kind === 'A' || S.settings.includeB);
    const due = pool.filter((it) => { const st = S.items[it.id]; return st && st.due <= Date.now(); })
      .sort((x, y) => S.items[x.id].due - S.items[y.id].due);
    const unseen = pool.filter((it) => !S.items[it.id]);
    const newTarget = Math.min(unseen.length, Math.max(Math.ceil(size * 0.3), size - due.length));
    const picks = due.slice(0, size - newTarget);
    const bInPicks = picks.filter((i) => i.kind === 'B').length;
    picks.push(...pickNew(unseen, newTarget, Math.max(0, 2 - bInPicks)));
    if (picks.length < size) {
      const rest = pool.filter((it) => S.items[it.id] && !picks.includes(it)).sort((a, b) => itemStrength(a) - itemStrength(b));
      picks.push(...rest.slice(0, size - picks.length));
    }
    return interleave(picks);
  }
  function buildFromPool(pool, n) {
    const now = Date.now();
    const due = shuffle(pool.filter((it) => S.items[it.id] && S.items[it.id].due <= now));
    const unseen = shuffle(pool.filter((it) => !S.items[it.id]));
    const rest = pool.filter((it) => S.items[it.id] && S.items[it.id].due > now).sort((a, b) => itemStrength(a) - itemStrength(b));
    const out = [];
    for (const it of due.concat(unseen, rest)) { if (out.length >= n) break; if (!out.includes(it)) out.push(it); }
    return out;
  }
  function weakItems() {
    return ITEMS.filter((it) => { const st = S.items[it.id]; return st && (st.last === 'ng' || st.last === 'guess' || (st.lapses > 0 && st.n < 2)); })
      .sort((a, b) => itemStrength(a) - itemStrength(b));
  }
  function buildExam(type) {
    if (type === 'B') {
      return shuffle(ITEMS_B.filter((i) => i.cat === 'b-algo')).slice(0, 16).concat(shuffle(ITEMS_B.filter((i) => i.cat === 'b-sec')).slice(0, 4));
    }
    const scale = type === 'mini' ? 0.5 : 1;
    const target = Math.round(60 * scale);
    let out = [];
    CATS.forEach((c) => {
      const k = Math.max(1, Math.round(c.w * scale));
      out = out.concat(shuffle(ITEMS_A.filter((i) => i.cat === c.id)).slice(0, k));
    });
    if (out.length < target) out = out.concat(shuffle(ITEMS_A.filter((i) => !out.includes(i))).slice(0, target - out.length));
    out = out.slice(0, target);
    const order = CATS.map((c) => c.id);
    return out.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
  }
  function makeDrill(type) {
    const g = DRILLS[type];
    const q = g.gen();
    return { id: 'drill:' + type, kind: 'D', dtype: type, cat: g.cat, title: g.name, q: q.q, c: q.c, a: q.a, e: q.e };
  }

  /* ---------- セッション ---------- */
  let SES = null;
  let timerId = null;
  function startSession(items, opts) {
    if (!items.length) { toast('出題できる問題がありません'); return; }
    SES = Object.assign({ mode: 'practice', title: '演習', retry: true, timeLimit: 0, examType: null }, opts, {
      q: items.map((it) => ({ item: it, order: shuffle([0, 1, 2, 3].slice(0, it.c.length)), ans: null, grade: null, flag: false, retry: false, ms: 0 })),
      idx: 0, startedAt: Date.now(), shownAt: Date.now(), done: false
    });
    location.hash = '#/quiz';
    render();
  }
  function curQ() { return SES.q[SES.idx]; }
  function isCorrect(qq) { return qq.ans !== null && qq.order[qq.ans] === qq.item.a; }

  function answer(i) {
    const qq = curQ();
    if (SES.mode === 'exam') {
      qq.ans = i;
      renderQuiz();
      return;
    }
    if (qq.ans !== null) return;
    qq.ans = i;
    qq.ms = Date.now() - SES.shownAt;
    const ok = isCorrect(qq);
    const it = qq.item;
    if (it.kind === 'D') {
      const d = S.drills[it.dtype] || (S.drills[it.dtype] = { n: 0, ok: 0 });
      d.n++; if (ok) d.ok++;
      qq.grade = ok ? 2 : 0;
      logAdd('n', 1); if (ok) logAdd('ok', 1); logAdd('ms', qq.ms);
      if (!ok && SES.retry && !qq.retry) queueRetry(qq, true);
      save();
    } else if (qq.retry) {
      // 再挑戦：正解なら翌日にもう一度確認、不正解なら記録はそのまま
      if (ok) { const st = S.items[it.id]; if (st) { st.due = startOfDay(Date.now()) + DAY; } save(); }
      qq.grade = ok ? 2 : 0;
    } else if (!ok) {
      qq.grade = 0;
      S.items[it.id] = schedule(S.items[it.id], 0, Date.now());
      logAdd('n', 1); logAdd('ms', qq.ms);
      if (SES.retry) queueRetry(qq);
      save();
    }
    renderQuiz();
  }
  function queueRetry(qq, regenerate) {
    const item = regenerate ? makeDrill(qq.item.dtype) : qq.item;
    SES.q.push({ item, order: shuffle([0, 1, 2, 3].slice(0, item.c.length)), ans: null, grade: null, flag: false, retry: true, ms: 0 });
  }
  function grade(g) {
    const qq = curQ();
    if (qq.grade !== null || qq.ans === null) return;
    qq.grade = g;
    const st = S.items[qq.item.id] = schedule(S.items[qq.item.id], g, Date.now());
    logAdd('n', 1); logAdd('ok', 1); logAdd('ms', qq.ms);
    save();
    toast(g === 1 ? '明日もう一度出すね' : '次の復習：' + relDays(st.due));
    next();
  }
  function next() {
    if (SES.idx < SES.q.length - 1) { SES.idx++; SES.shownAt = Date.now(); render(); window.scrollTo(0, 0); }
    else finishSession();
  }
  function finishSession() {
    stopTimer();
    if (SES.mode === 'exam') {
      const now = Date.now();
      SES.q.forEach((qq) => {
        const ok = isCorrect(qq);
        qq.grade = ok ? 2 : 0;
        S.items[qq.item.id] = schedule(S.items[qq.item.id], ok ? 2 : 0, now);
        logAdd('n', 1); if (ok) logAdd('ok', 1);
      });
      const ms = now - SES.startedAt;
      logAdd('ms', ms);
      const n = SES.q.length, ok = SES.q.filter(isCorrect).length;
      S.exams.push({ at: now, type: SES.examType, n, ok, ms });
      if (S.exams.length > 50) S.exams.shift();
      save();
    }
    SES.done = true;
    SES.endedAt = Date.now();
    location.hash = '#/result';
    render();
  }
  function quitSession() {
    const answered = SES && SES.q.some((q) => q.ans !== null);
    if (SES && SES.mode === 'exam' && answered && !confirm('模擬試験を中断しますか？（解答は保存されません）')) return;
    stopTimer();
    if (SES && SES.mode !== 'exam' && answered) { SES.done = true; SES.endedAt = Date.now(); location.hash = '#/result'; render(); return; }
    SES = null;
    location.hash = '#/';
  }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
  function startTimer() {
    stopTimer();
    if (!SES || !SES.timeLimit) return;
    timerId = setInterval(() => {
      if (!SES || SES.done) { stopTimer(); return; }
      const left = SES.timeLimit - (Date.now() - SES.startedAt);
      const el = $('#timer');
      if (el) { el.textContent = '残り ' + fmtMs(left); el.classList.toggle('low', left < 5 * 60000); }
      if (left <= 0) { toast('時間切れ！採点します'); finishSession(); }
    }, 500);
  }

  /* ---------- 用語カード ---------- */
  let FS = null;
  function startFlash(cards, reverse) {
    if (!cards.length) { toast('対象のカードがありません'); return; }
    FS = { cards: cards.slice(), idx: 0, flipped: false, reverse: !!reverse, done: 0, again: 0 };
    location.hash = '#/flash';
    render();
  }
  function flashGrade(g) {
    const c = FS.cards[FS.idx];
    if (!c._again) {
      S.terms[c.id] = schedule(S.terms[c.id], g, Date.now());
      logAdd('t', 1);
      save();
    }
    FS.done++;
    if (g === 0) { FS.again++; FS.cards.push(Object.assign({}, c, { _again: true })); }
    FS.idx++; FS.flipped = false;
    render();
  }

  /* ---------- キャラクター ---------- */
  function mascot(mood) {
    const mouth = mood === 'sad' ? '<path d="M25 44 q7 -5 14 0" stroke="#1d2433" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
      : mood === 'wow' ? '<ellipse cx="32" cy="44" rx="4" ry="5" fill="#1d2433"/>'
        : '<path d="M24 41 q8 8 16 0" stroke="#1d2433" stroke-width="2.4" fill="none" stroke-linecap="round"/>';
    return `<svg class="mascot" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M14 18 L10 4 L24 12 Z" fill="#4c6ef5"/><path d="M50 18 L54 4 L40 12 Z" fill="#4c6ef5"/>
      <circle cx="32" cy="35" r="25" fill="#5c7cfa"/>
      <circle cx="32" cy="38" r="19" fill="#edf2ff"/>
      <circle cx="24" cy="33" r="6.5" fill="none" stroke="#1d2433" stroke-width="2"/>
      <circle cx="40" cy="33" r="6.5" fill="none" stroke="#1d2433" stroke-width="2"/>
      <path d="M30.5 33 h3" stroke="#1d2433" stroke-width="2"/>
      <circle cx="24" cy="33" r="2.4" fill="#1d2433"/><circle cx="40" cy="33" r="2.4" fill="#1d2433"/>
      <circle cx="17" cy="42" r="2.6" fill="#ffa8a8" opacity=".8"/><circle cx="47" cy="42" r="2.6" fill="#ffa8a8" opacity=".8"/>
      ${mouth}
      <rect x="22" y="10" width="20" height="11" rx="3" fill="#ffd43b"/>
      <text x="32" y="18.6" font-size="8.5" font-weight="800" text-anchor="middle" fill="#1d2433" font-family="system-ui,sans-serif">FE</text>
    </svg>`;
  }
  function hello(msg, mood) {
    return `<div class="hello">${mascot(mood)}<div class="bubble">${msg}</div></div>`;
  }
  const TIPS = [
    '解説は「なぜ他の選択肢が違うのか」まで読むと、似た問題にも強くなるよ。',
    '「勘で当たった」は正直に押してね。まだ身についていない問題として早めに出し直すよ。',
    '忘れかけたころに思い出すのが、いちばん記憶に残るんだ。毎日少しずつが最強！',
    '科目Bは頭の中だけで追わずに、変数の値を表に書きながらトレースしよう。',
    '計算問題は公式を覚えるより、何度も解いて手に覚えさせるのが近道だよ。',
    '分野をまぜて解くと、本番で「どの知識を使うか」を選ぶ力がつくよ。',
    '間違えた問題は、その場でもう一回出すよ。すぐに解き直すと定着しやすいんだ。',
    'セキュリティは科目Aでも科目Bでも出る重要分野。重点的にいこう！'
  ];

  /* ---------- 画面 ---------- */
  function setView(html) { $('#app').innerHTML = html; }
  function meter(v, cls) {
    const c = cls || (v >= 0.7 ? 'ok' : v >= 0.4 ? '' : v > 0 ? 'warn' : '');
    return `<div class="progress ${c}"><div style="width:${Math.max(0, Math.min(100, pct(v)))}%"></div></div>`;
  }

  function viewHome() {
    const t = today();
    const goal = S.settings.goal;
    const due = dueItems().length;
    const dueT = dueTerms().length;
    const st = streak();
    const dl = daysLeft();
    const rd = readiness();
    const seenCount = Object.keys(S.items).length;
    let msg, mood = 'happy';
    if (!seenCount && !Object.keys(S.terms).length) {
      msg = '<b>はじめまして、えふいーさんだよ！</b><br>基本情報技術者試験の合格まで、いっしょにがんばろう。まずは「今日の学習」から始めてみてね。試験日を設定すると、ペース配分も教えるよ。';
    } else if (t.n >= goal) {
      msg = `<b>今日の目標達成！すごい！</b>🎉<br>${TIPS[new Date().getDate() % TIPS.length]}`; mood = 'wow';
    } else if (due > 0) {
      msg = `<b>復習の時間だよ。</b>忘れかけた問題が <b>${due}問</b> あるよ。いま思い出すと記憶がぐっと長持ちするんだ。`;
    } else {
      msg = TIPS[(new Date().getDate() + seenCount) % TIPS.length];
    }
    if (st >= 2) msg += `<br><span class="small muted">🔥 ${st}日連続で学習中！</span>`;

    const daily = Math.min(goal, ITEMS.length);
    let examCard;
    if (dl === null) {
      examCard = `<div class="card"><div class="row"><div class="grow"><b>試験日を設定しよう</b><div class="small muted">復習の間隔と1日の目安を試験日に合わせて調整します。</div></div><a class="btn" href="#/settings">設定</a></div></div>`;
    } else if (dl >= 0) {
      const unseen = ITEMS.length - seenCount;
      const pace = dl > 0 ? Math.ceil(unseen / dl) : unseen;
      examCard = `<div class="card"><div class="row"><div class="grow"><div class="small muted">試験日まで</div><div style="font-size:28px;font-weight:800;line-height:1.2">${dl === 0 ? '今日が本番！' : 'あと ' + dl + ' 日'}</div></div>
        <div class="small muted" style="text-align:right">未学習 ${unseen}問<br>${dl > 0 ? '1日 約' + pace + '問の新規ペース' : '落ち着いていこう'}</div></div></div>`;
    } else {
      examCard = `<div class="card"><b>試験おつかれさま！</b><div class="small muted">次の試験日を設定すると、また計画を立てられます。<a href="#/settings">設定</a></div></div>`;
    }

    setView(`
      ${hello(msg, mood)}
      <div class="kpis">
        <div class="kpi"><div class="v">${st}<span class="small">日</span></div><div class="l">連続学習</div></div>
        <div class="kpi"><div class="v">${t.n}<span class="small">/${goal}</span></div><div class="l">今日の解答数</div></div>
        <div class="kpi"><div class="v">${due}<span class="small">問</span></div><div class="l">復習待ち</div></div>
      </div>
      ${meter(t.n / goal, t.n >= goal ? 'ok' : '')}
      <div style="margin:14px 0">
        <button class="btn primary big" data-act="daily">▶ 今日の学習をはじめる（${daily}問）</button>
        <div class="small muted center" style="margin-top:6px">復習期限の問題＋苦手分野の新しい問題を自動でミックスします</div>
      </div>
      ${examCard}
      <a class="card" href="#/stats" style="display:block;text-decoration:none;color:inherit">
        <div class="row"><b class="grow">合格準備度</b><span class="small muted">くわしく見る ›</span></div>
        <div class="row small" style="margin-top:6px"><span style="width:56px">科目A</span><div class="grow">${meter(rd.a)}</div><b style="width:44px;text-align:right">${pct(rd.a)}%</b></div>
        <div class="row small" style="margin-top:4px"><span style="width:56px">科目B</span><div class="grow">${meter(rd.b)}</div><b style="width:44px;text-align:right">${pct(rd.b)}%</b></div>
        <div class="small muted" style="margin-top:6px">全問題を「間隔をあけて自信をもって正解できる」状態を100%とした目安です。</div>
      </a>
      <h2>学習メニュー</h2>
      <div class="modes">
        <a class="mode" href="#/cats"><div class="t"><span class="emoji">📚</span>分野別演習</div><div class="d">15分野から選んで集中演習</div></a>
        <a class="mode" href="#/b"><div class="t"><span class="emoji">🧩</span>科目B対策</div><div class="d">擬似言語のトレースとセキュリティ</div></a>
        <a class="mode" href="#/exam"><div class="t"><span class="emoji">⏱️</span>模擬試験</div><div class="d">本番形式・時間制限つき</div></a>
        <a class="mode" href="#/drill"><div class="t"><span class="emoji">🧮</span>計算ドリル</div><div class="d">毎回数値が変わる無限ドリル</div></a>
        <a class="mode" href="#/terms"><div class="t"><span class="emoji">🃏</span>用語カード${dueT ? ` <span class="chip warn">${dueT}</span>` : ''}</div><div class="d">スキマ時間に用語を暗記</div></a>
        <a class="mode" href="#/weak"><div class="t"><span class="emoji">🎯</span>苦手克服</div><div class="d">間違えた・勘で当てた問題</div></a>
        <a class="mode" href="#/stats"><div class="t"><span class="emoji">📈</span>成績・分析</div><div class="d">分野別の習熟度と推移</div></a>
        <a class="mode" href="#/about"><div class="t"><span class="emoji">💡</span>学習のコツ</div><div class="d">このアプリの使い方と勉強法</div></a>
      </div>
    `);
  }

  function viewCats() {
    const fields = ['テクノロジ', 'マネジメント', 'ストラテジ'];
    let html = `<h1>分野別演習</h1><p class="muted small">分野をタップすると10問出題します（復習期限 → 未学習 → 苦手 の順）。バーは習熟度です。</p>`;
    fields.forEach((f) => {
      html += `<h2>${f}系</h2><div class="list">`;
      CATS.filter((c) => c.field === f).forEach((c) => {
        const s = catStats(c.id);
        html += `<button class="item" data-act="cat" data-arg="${c.id}"><div class="main"><div class="name">${esc(c.name)}</div>
          <div class="sub">${s.seen}/${s.total}問 学習済み${s.acc !== null ? '・正答率 ' + pct(s.acc) + '%' : ''}・本番目安 約${c.w}問</div></div>
          <div class="meter">${meter(s.mastery)}<div class="small muted center">${pct(s.mastery)}%</div></div></button>`;
      });
      html += '</div>';
    });
    html += `<h2>まとめて</h2><div class="list"><button class="item" data-act="allA"><div class="main"><div class="name">科目A 全分野からランダム20問</div><div class="sub">交互学習で実戦力をつける</div></div></button></div>`;
    setView(html);
  }

  function viewB() {
    const rows = ITEMS_B.map((it) => {
      const st = S.items[it.id];
      const chip = !st ? '<span class="chip">未学習</span>' : st.last === 'ng' ? '<span class="chip ng">要復習</span>' : st.last === 'guess' ? '<span class="chip warn">あいまい</span>' : '<span class="chip ok">正解</span>';
      return `<button class="item" data-act="one" data-arg="${it.id}"><div class="main"><div class="name">${esc(it.title)}</div><div class="sub">${it.cat === 'b-algo' ? 'アルゴリズムとプログラミング' : '情報セキュリティ'}</div></div>${chip}</button>`;
    }).join('');
    setView(`
      <h1>科目B対策</h1>
      ${hello('科目Bは<b>トレース力</b>が勝負！変数の値の変化を表に書きながら1行ずつ追ってみてね。空欄問題は、具体的な値（i = 1 など）を当てはめて確かめるのがコツだよ。')}
      <div class="card">
        <h3 class="mt0">擬似言語の読み方メモ</h3>
        <ul class="small tips">
          <li>配列の添字は <b>1から</b> 始まる（data[1] が先頭）</li>
          <li><code>x ← y</code> は代入、<code>÷ の商</code> は整数の割り算、<code>mod</code> は余り</li>
          <li><code>for (i を 1 から n まで 1 ずつ増やす)</code> は i = 1, 2, …, n で繰り返す</li>
          <li><code>○整数型: f(…)</code> は戻り値をもつ関数、<code>○f(…)</code> は手続</li>
        </ul>
      </div>
      <div class="row" style="margin:12px 0">
        <button class="btn primary grow" data-act="bmix">おすすめ5問</button>
        <button class="btn grow" data-act="bcat" data-arg="b-algo">アルゴリズム</button>
        <button class="btn grow" data-act="bcat" data-arg="b-sec">セキュリティ</button>
      </div>
      <div class="list">${rows}</div>
    `);
  }

  function viewExam() {
    const hist = S.exams.slice().reverse().slice(0, 10).map((e) => {
      const name = e.type === 'A' ? '科目A' : e.type === 'mini' ? '科目A ミニ' : '科目B';
      const r = e.ok / e.n;
      return `<tr><td>${dayKey(e.at)}</td><td>${name}</td><td class="num">${e.ok}/${e.n}</td><td class="num"><span class="chip ${r >= 0.6 ? 'ok' : 'ng'}">${pct(r)}%</span></td><td class="num">${fmtDur(e.ms)}</td></tr>`;
    }).join('');
    setView(`
      <h1>模擬試験</h1>
      <p class="muted small">本番と同じく、解答中は正誤が表示されません。見直しフラグや問題一覧を使って時間配分の練習をしましょう。結果は復習スケジュールにも反映されます。</p>
      <div class="list">
        <button class="item" data-act="exam" data-arg="A"><div class="main"><div class="name">科目A 本番形式</div><div class="sub">60問・90分・分野の出題比率を本番に近づけています</div></div><span class="chip">90分</span></button>
        <button class="item" data-act="exam" data-arg="mini"><div class="main"><div class="name">科目A ミニ模試</div><div class="sub">30問・45分・時間がないとき用</div></div><span class="chip">45分</span></button>
        <button class="item" data-act="exam" data-arg="B"><div class="main"><div class="name">科目B 本番形式</div><div class="sub">${ITEMS_B.length}問・100分（アルゴリズム16問＋セキュリティ4問）</div></div><span class="chip">100分</span></button>
      </div>
      <p class="small muted">合格基準は各科目 1000点満点中600点。このアプリでは正答率60%を目安に表示します（本番はIRTで採点されるため、正答率と得点は一致しません）。</p>
      ${hist ? `<h2>受験履歴</h2><div class="card" style="overflow-x:auto"><table class="t"><tr><th>日付</th><th>種類</th><th class="num">正解</th><th class="num">正答率</th><th class="num">時間</th></tr>${hist}</table></div>` : ''}
    `);
  }

  function viewDrill() {
    const rows = Object.keys(DRILLS).map((k) => {
      const d = S.drills[k];
      const acc = d && d.n ? d.ok / d.n : null;
      return `<button class="item" data-act="drill" data-arg="${k}"><div class="main"><div class="name">${esc(DRILLS[k].name)}</div><div class="sub">${CAT[DRILLS[k].cat].name}${d ? '・' + d.n + '問解答' : ''}</div></div>
        ${acc === null ? '<span class="chip">未挑戦</span>' : `<span class="chip ${acc >= 0.8 ? 'ok' : acc >= 0.5 ? 'warn' : 'ng'}">${pct(acc)}%</span>`}</button>`;
    }).join('');
    setView(`
      <h1>計算ドリル</h1>
      ${hello('計算問題は<b>毎回数値が変わる</b>から、答えの丸暗記じゃなく「解き方」が身につくよ。正答率80%を超えるまで繰り返そう！')}
      <div style="margin:12px 0"><button class="btn primary big" data-act="drillmix">🔀 ミックス10問</button></div>
      <div class="list">${rows}</div>
    `);
  }

  function viewTerms() {
    const due = dueTerms();
    const fresh = TERMS.filter((t) => !S.terms[t.id]);
    const learned = TERMS.length - fresh.length;
    const catOpts = CATS.map((c) => {
      const n = TERMS.filter((t) => t.cat === c.id).length;
      return n ? `<button class="item" data-act="tcat" data-arg="${c.id}"><div class="main"><div class="name">${esc(c.name)}</div></div><span class="chip">${n}枚</span></button>` : '';
    }).join('');
    setView(`
      <h1>用語カード</h1>
      <p class="muted small">カードをタップして答えを確認し、思い出せたかを自己採点します。忘れたカードはその場でもう一度出ます。覚えたカードは間隔をあけて復習されます。</p>
      <div class="kpis">
        <div class="kpi"><div class="v">${due.length}</div><div class="l">復習待ち</div></div>
        <div class="kpi"><div class="v">${fresh.length}</div><div class="l">未学習</div></div>
        <div class="kpi"><div class="v">${learned}</div><div class="l">学習済み</div></div>
      </div>
      <label class="toggle"><input type="checkbox" id="trev" ${S.settings.termReverse ? 'checked' : ''}> 意味から用語を思い出す（逆方向・より効果的）</label>
      <div class="row" style="margin:12px 0">
        <button class="btn primary grow" data-act="tdue" ${due.length ? '' : 'disabled'}>復習する（${due.length}枚）</button>
        <button class="btn grow" data-act="tnew" ${fresh.length ? '' : 'disabled'}>新しいカード（10枚）</button>
      </div>
      <h2>分野で選ぶ</h2>
      <div class="list">${catOpts}</div>
    `);
    $('#trev').addEventListener('change', (e) => { S.settings.termReverse = e.target.checked; save(); });
  }

  function viewFlash() {
    if (!FS) { location.hash = '#/terms'; return; }
    if (FS.idx >= FS.cards.length) {
      setView(`${hello(`<b>おつかれさま！</b><br>${FS.done}枚のカードを確認したよ。${FS.again ? '忘れていたカードもちゃんと思い出し直せたね。' : ''}`, 'wow')}
        <div class="row" style="margin-top:16px"><a class="btn primary grow" href="#/terms">用語カードへ</a><a class="btn grow" href="#/">ホーム</a></div>`);
      FS = null; return;
    }
    const c = FS.cards[FS.idx];
    const front = FS.reverse ? esc(c.d) : esc(c.t);
    const back = FS.reverse ? esc(c.t) : esc(c.d);
    const remain = FS.cards.length - FS.idx;
    setView(`
      <div class="qhead"><button class="icon-btn" data-act="fquit" aria-label="終了">✕</button>${meter(FS.idx / FS.cards.length)}<span class="qnum">残り ${remain}</span></div>
      <div class="row"><span class="chip">${esc(CAT[c.cat].name)}</span>${c._again ? '<span class="chip warn">もう一度</span>' : ''}</div>
      <div class="card flash ${FS.reverse ? 'rev' : ''}" data-act="flip">
        <div class="front">${front}</div>
        ${FS.flipped ? `<div class="back">${back}</div>` : '<div class="small muted" style="margin-top:16px">頭の中で答えてからタップ</div>'}
      </div>
      ${FS.flipped ? `<div class="conf">
        <button class="btn" data-act="fg" data-arg="0">忘れた<small>もう一度</small></button>
        <button class="btn" data-act="fg" data-arg="2">あいまい<small>思い出せた</small></button>
        <button class="btn primary" data-act="fg" data-arg="3">覚えてた<small>すぐ言えた</small></button>
      </div><div class="kbd-hint">キーボード：1 / 2 / 3</div>` : '<div class="kbd-hint">キーボード：スペースでめくる</div>'}
    `);
  }

  function renderQuiz() {
    if (!SES) { location.hash = '#/'; return; }
    const qq = curQ();
    const it = qq.item;
    const exam = SES.mode === 'exam';
    const answered = qq.ans !== null;
    const reveal = !exam && answered;
    const ok = isCorrect(qq);
    const total = SES.q.length;
    const head = exam
      ? `<div class="qhead"><button class="icon-btn" data-act="quit" aria-label="中断">✕</button><span class="timer" id="timer">残り ${fmtMs(SES.timeLimit - (Date.now() - SES.startedAt))}</span><span class="grow" style="flex:1"></span><span class="qnum">${SES.idx + 1} / ${total}</span></div>`
      : `<div class="qhead"><button class="icon-btn" data-act="quit" aria-label="終了">✕</button>${meter(SES.idx / total)}<span class="qnum">${SES.idx + 1} / ${total}</span></div>`;

    const choices = qq.order.map((oi, di) => {
      let cls = '';
      if (reveal) { if (oi === it.a) cls = 'correct'; else if (di === qq.ans) cls = 'wrong'; }
      else if (exam && di === qq.ans) cls = 'sel';
      return `<button class="choice ${cls}" data-act="ans" data-arg="${di}" ${reveal ? 'disabled' : ''}><span class="lbl">${LABELS[di]}</span><span class="txt">${esc(it.c[oi])}</span></button>`;
    }).join('');

    let fb = '';
    if (reveal) {
      const correctLabel = LABELS[qq.order.indexOf(it.a)];
      fb = `<div class="feedback ${ok ? 'ok' : 'ng'}"><div class="verdict">${ok ? '⭕ 正解！' : '❌ 不正解… 正解は「' + correctLabel + '」'}</div><div class="exp">${esc(it.e)}</div></div>`;
      if (ok && !qq.retry && it.kind !== 'D' && qq.grade === null) {
        fb += `<div class="small muted center">どのくらい自信があった？（正直に答えるほど復習が最適化されます）</div>
          <div class="conf">
            <button class="btn primary" data-act="grade" data-arg="3">自信あり<small>理由も説明できる</small></button>
            <button class="btn" data-act="grade" data-arg="2">迷った<small>なんとなく</small></button>
            <button class="btn" data-act="grade" data-arg="1">勘で当たった<small>まぐれ</small></button>
          </div><div class="kbd-hint">キーボード：1 / 2 / 3</div>`;
      } else {
        const note = !ok && !qq.retry && SES.retry ? '<div class="small muted center">この問題はセッションの最後にもう一度出題します</div>' : '';
        fb += `${note}<button class="btn primary big" data-act="next" style="margin-top:8px">${SES.idx < total - 1 ? '次へ →' : '結果を見る'}</button><div class="kbd-hint">Enter で次へ</div>`;
      }
    }

    let examNav = '';
    if (exam) {
      const grid = SES.q.map((x, i) => `<button class="${x.ans !== null ? 'done' : ''} ${x.flag ? 'flag' : ''} ${i === SES.idx ? 'cur' : ''}" data-act="go" data-arg="${i}">${i + 1}</button>`).join('');
      const remain = SES.q.filter((x) => x.ans === null).length;
      examNav = `<div class="row" style="margin-top:4px">
          <button class="btn" data-act="prev" ${SES.idx === 0 ? 'disabled' : ''}>← 前へ</button>
          <button class="btn ${qq.flag ? 'primary' : ''}" data-act="flag">🚩 見直し</button>
          <button class="btn grow" data-act="enext" ${SES.idx === total - 1 ? 'disabled' : ''}>次へ →</button>
        </div>
        <div class="grid-nav">${grid}</div>
        <button class="btn big ${remain ? '' : 'primary'}" data-act="submit">解答を終了して採点する${remain ? `（未解答 ${remain}問）` : ''}</button>
        <div class="kbd-hint">キーボード：1〜4 で選択、← → で移動</div>`;
    }

    const isNewItem = !exam && !qq.retry && it.kind !== 'D' && !S.items[it.id];
    setView(`
      ${head}
      <div class="row" style="margin-bottom:6px"><span class="chip">${esc(CAT[it.cat].name)}</span>${qq.retry ? '<span class="chip warn">再挑戦</span>' : ''}${isNewItem && !answered ? '<span class="chip ok">NEW</span>' : ''}${it.title && it.kind !== 'A' ? `<b class="small">${esc(it.title)}</b>` : ''}</div>
      <div class="qtext">${esc(it.q)}</div>
      ${it.code ? `<pre class="code">${esc(it.code)}</pre>` : ''}
      <div class="choices">${choices}</div>
      ${fb}
      ${examNav}
    `);
    if (exam) startTimer();
  }

  function viewResult() {
    if (!SES || !SES.done) { location.hash = '#/'; return; }
    const first = SES.q.filter((x) => !x.retry && x.ans !== null || (SES.mode === 'exam' && !x.retry));
    const n = first.length;
    const ok = first.filter(isCorrect).length;
    const r = n ? ok / n : 0;
    const exam = SES.mode === 'exam';
    const ms = (SES.endedAt || Date.now()) - SES.startedAt;
    const byCat = {};
    first.forEach((x) => { const c = byCat[x.item.cat] || (byCat[x.item.cat] = { n: 0, ok: 0 }); c.n++; if (isCorrect(x)) c.ok++; });
    const catRows = Object.keys(byCat).map((k) => {
      const c = byCat[k]; const cr = c.ok / c.n;
      return `<tr><td>${esc(CAT[k].name)}</td><td class="num">${c.ok}/${c.n}</td><td style="width:35%">${meter(cr, cr >= 0.6 ? 'ok' : 'ng')}</td></tr>`;
    }).join('');
    const wrong = first.filter((x) => !isCorrect(x));
    const wrongHtml = wrong.map((x) => {
      const it = x.item;
      const yours = x.ans === null ? '未解答' : LABELS[x.ans] + '：' + it.c[x.order[x.ans]];
      const corr = LABELS[x.order.indexOf(it.a)] + '：' + it.c[it.a];
      return `<details class="wrongq"><summary>${esc(it.title || CAT[it.cat].name)}：${esc(it.q.slice(0, 40))}${it.q.length > 40 ? '…' : ''}</summary>
        <div class="qtext small" style="margin-top:8px">${esc(it.q)}</div>${it.code ? `<pre class="code">${esc(it.code)}</pre>` : ''}
        <p class="small"><span class="chip ng">あなたの解答</span> ${esc(yours)}<br><span class="chip ok">正解</span> ${esc(corr)}</p>
        <div class="exp">${esc(it.e)}</div></details>`;
    }).join('');
    const pass = r >= 0.6;
    let msg;
    if (exam) msg = pass ? `<b>合格ラインの60%を超えたよ！</b>この調子で本番まで仕上げよう。` : `<b>合格ラインまであと ${Math.max(1, Math.ceil(n * 0.6) - ok)}問！</b>間違えた問題は復習リストに入れたから、明日以降の「今日の学習」で出てくるよ。`;
    else if (r >= 0.8) msg = '<b>すばらしい！</b>正解した問題も、間隔をあけてもう一度出すよ。それで記憶が長持ちするんだ。';
    else if (r >= 0.5) msg = '<b>いい調子！</b>間違えた問題の解説をもう一度読んでおこう。理由がわかれば次は解けるよ。';
    else msg = '<b>おつかれさま！</b>間違えるのは伸びしろだよ。間違えた問題は自動で復習に回すから安心してね。';
    const wrongIds = wrong.map((x) => x.item).filter((it) => it.kind !== 'D').map((it) => it.id);
    const drillTypes = SES.drillTypes;
    setView(`
      ${hello(msg, r >= 0.6 ? 'wow' : 'happy')}
      <div class="card score">
        <div class="muted small">${esc(SES.title)}</div>
        <div class="big">${pct(r)}<span style="font-size:22px">%</span></div>
        <div>${ok} / ${n} 問正解（1回目の解答）</div>
        ${exam ? `<div class="pass" style="color:var(--${pass ? 'ok' : 'ng'})">${pass ? '合格ライン到達' : '合格ライン（60%）未達'}</div>` : ''}
        <div class="small muted">所要時間 ${fmtDur(ms)}${n ? '・1問あたり ' + Math.round(ms / n / 1000) + '秒' : ''}</div>
      </div>
      ${catRows ? `<h2>分野別</h2><div class="card"><table class="t">${catRows}</table></div>` : ''}
      ${exam ? `<h2>解答一覧</h2><div class="grid-nav">${SES.q.map((x, i) => `<button class="${isCorrect(x) ? 'ok' : 'ng'}" disabled>${i + 1}</button>`).join('')}</div>` : ''}
      ${wrong.length ? `<h2>間違えた問題（${wrong.length}）</h2>${wrongHtml}` : ''}
      <div class="row" style="margin-top:16px">
        ${wrongIds.length ? `<button class="btn primary grow" data-act="redo" data-arg="${wrongIds.join(',')}">間違えた問題をもう一度</button>` : ''}
        ${drillTypes ? `<button class="btn primary grow" data-act="drillagain">もう10問</button>` : ''}
        <a class="btn grow" href="#/">ホームへ</a>
      </div>
    `);
  }

  function viewWeak() {
    const list = weakItems();
    const rows = list.slice(0, 50).map((it) => {
      const st = S.items[it.id];
      const chip = st.last === 'ng' ? '<span class="chip ng">不正解</span>' : st.last === 'guess' ? '<span class="chip warn">勘</span>' : '<span class="chip warn">不安定</span>';
      return `<button class="item" data-act="one" data-arg="${it.id}"><div class="main"><div class="name">${esc(it.title || it.q.slice(0, 34) + (it.q.length > 34 ? '…' : ''))}</div><div class="sub">${esc(CAT[it.cat].name)}・間違い ${st.lapses}回</div></div>${chip}</button>`;
    }).join('');
    const counts = {};
    list.forEach((it) => { counts[it.cat] = (counts[it.cat] || 0) + 1; });
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 3).map((k) => CAT[k].name);
    setView(`
      <h1>苦手克服</h1>
      ${list.length
        ? hello(`苦手な問題が <b>${list.length}問</b> あるよ。${top.length ? '特に <b>' + top.map(esc).join('、') + '</b> に集中しているみたい。' : ''}解説を読んだら、もう一度チャレンジしよう！`)
        : hello('いまは苦手な問題がないよ！問題を解いて、間違えたり勘で当てたりした問題がここに集まるよ。')}
      ${list.length ? `<div style="margin:12px 0"><button class="btn primary big" data-act="weak">苦手な問題を${Math.min(10, list.length)}問解く</button></div><div class="list">${rows}</div>` : ''}
    `);
  }

  function viewStats() {
    const rd = readiness();
    const rows = CATS.map((c) => {
      const s = catStats(c.id);
      return `<tr><td>${esc(c.name)}<div class="small muted">${s.seen}/${s.total}問</div></td><td class="num">${s.acc === null ? '—' : pct(s.acc) + '%'}</td><td style="width:34%">${meter(s.mastery)}</td><td class="num">${pct(s.mastery)}%</td></tr>`;
    }).join('');
    const bS = ['b-algo', 'b-sec'].map((k) => { const s = catStats(k); return `<tr><td>${esc(CAT[k].name)}<div class="small muted">${s.seen}/${s.total}問</div></td><td class="num">${s.acc === null ? '—' : pct(s.acc) + '%'}</td><td style="width:34%">${meter(s.mastery)}</td><td class="num">${pct(s.mastery)}%</td></tr>`; }).join('');
    // 直近14日
    const days = [];
    for (let i = 13; i >= 0; i--) { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i); days.push(d); }
    const vals = days.map((d) => { const l = S.log[dayKey(d.getTime())]; return l ? l.n + l.t : 0; });
    const mx = Math.max(10, ...vals);
    const bars = days.map((d, i) => `<div class="bar" title="${dayKey(d.getTime())}：${vals[i]}"><div class="${vals[i] ? '' : 'zero'}" style="height:${Math.max(2, vals[i] / mx * 80)}px"></div><span>${d.getDate()}</span></div>`).join('');
    const totals = Object.values(S.log).reduce((a, l) => { a.n += l.n || 0; a.ok += l.ok || 0; a.t += l.t || 0; a.ms += l.ms || 0; return a; }, { n: 0, ok: 0, t: 0, ms: 0 });
    const weakest = CATS.map((c) => ({ c, s: catStats(c.id) })).sort((a, b) => (a.s.mastery - b.s.mastery) || (b.c.w - a.c.w)).slice(0, 3);
    const drillRows = Object.keys(DRILLS).filter((k) => S.drills[k]).map((k) => { const d = S.drills[k]; return `<tr><td>${esc(DRILLS[k].name)}</td><td class="num">${d.ok}/${d.n}</td><td class="num">${pct(d.ok / d.n)}%</td></tr>`; }).join('');
    setView(`
      <h1>成績・分析</h1>
      <div class="kpis">
        <div class="kpi"><div class="v">${pct(rd.a)}%</div><div class="l">科目A 準備度</div></div>
        <div class="kpi"><div class="v">${pct(rd.b)}%</div><div class="l">科目B 準備度</div></div>
        <div class="kpi"><div class="v">${totals.n ? pct(totals.ok / totals.n) : 0}%</div><div class="l">通算正答率</div></div>
      </div>
      <div class="card">
        <b>次に強化したい分野</b>
        <p class="small muted mt0">配点が高く習熟度が低い分野です。「今日の学習」はここから優先的に新しい問題を出します。</p>
        <div class="list">${weakest.map((w) => `<button class="item" data-act="cat" data-arg="${w.c.id}"><div class="main"><div class="name">${esc(w.c.name)}</div><div class="sub">習熟度 ${pct(w.s.mastery)}%・本番目安 約${w.c.w}問</div></div><span class="chip">演習 ›</span></button>`).join('')}</div>
      </div>
      <h2>直近14日の学習量</h2>
      <div class="card"><div class="bars">${bars}</div><div class="small muted">問題＋用語カードの合計　｜　通算 ${totals.n}問・カード ${totals.t}枚・${fmtDur(totals.ms)}</div></div>
      <h2>分野別</h2>
      <div class="card" style="overflow-x:auto"><table class="t"><tr><th>分野</th><th class="num">正答率</th><th>習熟度</th><th></th></tr>${rows}${bS}</table>
      <p class="small muted">正答率＝これまでの全解答の正解割合。習熟度＝分野内の全問題について、間隔をあけて自信をもって正解できているかを0〜100%で表したもの（未学習は0）。</p></div>
      ${drillRows ? `<h2>計算ドリル</h2><div class="card"><table class="t"><tr><th>種類</th><th class="num">正解</th><th class="num">正答率</th></tr>${drillRows}</table></div>` : ''}
    `);
  }

  function viewSettings() {
    setView(`
      <h1>設定</h1>
      <div class="card">
        <label class="f" for="exd">試験日</label>
        <input type="date" id="exd" value="${esc(S.settings.examDate)}">
        <p class="small muted">設定すると、試験日までに必ずもう一度復習できるように間隔を調整し、1日の目安ペースを表示します。</p>
        <label class="f" for="goal">1日の目標問題数</label>
        <select id="goal">${[10, 15, 20, 30, 40, 50].map((g) => `<option value="${g}" ${S.settings.goal === g ? 'selected' : ''}>${g}問</option>`).join('')}</select>
        <label class="toggle"><input type="checkbox" id="incB" ${S.settings.includeB ? 'checked' : ''}> 「今日の学習」に科目Bの問題も含める（1回あたり最大2問）</label>
      </div>
      <h2>データ</h2>
      <div class="card">
        <p class="small muted mt0">学習記録はこの端末のブラウザ内にだけ保存されます。機種変更や別のブラウザに移すときはバックアップを使ってください。</p>
        <div class="row">
          <button class="btn" data-act="export">バックアップを保存</button>
          <label class="btn" for="imp">バックアップから復元</label>
          <input type="file" id="imp" accept="application/json,.json" class="hide">
        </div>
        <div class="row" style="margin-top:12px"><button class="btn danger" data-act="reset">学習記録をすべて削除</button></div>
      </div>
      <p class="small muted center">収録：科目A ${ITEMS_A.length}問／科目B ${ITEMS_B.length}問／用語 ${TERMS.length}語／計算ドリル ${Object.keys(DRILLS).length}種</p>
    `);
    $('#exd').addEventListener('change', (e) => { S.settings.examDate = e.target.value; save(); toast('試験日を保存しました'); });
    $('#goal').addEventListener('change', (e) => { S.settings.goal = parseInt(e.target.value, 10); save(); toast('目標を保存しました'); });
    $('#incB').addEventListener('change', (e) => { S.settings.includeB = e.target.checked; save(); });
    $('#imp').addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const s = JSON.parse(rd.result);
          if (!s || typeof s.items !== 'object' || typeof s.settings !== 'object') throw new Error('bad');
          if (!confirm('現在の学習記録を、バックアップの内容で置き換えますか？')) return;
          const d = defaultState();
          S = Object.assign(d, s, { settings: Object.assign(d.settings, s.settings) });
          save(); toast('復元しました'); render();
        } catch (err) { toast('バックアップファイルを読み込めませんでした'); }
      };
      rd.readAsText(f);
    });
  }

  function viewAbout() {
    setView(`
      <h1>学習のコツ</h1>
      ${hello('えふいーさんは、学習科学で効果が確かめられている方法を組み合わせているよ。仕組みを知って使うと、もっと効率が上がるんだ！')}
      <div class="card">
        <h3 class="mt0">① 間隔反復（忘れる直前に復習）</h3>
        <p class="small">正解した問題は 1日 → 3日 → 1週間 → … と間隔を広げて出し直します。間違えた問題はその場でもう一度、さらに翌日以降にも出ます。試験日を設定すると、試験前に必ず一巡するよう間隔を調整します。</p>
        <h3>② 想起練習（自分で思い出す）</h3>
        <p class="small">解説を読むより「解いて思い出す」ほうが記憶に残ります。選択肢を見る前に、答えを頭の中で予想してから選ぶとさらに効果的です。</p>
        <h3>③ 確信度の評価</h3>
        <p class="small">正解したら「自信あり／迷った／勘」を選びます。勘で当たった問題は未習得として翌日に出します。正直に押すほど、あなた専用の復習計画になります。</p>
        <h3>④ 交互学習（分野をまぜる）</h3>
        <p class="small">「今日の学習」は同じ分野が続かないように並べます。本番と同じく「どの知識を使う問題か」を判断する力がつきます。</p>
        <h3>⑤ 弱点と配点を重視</h3>
        <p class="small">新しい問題は「本番での出題数が多い」かつ「習熟度が低い」分野から優先して出します。セキュリティや科目Bのアルゴリズムは特に配点が大きい分野です。</p>
      </div>
      <h2>おすすめの使い方</h2>
      <div class="card"><ol class="small tips">
        <li>設定で<b>試験日</b>と<b>1日の目標</b>を決める</li>
        <li>毎日「<b>今日の学習</b>」を1回（20問なら15〜20分）</li>
        <li>スキマ時間に<b>用語カード</b>、苦手な計算は<b>計算ドリル</b>で反復</li>
        <li>週に1回、<b>科目B</b>の問題を紙とペンでトレースしながら解く</li>
        <li>試験2〜3週間前から<b>模擬試験</b>で時間配分を練習する</li>
      </ol></div>
      <h2>試験の概要</h2>
      <div class="card small">
        <table class="t">
          <tr><th></th><th>科目A</th><th>科目B</th></tr>
          <tr><td>試験時間</td><td>90分</td><td>100分</td></tr>
          <tr><td>出題数</td><td>60問（四肢択一）</td><td>20問（多肢選択）</td></tr>
          <tr><td>内容</td><td>テクノロジ・マネジメント・ストラテジの知識</td><td>アルゴリズムとプログラミング（16問）、情報セキュリティ（4問）</td></tr>
          <tr><td>合格基準</td><td colspan="2">各科目とも1000点満点中600点以上</td></tr>
        </table>
        <p class="muted">試験制度は変更されることがあります。最新情報は必ずIPA（情報処理推進機構）の公式サイトで確認してください。収録問題はすべてこのアプリのオリジナル問題です。</p>
      </div>
    `);
  }

  /* ---------- ルーティング ---------- */
  function route() { return (location.hash || '#/').replace(/^#/, ''); }
  function render() {
    const r = route();
    if (r !== '/quiz') stopTimer();
    switch (r) {
      case '/cats': viewCats(); break;
      case '/b': viewB(); break;
      case '/exam': viewExam(); break;
      case '/drill': viewDrill(); break;
      case '/terms': viewTerms(); break;
      case '/flash': viewFlash(); break;
      case '/weak': viewWeak(); break;
      case '/stats': viewStats(); break;
      case '/settings': viewSettings(); break;
      case '/about': viewAbout(); break;
      case '/quiz': if (SES && !SES.done) renderQuiz(); else location.hash = '#/'; break;
      case '/result': viewResult(); break;
      default: viewHome();
    }
  }
  window.addEventListener('hashchange', () => {
    const r = route();
    // ブラウザの戻るで演習画面から抜けたとき
    if (r !== '/quiz' && SES && !SES.done && SES.mode === 'exam') stopTimer();
    render();
    window.scrollTo(0, 0);
  });

  /* ---------- 操作 ---------- */
  function drillSession(types) {
    const items = [];
    for (let i = 0; i < 10; i++) items.push(makeDrill(types[i % types.length]));
    startSession(shuffle(items), { title: '計算ドリル', drillTypes: types });
  }
  const ACTIONS = {
    daily: () => startSession(buildDaily(), { title: '今日の学習' }),
    cat: (a) => startSession(buildFromPool(ITEMS.filter((i) => i.cat === a), 10), { title: CAT[a].name }),
    allA: () => startSession(interleave(buildFromPool(ITEMS_A, 20)), { title: '科目A ランダム' }),
    one: (a) => startSession([BYID[a]], { title: BYID[a].title || '1問演習' }),
    bmix: () => startSession(buildFromPool(ITEMS_B, 5), { title: '科目B おすすめ' }),
    bcat: (a) => startSession(buildFromPool(ITEMS_B.filter((i) => i.cat === a), 5), { title: CAT[a].name }),
    weak: () => startSession(interleave(weakItems().slice(0, 10)), { title: '苦手克服' }),
    redo: (a) => startSession(a.split(',').map((id) => BYID[id]).filter(Boolean), { title: '間違えた問題の解き直し' }),
    exam: (a) => {
      const items = buildExam(a);
      const per = a === 'B' ? 5 : 1.5;
      const name = a === 'A' ? '科目A 模擬試験' : a === 'mini' ? '科目A ミニ模試' : '科目B 模擬試験';
      if (!confirm(`${name}を開始します。\n${items.length}問・制限時間${Math.round(items.length * per)}分`)) return;
      startSession(items, { mode: 'exam', title: name, retry: false, timeLimit: items.length * per * 60000, examType: a });
    },
    drill: (a) => drillSession([a]),
    drillmix: () => drillSession(shuffle(Object.keys(DRILLS))),
    drillagain: () => drillSession(SES.drillTypes.length > 1 ? shuffle(SES.drillTypes) : SES.drillTypes),
    ans: (a) => answer(parseInt(a, 10)),
    grade: (a) => grade(parseInt(a, 10)),
    next: () => next(),
    quit: () => quitSession(),
    prev: () => { if (SES.idx > 0) { SES.idx--; renderQuiz(); window.scrollTo(0, 0); } },
    enext: () => { if (SES.idx < SES.q.length - 1) { SES.idx++; renderQuiz(); window.scrollTo(0, 0); } },
    go: (a) => { SES.idx = parseInt(a, 10); renderQuiz(); window.scrollTo(0, 0); },
    flag: () => { curQ().flag = !curQ().flag; renderQuiz(); },
    submit: () => {
      const remain = SES.q.filter((x) => x.ans === null).length;
      if (confirm(remain ? `未解答が${remain}問あります。採点しますか？` : '採点しますか？')) finishSession();
    },
    tdue: () => startFlash(shuffle(dueTerms()), S.settings.termReverse),
    tnew: () => startFlash(shuffle(TERMS.filter((t) => !S.terms[t.id])).slice(0, 10), S.settings.termReverse),
    tcat: (a) => {
      const cards = TERMS.filter((t) => t.cat === a);
      const now = Date.now();
      cards.sort((x, y) => ((S.terms[x.id] ? S.terms[x.id].due : 0) - (S.terms[y.id] ? S.terms[y.id].due : 0)) || (x.id < y.id ? -1 : 1));
      startFlash(cards.filter((c) => !S.terms[c.id] || S.terms[c.id].due <= now + DAY * 3).concat(cards).filter((c, i, arr) => arr.indexOf(c) === i).slice(0, 15), S.settings.termReverse);
    },
    flip: () => { if (!FS.flipped) { FS.flipped = true; render(); } },
    fg: (a) => flashGrade(parseInt(a, 10)),
    fquit: () => { FS = null; location.hash = '#/terms'; },
    export: () => {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'fesan-backup-' + dayKey() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    reset: () => {
      if (!confirm('学習記録をすべて削除します。元に戻せません。よろしいですか？')) return;
      const keep = S.settings;
      S = defaultState(); S.settings = keep; save(); toast('削除しました'); location.hash = '#/'; render();
    }
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el.dataset.arg); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const r = route();
    const k = e.key;
    if (r === '/quiz' && SES && !SES.done) {
      const qq = curQ();
      const exam = SES.mode === 'exam';
      const map = { '1': 0, '2': 1, '3': 2, '4': 3, a: 0, b: 1, c: 2, d: 3 };
      if (exam) {
        if (k in map) { answer(map[k]); e.preventDefault(); }
        else if (k === 'ArrowRight') ACTIONS.enext();
        else if (k === 'ArrowLeft') ACTIONS.prev();
        return;
      }
      if (qq.ans === null) { if (k in map && map[k] < qq.item.c.length) { answer(map[k]); e.preventDefault(); } return; }
      const needGrade = isCorrect(qq) && !qq.retry && qq.item.kind !== 'D' && qq.grade === null;
      if (needGrade) { const g = { '1': 3, '2': 2, '3': 1 }[k]; if (g) { grade(g); e.preventDefault(); } return; }
      if (k === 'Enter' || k === ' ') { next(); e.preventDefault(); }
    } else if (r === '/flash' && FS && FS.idx < FS.cards.length) {
      if (!FS.flipped && (k === ' ' || k === 'Enter')) { ACTIONS.flip(); e.preventDefault(); }
      else if (FS.flipped) { const g = { '1': 0, '2': 2, '3': 3 }[k]; if (g !== undefined) { flashGrade(g); e.preventDefault(); } }
    }
  });

  /* ---------- 起動 ---------- */
  if (route() === '/quiz' || route() === '/result' || route() === '/flash') location.hash = '#/';
  render();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
  // テスト用に一部を公開
  window.FESAN = { schedule, strength, buildDaily, buildExam, state: () => S };
})();
