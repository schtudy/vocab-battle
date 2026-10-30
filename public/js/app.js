/* 영단어 3초 배틀 — 앱 로직
   API(/api/*)·localStorage 키·점수 규칙은 이전 버전과 동일하게 유지합니다. */
(() => {
'use strict';
const UI = window.VocabBattleUI;
const W = String(window.VB_RAW || '').split(';').filter(Boolean).map((s, k) => {
  const i = s.indexOf(',');
  return { w: s.slice(0, i), m: s.slice(i + 1), u: (k / 200 | 0) + 1 };
});
const BYW = Object.fromEntries(W.map((x) => [x.w, x]));
const NQ = 20, LIM = 3000, UNITS = 15, POLL = 5000, MAXS = NQ * 200;
const RING = 2 * Math.PI * 50;

const $ = (id) => document.getElementById(id);
const M = $('main');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sh = (a) => { a = [...a]; for (let k = a.length - 1; k > 0; k--) { const j = Math.random() * (k + 1) | 0; [a[k], a[j]] = [a[j], a[k]]; } return a; };
const ago = (t) => { const s = (Date.now() - t) / 1000; if (s < 60) return '방금'; if (s < 3600) return (s / 60 | 0) + '분 전'; if (s < 86400) return (s / 3600 | 0) + '시간 전'; return (s / 86400 | 0) + '일 전'; };
const fmt = UI.fmt;
const pad = (n) => String(n).padStart(2, '0');
const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) % 360; return h; };
const avatar = (nick) => `<span class="av" style="--h:${hue(nick)}" aria-hidden="true">${esc([...String(nick)][0] || '?')}</span>`;
const lvl = (u) => (u <= 5 ? 1 : u <= 10 ? 2 : 3);
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* 무시 */ } },
};
const say = (t) => { const l = $('live'); l.textContent = ''; setTimeout(() => { l.textContent = t; }, 30); };

let token = LS.get('vb-token'), ME = null, tab = 'quiz';
let unit = Math.min(UNITS, Math.max(1, +(LS.get('vb-unit') || 1) || 1)), dir = +(LS.get('vb-dir') || 0) ? 1 : 0;
let rankU = 0, rankRows = null, comments = null, authMode = 'login', editing = false;
let G = null, R = null; // 진행 중 게임, 마지막 결과
const mini = {};        // Unit별 TOP 3 캐시

async function call(path, opt = {}) {
  const h = { 'content-type': 'application/json' };
  if (token) h.authorization = 'Bearer ' + token;
  let r;
  try { r = await fetch(path, { method: opt.method || 'GET', headers: h, body: opt.body ? JSON.stringify(opt.body) : undefined }); }
  catch (e) { throw new Error('인터넷 연결을 확인하세요'); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && token && !path.endsWith('/login')) { token = null; LS.set('vb-token', null); ME = null; }
  if (!r.ok) throw new Error(d.error || '요청이 실패했어요');
  return d;
}

const sumBest = (b) => Object.values(b || {}).reduce((a, v) => a + (+v || 0), 0);
const wrongWords = () => (ME && ME.wrong ? ME.wrong.filter((x) => BYW[x.word]) : []);

/* ---------- Header ---------- */
function header() {
  const el = $('me');
  if (!ME) { el.innerHTML = '<span class="vb-chip">게스트</span>'; return; }
  el.innerHTML = `<button class="me-btn" id="mb" type="button" aria-haspopup="menu" aria-expanded="false">${avatar(ME.nick)}<span class="nm">${esc(ME.nick)}</span></button>
  <div class="menu vb-panel" id="mm" role="menu" hidden>
    <div class="menu-h"><b>${esc(ME.nick)}</b><small>플레이 ${fmt(ME.plays)}회 · 합산 ${fmt(sumBest(ME.best))}점</small></div>
    <button type="button" role="menuitem" id="cn">닉네임 변경</button>
    <button type="button" role="menuitem" id="lo">로그아웃</button>
  </div>`;
  const mb = $('mb'), mm = $('mm');
  mb.onclick = (e) => { e.stopPropagation(); mm.hidden = !mm.hidden; mb.setAttribute('aria-expanded', String(!mm.hidden)); };
  $('cn').onclick = () => { if (G) return; mm.hidden = true; editing = true; tab = 'quiz'; R = null; render(true); };
  $('lo').onclick = async () => {
    if (G) quitGame();
    try { await call('/api/logout', { method: 'POST' }); } catch (e) { /* 무시 */ }
    token = null; LS.set('vb-token', null); ME = null; R = null; tab = 'quiz'; render(true);
  };
}
document.addEventListener('click', (e) => { const mm = $('mm'); if (mm && !mm.hidden && !e.target.closest('.me')) { mm.hidden = true; $('mb')?.setAttribute('aria-expanded', 'false'); } });

function setTabs() {
  document.querySelectorAll('#tab button').forEach((b) => {
    const on = b.dataset.v === tab;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.body.classList.toggle('in-game', !!G);
}

function render(anim) {
  header(); setTabs();
  if (G) return;
  if (editing && ME) nickForm();
  else if (tab === 'quiz') { if (R) result(); else if (ME) lobby(); else authForm(); }
  else if (tab === 'rank') rank();
  else talk();
  if (anim) { UI.enter(M); window.scrollTo(0, 0); }
}

/* ---------- 타이머 링 마크업 ---------- */
const ringSVG = () => `<svg viewBox="0 0 120 120" aria-hidden="true">
  <defs>
    <linearGradient id="vbArc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c7ff63"/><stop offset="1" stop-color="#38d9ff"/></linearGradient>
    <linearGradient id="vbArcHot" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6eb4"/><stop offset="1" stop-color="#ff637d"/></linearGradient>
  </defs>
  <circle class="trk" cx="60" cy="60" r="50"/>
  <circle class="arc" cx="60" cy="60" r="50" transform="rotate(-90 60 60)" stroke-dasharray="${RING.toFixed(2)}" stroke-dashoffset="0"/>
  <circle class="core" cx="60" cy="60" r="39"/>
  <path class="tick" d="M60 15v6M105 60h-6M60 105v-6M15 60h6"/>
</svg>`;

/* ---------- 로그인 전 메인 ---------- */
function authForm() {
  const su = authMode === 'signup';
  M.innerHTML = `<section class="auth">
    <div class="hero vb-panel">
      <span class="vb-chip"><i class="live-dot"></i>수능 필수 영단어 3,000</span>
      <h1>3초 안에<br><span class="vb-gradient-text">뜻을 골라라</span></h1>
      <p>15 Unit × 200단어, 한 판 20문제. 빨리 맞힐수록 점수가 커지고 Unit별 최고점으로 랭킹을 겨룹니다.</p>
      <div class="demo">
        <div class="timer vb-timer">${ringSVG()}<b>2.1<small>SEC</small></b></div>
        <div class="demo-q"><span class="w">eventually</span>
          <div class="demo-o"><span>점차</span><span class="is-correct">결국</span><span>즉각적인</span><span>일시적인</span></div></div>
        <span class="vb-chip demo-tag">예시 문제</span>
      </div>
      <ul class="facts"><li><b>3,000</b><small>단어</small></li><li><b>15</b><small>Unit</small></li><li><b>3.0</b><small>초 / 문제</small></li></ul>
    </div>
    <form class="authp vb-panel" id="af" novalidate>
      <div class="seg" id="am" role="tablist"><button type="button" data-v="login" class="${su ? '' : 'on'}" role="tab" aria-selected="${!su}">로그인</button><button type="button" data-v="signup" class="${su ? 'on' : ''}" role="tab" aria-selected="${su}">처음이에요</button></div>
      <div><h2>${su ? '닉네임 만들기' : '다시 오셨네요'}</h2><p class="note">${su ? '랭킹과 댓글에 이 닉네임이 표시돼요.' : '닉네임과 비밀번호로 이어서 하세요.'}</p></div>
      <div class="field"><label for="an">닉네임</label><input class="input" id="an" maxlength="12" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="2~12자 · 한글/영문/숫자"></div>
      <div class="field"><label for="ap">비밀번호</label><input class="input" id="ap" type="password" autocomplete="${su ? 'new-password' : 'current-password'}" placeholder="4자 이상"></div>
      <p class="err" id="ae" role="alert"></p>
      <button class="vb-primary" id="as" type="submit">${su ? '가입하고 시작하기' : '로그인'}</button>
      <p class="note">한 번 로그인하면 이 기기에서 유지돼요. 다른 기기에서도 같은 닉네임·비밀번호로 기록이 이어집니다.</p>
    </form>
  </section>`;
  const arc = M.querySelector('.demo .arc'); if (arc) arc.style.strokeDashoffset = (RING * 0.3).toFixed(2);
  M.querySelectorAll('#am button').forEach((b) => (b.onclick = () => { authMode = b.dataset.v; authForm(); $('an').focus(); }));
  $('af').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('as'); btn.disabled = true; $('ae').textContent = '';
    try {
      const d = await call(su ? '/api/signup' : '/api/login', { method: 'POST', body: { nick: $('an').value, pw: $('ap').value } });
      token = d.token; LS.set('vb-token', token); ME = await call('/api/me'); render(true);
    } catch (x) { $('ae').textContent = x.message; btn.disabled = false; }
  };
}

/* ---------- 닉네임 변경 ---------- */
function nickForm() {
  M.innerHTML = `<form class="nickp vb-panel" id="nf" novalidate>
    <div><span class="eyebrow">PROFILE</span><h2>닉네임 변경</h2><p class="note">랭킹과 댓글에 바로 반영돼요. 2~12자</p></div>
    <div class="field"><label for="nk">새 닉네임</label><input class="input" id="nk" maxlength="12" autocapitalize="off" spellcheck="false" value="${esc(ME.nick)}"></div>
    <p class="err" id="ne" role="alert"></p>
    <div class="row"><button class="vb-primary" id="ns" type="submit">저장</button><button class="vb-secondary" id="nc" type="button">취소</button></div>
  </form>`;
  $('nk').focus(); $('nk').select();
  $('nf').onsubmit = async (e) => {
    e.preventDefault(); $('ns').disabled = true;
    try {
      const d = await call('/api/nick', { method: 'POST', body: { nick: $('nk').value } });
      ME.nick = d.nick; editing = false; rankRows = null; comments = null; for (const k in mini) delete mini[k]; render(true);
    } catch (x) { $('ne').textContent = x.message; $('ns').disabled = false; }
  };
  $('nc').onclick = () => { editing = false; render(true); };
}

/* ---------- 로비 ---------- */
function lobby() {
  const b = ME.best || {}, wc = wrongWords().length, cleared = Object.keys(b).length, best = b[unit] || 0;
  const tiles = Array.from({ length: UNITS }, (_, k) => {
    const u = k + 1, s = b[u] || 0, l = lvl(u);
    return `<button type="button" class="ut${u === unit ? ' on' : ''}" data-u="${u}" aria-pressed="${u === unit}" aria-label="Unit ${u}, 난이도 ${l}단계, ${s ? '최고 ' + s + '점' : '기록 없음'}">
      <span class="top-r"><span class="un">${pad(u)}</span><span class="lv" aria-hidden="true">${[1, 2, 3].map((i) => `<i class="${i <= l ? 'f' : ''}"></i>`).join('')}</span></span>
      <span class="bs${s ? ' has' : ''}">${s ? fmt(s) + '점' : '도전 전'}</span>
      <span class="vb-progress" aria-hidden="true"><span style="width:${(s / MAXS * 100).toFixed(1)}%"></span></span>
    </button>`;
  }).join('');
  const dirSeg = (id) => `<div class="seg" id="${id}" role="group" aria-label="문제 방향"><button type="button" data-v="0" class="${dir ? '' : 'on'}" aria-pressed="${!dir}">영 → 뜻</button><button type="button" data-v="1" class="${dir ? 'on' : ''}" aria-pressed="${!!dir}">뜻 → 영</button></div>`;
  M.innerHTML = `<section class="lobby">
    <div class="hello"><div><span class="eyebrow">READY PLAYER</span><h1>${esc(ME.nick)}님, 한 판 할까요?</h1></div></div>
    <div class="stats">
      <div class="stat"><small>합산 점수</small><b>${fmt(sumBest(b))}</b></div>
      <div class="stat"><small>기록한 Unit</small><b>${cleared}<i>/ ${UNITS}</i></b></div>
      <div class="stat"><small>플레이</small><b>${fmt(ME.plays)}<i>회</i></b></div>
      <div class="stat"><small>오답노트</small><b>${wc}<i>단어</i></b></div>
    </div>
    <div class="lobby-grid">
      <div class="units-p vb-panel">
        <div class="ph"><h2>Unit 선택</h2><small>Unit당 200단어 · 뒤로 갈수록 어려워요</small></div>
        <div class="units" id="units">${tiles}</div>
      </div>
      <div class="startp vb-panel vb-glow">
        <div class="sel-row">
          <div class="sel"><span class="eyebrow">SELECTED</span><b>Unit ${pad(unit)}</b></div>
          <div class="sel-best"><small>내 최고점</small><b>${best ? fmt(best) : '—'}</b></div>
        </div>
        ${dirSeg('dir')}
        <button type="button" class="vb-primary go" id="go">배틀 시작 · ${NQ}문제</button>
        <button type="button" class="vb-secondary" id="rv" ${wc ? '' : 'disabled'}>오답 복습 · ${wc ? wc + '단어' : '아직 없음'}</button>
        <ul class="rules">
          <li>정답 100점 + 남은 시간 보너스 최대 100점</li>
          <li>3초가 지나면 오답 처리</li>
          <li>Unit별 최고점이 랭킹에 반영 · 오답 복습에서 맞히면 오답노트에서 빠져요</li>
        </ul>
      </div>
      <div class="cta-m"><button type="button" class="vb-primary" id="go2">Unit ${pad(unit)} 배틀 시작</button></div>
      <div class="minirank vb-panel">
        <div class="ph"><h3>Unit ${pad(unit)} TOP 3</h3><button type="button" class="lnk" id="mr">전체 랭킹</button></div>
        <ol class="mini" id="mini">${miniRows(unit)}</ol>
      </div>
    </div>
  </section>`;
  M.querySelectorAll('[data-u]').forEach((x) => (x.onclick = () => { unit = +x.dataset.u; LS.set('vb-unit', unit); lobby(); }));
  M.querySelectorAll('#dir button').forEach((x) => (x.onclick = () => { dir = +x.dataset.v; LS.set('vb-dir', dir); lobby(); }));
  $('go').onclick = $('go2').onclick = () => start(unit);
  $('rv').onclick = () => start(0);
  $('mr').onclick = () => { tab = 'rank'; rankU = unit; rankRows = null; render(true); pull(); };
  loadMini(unit);
}
function miniRows(u) {
  const rows = mini[u];
  if (!rows) return '<li class="note">불러오는 중…</li>';
  if (!rows.length) return '<li class="note">아직 기록이 없어요. 첫 1등을 노려보세요</li>';
  return rows.slice(0, 3).map((x, i) => {
    const m = ME && x.nick === ME.nick;
    return `<li class="${m ? 'mine' : ''}"><span class="rk vb-rank-${i + 1}">${i + 1}</span><b>${esc(x.nick)}${m ? '<span class="you">나</span>' : ''}</b><span>${fmt(x.score)}</span></li>`;
  }).join('');
}
async function loadMini(u) {
  try {
    const d = await call('/api/rank?unit=' + u);
    mini[u] = d.rows;
    const el = $('mini');
    if (el && unit === u && !G && tab === 'quiz') el.innerHTML = miniRows(u);
  } catch (e) { /* 무시 */ }
}

/* ---------- 게임 ---------- */
function start(u) {
  R = null;
  const src = u ? W.filter((x) => x.u === u) : sh(wrongWords().map((x) => BYW[x.word]));
  const qs = (u ? sh(src) : src).slice(0, NQ).map((a) => {
    const pool = W.filter((x) => x.u === a.u && x !== a);
    return { a, opts: sh([a, ...sh(pool).slice(0, 3)]) };
  });
  if (!qs.length) return;
  G = { u, dir, qs, n: qs.length, i: 0, score: 0, ok: 0, combo: 0, maxCombo: 0, res: [], times: [], wrong: [], right: [], t0: 0, timer: null, raf: 0, lock: true, quitArm: 0 };
  setTabs();
  M.innerHTML = `<section class="game" id="game" aria-label="퀴즈">
    <div class="g-top">
      <div class="left"><button type="button" class="quit" id="qt">그만두기</button><span class="vb-chip">${u ? 'Unit ' + pad(u) : '오답 복습'} · ${dir ? '뜻→영' : '영→뜻'}</span></div>
      <div class="score"><small>SCORE</small><b id="sc">0</b></div>
    </div>
    <div class="pips" id="pips" style="--n:${G.n}" aria-hidden="true">${G.qs.map(() => '<i></i>').join('')}</div>
    <div class="qcard vb-panel" id="qc">
      <div class="timer vb-timer" id="tm" role="timer" aria-label="남은 시간">${ringSVG()}<b id="tn">3.0<small>SEC</small></b></div>
      <div class="combo" id="cb" hidden><img src="/images/combo-spark.svg" alt="" width="44" height="18"><span class="cv"><b id="cbn">0</b><span>COMBO</span></span></div>
      <div class="qno" id="qn"></div>
      <h2 class="word" id="qw" lang="${dir ? 'ko' : 'en'}"></h2>
      <small class="hint">${dir ? '알맞은 영단어를 고르세요' : '알맞은 뜻을 고르세요'}</small>
    </div>
    <div class="opts" id="op">${[0, 1, 2, 3].map((k) => `<button type="button" class="vb-option" data-k="${k}"><span class="k">${k + 1}</span><span class="t"></span><span class="mk"></span></button>`).join('')}</div>
    <p class="kbd-hint">키보드 <kbd>1</kbd>–<kbd>4</kbd>로 선택 · <kbd>Esc</kbd> 그만두기</p>
  </section>`;
  M.querySelectorAll('#op button').forEach((b) => (b.onclick = () => pick(+b.dataset.k)));
  $('qt').onclick = () => {
    if (!G) return;
    if (!G.quitArm) { G.quitArm = 1; const q = $('qt'); q.classList.add('arm'); q.textContent = '한 번 더 누르면 종료'; setTimeout(() => { if (G && $('qt')) { G.quitArm = 0; $('qt').classList.remove('arm'); $('qt').textContent = '그만두기'; } }, 2500); return; }
    quitGame(); render(true);
  };
  window.scrollTo(0, 0);
  // READY → GO
  const game = $('game');
  if (UI.reduceMotion) { ask(); return; }
  UI.flashNode(game, 'ready', '', 700).innerHTML = '<span>READY</span>';
  setTimeout(() => { if (!G) return; UI.flashNode(game, 'ready', '', 600).innerHTML = '<span class="vb-gradient-text">GO!</span>'; }, 650);
  setTimeout(() => { if (G) ask(); }, 1050);
}
function quitGame() { if (!G) return; clearTimeout(G.timer); cancelAnimationFrame(G.raf); G = null; setTabs(); }

function ask() {
  const q = G.qs[G.i];
  const F = (x) => (G.dir ? x.m : x.w), B = (x) => (G.dir ? x.w : x.m);
  const word = F(q.a), len = [...word].length;
  const qw = $('qw'); qw.textContent = word; qw.className = 'word' + (len > 13 ? ' xl' : len > 9 ? ' l' : '');
  $('qn').textContent = `QUESTION ${pad(G.i + 1)} / ${pad(G.n)}`;
  const op = $('op'); op.classList.remove('locked');
  [...op.children].forEach((b, k) => {
    b.disabled = false; UI.setFeedback(b, null); b.classList.remove('shake');
    b.querySelector('.t').textContent = B(q.opts[k]); b.querySelector('.t').lang = G.dir ? 'en' : 'ko';
    b.querySelector('.mk').textContent = '';
    b.querySelectorAll('.vb-float').forEach((n) => n.remove());
  });
  const pips = $('pips').children; for (let k = 0; k < pips.length; k++) pips[k].classList.toggle('cur', k === G.i);
  const qc = $('qc'); qc.classList.remove('hot', 'flash-ok', 'flash-no'); qc.querySelectorAll('.stamp,.combo-banner,.combo-burst').forEach((n) => n.remove());
  const tm = $('tm'); tm.classList.remove('hot', 'done');
  const arc = tm.querySelector('.arc'), tn = $('tn');
  arc.style.strokeDashoffset = '0'; tn.firstChild.nodeValue = '3.0';
  G.lock = false; G.t0 = performance.now();
  const tick = () => {
    if (!G || G.lock) return;
    const left = Math.max(0, LIM - (performance.now() - G.t0));
    arc.style.strokeDashoffset = (RING * (1 - left / LIM)).toFixed(2);
    tn.firstChild.nodeValue = (Math.ceil(left / 100) / 10).toFixed(1);
    if (left < 1000 && !tm.classList.contains('hot')) { tm.classList.add('hot'); qc.classList.add('hot'); }
    if (left > 0) G.raf = requestAnimationFrame(tick);
  };
  G.raf = requestAnimationFrame(tick);
  G.timer = setTimeout(() => pick(-1), LIM);
}

function pick(k) {
  if (!G || G.lock) return;
  G.lock = true; clearTimeout(G.timer); cancelAnimationFrame(G.raf);
  const q = G.qs[G.i], el = performance.now() - G.t0, left = Math.max(0, LIM - el);
  const op = $('op'), bs = [...op.children], ci = q.opts.indexOf(q.a), qc = $('qc'), tm = $('tm'), sc = $('sc');
  op.classList.add('locked'); bs.forEach((b) => (b.disabled = true));
  tm.classList.add('done');
  if (k < 0) { tm.querySelector('.arc').style.strokeDashoffset = RING.toFixed(2); $('tn').firstChild.nodeValue = '0.0'; }
  UI.setFeedback(bs[ci], 'correct'); bs[ci].querySelector('.mk').textContent = k === ci ? 'CORRECT' : '정답';
  const pip = $('pips').children[G.i]; pip.classList.remove('cur');
  const prevScore = G.score;
  if (k === ci) {
    const gain = 100 + Math.round(left / 30);
    G.ok++; G.score += gain; G.combo++; G.maxCombo = Math.max(G.maxCombo, G.combo);
    G.right.push(q.a.w); G.times.push(el); G.res.push('ok'); pip.classList.add('ok');
    UI.floatText(bs[ci], '+' + gain);
    UI.countUp(sc, prevScore, G.score, 420);
    UI.restart(qc, 'flash-ok');
    showCombo();
    say(`정답, ${gain}점` + (G.combo >= 2 ? `, ${G.combo} 콤보` : ''));
  } else {
    if (k >= 0) { UI.setFeedback(bs[k], 'wrong'); bs[k].querySelector('.mk').textContent = 'MISS'; UI.restart(bs[k], 'shake'); G.times.push(el); }
    else UI.flashNode(qc, 'stamp', 'TIME OVER', 1000);
    G.wrong.push(q.a); G.res.push(k < 0 ? 'to' : 'no'); pip.classList.add(k < 0 ? 'to' : 'no');
    UI.restart(qc, 'flash-no'); UI.buzz(70);
    breakCombo();
    say((k < 0 ? '시간 초과. ' : '오답. ') + '정답은 ' + (G.dir ? q.a.w : q.a.m));
  }
  setTimeout(() => { if (!G) return; G.i++; G.i < G.n ? ask() : finish(); }, k === ci ? 520 : 1000);
}
function showCombo() {
  const cb = $('cb'); if (!cb) return;
  if (G.combo < 2) { cb.hidden = true; return; }
  cb.hidden = false; cb.classList.remove('break');
  $('cbn').textContent = G.combo;
  cb.classList.toggle('mega', G.combo >= 5);
  UI.restart(cb, 'pop');
  if (G.combo % 5 === 0) {
    const qc = $('qc');
    UI.flashNode(qc, 'combo-burst', '', 800);
    if (!UI.reduceMotion) UI.flashNode(qc, 'combo-banner', '', 900).innerHTML = `<span class="vb-gradient-text">${G.combo} COMBO!</span>`;
  }
}
function breakCombo() {
  const cb = $('cb'); const had = G.combo >= 2; G.combo = 0;
  if (!cb || cb.hidden) return;
  if (had && !UI.reduceMotion) { UI.restart(cb, 'break'); setTimeout(() => { if (cb.classList.contains('break')) cb.hidden = true; }, 500); }
  else cb.hidden = true;
}
document.addEventListener('keydown', (e) => {
  if (!G || e.altKey || e.ctrlKey || e.metaKey) return;
  if (/^[1-4]$/.test(e.key) && !G.lock) { e.preventDefault(); pick(+e.key - 1); }
  else if (e.key === 'Escape') { $('qt')?.click(); }
});

/* ---------- 결과 ---------- */
const gradeOf = (score, n) => { const r = score / (n * 200); return r >= .85 ? 'S' : r >= .7 ? 'A' : r >= .5 ? 'B' : r >= .3 ? 'C' : 'D'; };
async function finish() {
  const g = G; G = null; setTabs();
  const prev = g.u ? ((ME.best || {})[g.u] || 0) : 0;
  const avg = g.times.length ? g.times.reduce((a, b) => a + b, 0) / g.times.length / 1000 : 0;
  R = { u: g.u, dir: g.dir, n: g.n, score: g.score, ok: g.ok, maxCombo: g.maxCombo, res: g.res, avg, prev, rec: !!g.u && g.score > prev, wrong: g.wrong, save: { t: '저장 중…', c: '' }, fresh: true };
  render(true);
  try {
    ME = await call('/api/score', { method: 'POST', body: { unit: g.u, score: g.score, wrong: g.wrong.map((x) => x.w), right: g.right } });
    if (g.u) delete mini[g.u];
    R.save = { t: !g.u ? `오답노트 갱신 완료 · 남은 오답 ${wrongWords().length}단어` : R.rec ? '랭킹에 반영됐어요' : `기록 저장 완료 · 최고점 ${fmt(prev)}점 유지`, c: 'ok' };
  } catch (x) { R.save = { t: x.message + ' · 기록이 저장되지 않았어요', c: 'bad' }; }
  header();
  const sv = $('sv'); if (sv && R) { sv.textContent = R.save.t; sv.className = 'save ' + R.save.c; }
}
function result() {
  const r = R, gr = gradeOf(r.score, r.n), acc = Math.round(r.ok / r.n * 100);
  M.innerHTML = `<section class="result">
    <div class="res-hero vb-panel vb-glow">
      <div class="grade g-${gr}" aria-label="등급 ${gr}"><b>${gr}</b></div>
      <div class="res-main">
        <span class="eyebrow">${r.u ? 'Unit ' + pad(r.u) : '오답 복습'} · ${r.dir ? '뜻→영' : '영→뜻'} · RESULT</span>
        <div class="res-score"><b id="rs">${r.fresh ? 0 : fmt(r.score)}</b><span>점</span></div>
        ${r.rec ? `<span class="record"><img src="/images/medal.svg" alt="" width="24" height="28">${r.prev ? '신기록! 이전 최고 ' + fmt(r.prev) + '점' : '첫 기록 달성!'}</span>` : ''}
        <span class="save ${r.save.c}" id="sv" role="status">${esc(r.save.t)}</span>
      </div>
    </div>
    <div class="res-stats">
      <div class="stat"><small>정답</small><b>${r.ok}<i>/ ${r.n} · ${acc}%</i></b></div>
      <div class="stat"><small>최대 콤보</small><b>${r.maxCombo}<i>연속</i></b></div>
      <div class="stat"><small>평균 응답</small><b>${r.avg ? r.avg.toFixed(2) : '—'}<i>${r.avg ? '초' : ''}</i></b></div>
      <div class="stat"><small>${r.u ? '이 Unit 최고점' : '남은 오답'}</small><b>${r.u ? fmt(Math.max(r.prev, r.score)) : wrongWords().length}<i>${r.u ? '점' : '단어'}</i></b></div>
    </div>
    <div class="pips" style="--n:${r.n}" aria-label="문항별 결과: 정답 ${r.ok}개">${r.res.map((x) => `<i class="${x}"></i>`).join('')}</div>
    <div class="res-actions">
      <button type="button" class="vb-primary" id="re">다시 하기</button>
      ${r.u ? '<button type="button" class="vb-secondary" id="lb">랭킹 보기</button>' : ''}
      <button type="button" class="vb-secondary" id="bk">Unit 고르기</button>
    </div>
    ${r.wrong.length ? `<div class="wrongs vb-panel"><div class="ph"><h3>틀린 단어 ${r.wrong.length}개</h3><small>오답노트에 저장돼요</small></div>
      <ul class="wl">${r.wrong.map((x, i) => `<li><b lang="en">${esc(x.w)}</b>${r.res.filter((v) => v !== 'ok')[i] === 'to' ? '<span class="tg">시간 초과</span>' : ''}<span>${esc(x.m)}</span></li>`).join('')}</ul></div>`
      : '<div class="vb-panel empty"><b>퍼펙트!</b>20문제를 모두 맞혔어요</div>'}
  </section>`;
  if (r.fresh) { r.fresh = false; UI.countUp($('rs'), 0, r.score, 900); }
  $('re').onclick = () => start(r.u);
  if (r.u) $('lb').onclick = () => { R = null; tab = 'rank'; rankU = r.u; rankRows = null; render(true); pull(); };
  $('bk').onclick = () => { R = null; render(true); };
  $('re').focus({ preventScroll: true });
}

/* ---------- 랭킹 ---------- */
function rank() {
  const sl = $('rc') ? $('rc').scrollLeft : null;
  const rows = rankRows || [], isMe = (x) => ME && x.nick === ME.nick;
  const pod = (i) => {
    const x = rows[i];
    if (!x) return `<div class="pod vb-panel p${i + 1} wait"><span class="badge">${i + 1}</span><span class="nk">도전자 대기</span><span class="sc">—</span></div>`;
    return `<div class="pod vb-panel p${i + 1}${isMe(x) ? ' mine' : ''}">${i === 0 ? '<img src="/images/medal.svg" alt="1위" width="56" height="66">' : `<span class="badge vb-rank-${i + 1}">${i + 1}</span>`}
      <span class="nk">${esc(x.nick)}${isMe(x) ? '<span class="you">나</span>' : ''}</span><span class="sc">${fmt(x.score)}</span></div>`;
  };
  const myIdx = ME ? rows.findIndex(isMe) : -1;
  const myScore = ME ? (rankU ? (ME.best || {})[rankU] || 0 : sumBest(ME.best)) : 0;
  M.innerHTML = `<section class="rank">
    <div class="rank-head"><div><span class="eyebrow">LEADERBOARD</span><h1>${rankU ? 'Unit ' + pad(rankU) + ' 랭킹' : '전체 랭킹'}</h1></div><small><i class="live-dot"></i>LIVE · 5초마다 갱신</small></div>
    <div class="hscroll" id="rc" role="tablist" aria-label="랭킹 범위">
      <button type="button" class="pill${rankU === 0 ? ' on' : ''}" data-r="0" role="tab" aria-selected="${rankU === 0}">전체 합산</button>
      ${Array.from({ length: UNITS }, (_, k) => `<button type="button" class="pill${rankU === k + 1 ? ' on' : ''}" data-r="${k + 1}" role="tab" aria-selected="${rankU === k + 1}">Unit ${pad(k + 1)}</button>`).join('')}
    </div>
    ${rankRows == null ? '<div class="vb-panel empty">불러오는 중…</div>'
      : !rows.length ? `<div class="vb-panel empty"><b>아직 기록이 없어요</b>${rankU ? 'Unit ' + pad(rankU) + '의' : '이 리그의'} 첫 1등이 되어보세요</div>`
      : `<div class="podium">${pod(0)}${pod(1)}${pod(2)}</div>
        ${rows.length > 3 ? `<ol class="rlist vb-panel">${rows.slice(3).map((x, i) => `<li class="${isMe(x) ? 'mine' : ''}"><span class="n">${i + 4}</span><b>${esc(x.nick)}${isMe(x) ? '<span class="you">나</span>' : ''}</b><span class="s">${fmt(x.score)}</span></li>`).join('')}</ol>` : ''}`}
    <p class="note">${rankU ? 'Unit별 최고점 기준' : 'Unit별 최고점을 모두 더한 점수 기준'} · 상위 50명</p>
    ${ME ? `<div class="mybar vb-panel">${avatar(ME.nick)}<div class="t"><small>내 기록 ${myIdx >= 0 ? '· ' + (myIdx + 1) + '위' : rows.length >= 50 && myScore ? '· 50위 밖' : ''}</small><b>${myScore ? fmt(myScore) + '점' : '기록 없음'}</b></div>${rankU ? `<button type="button" class="vb-primary" id="pl">도전하기</button>` : ''}</div>` : ''}
  </section>`;
  const rc = $('rc'); if (sl != null) rc.scrollLeft = sl; else rc.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  rc.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { rankU = +b.dataset.r; rankRows = null; rank(); pull(); }));
  const pl = $('pl'); if (pl) pl.onclick = () => { unit = rankU; LS.set('vb-unit', unit); tab = 'quiz'; R = null; start(unit); };
}

/* ---------- 댓글 ---------- */
function talk() {
  const draft = $('ct') ? $('ct').value : '', du = $('cu') ? $('cu').value : '0';
  M.innerHTML = `<section class="talk">
    <div class="rank-head"><div><span class="eyebrow">CHAT</span><h1>댓글</h1></div><small><i class="live-dot"></i>LIVE · 5초마다 갱신</small></div>
    <div class="talk-grid">
      ${ME ? `<form class="composer vb-panel" id="cf" novalidate>
        <div class="ph"><h3>${esc(ME.nick)}(으)로 쓰기</h3></div>
        <label class="sr" for="ct">댓글 내용</label>
        <textarea class="input" id="ct" maxlength="300" placeholder="외우는 팁, 헷갈리는 단어, 도발 한마디…"></textarea>
        <div class="meta"><span><label class="sr" for="cu">Unit 태그</label><select class="input" id="cu"><option value="0">태그 없음</option>${Array.from({ length: UNITS }, (_, k) => `<option value="${k + 1}">Unit ${pad(k + 1)}</option>`).join('')}</select></span><span id="cc">0 / 300</span></div>
        <p class="err" id="ce" role="alert"></p>
        <div class="row"><button class="vb-primary" id="cs" type="submit">등록</button></div>
      </form>` : `<div class="composer vb-panel"><h3>로그인하고 대화에 참여하세요</h3><p class="note">댓글 읽기는 누구나 할 수 있어요.</p><button type="button" class="vb-primary" id="gl">로그인 / 가입</button></div>`}
      ${comments == null ? '<div class="vb-panel empty">불러오는 중…</div>'
        : comments.length ? `<ul class="clist vb-panel">${comments.map((c) => {
          const mine = ME && c.uid === ME.id;
          return `<li class="${mine ? 'mine-c' : ''}">${avatar(c.nick)}<div><div class="h"><b>${esc(c.nick)}</b>${c.unit ? `<span class="vb-chip">Unit ${pad(c.unit)}</span>` : ''}<span>${ago(c.at)}</span>${mine ? `<button type="button" class="del" data-d="${c.id}">삭제</button>` : ''}</div><p>${esc(c.text)}</p></div></li>`;
        }).join('')}</ul>`
        : '<div class="vb-panel empty"><b>첫 댓글을 남겨보세요</b>외우는 팁이나 각오 한마디도 좋아요</div>'}
    </div>
  </section>`;
  const t = $('ct');
  if (t) {
    t.value = draft; $('cu').value = du;
    const cnt = () => { $('cc').textContent = `${t.value.length} / 300`; };
    t.oninput = cnt; cnt();
    $('cf').onsubmit = async (e) => {
      e.preventDefault();
      const v = t.value.trim(); if (!v) { $('ce').textContent = '내용을 입력하세요'; return; }
      const btn = $('cs'); btn.disabled = true; $('ce').textContent = '';
      try { await call('/api/comments', { method: 'POST', body: { text: v, unit: +$('cu').value } }); t.value = ''; await pull(true); }
      catch (x) { const ce = $('ce'); if (ce) ce.textContent = x.message; }
      const b2 = $('cs'); if (b2) b2.disabled = false;
    };
  }
  const gl = $('gl'); if (gl) gl.onclick = () => { tab = 'quiz'; render(true); };
  M.querySelectorAll('[data-d]').forEach((b) => (b.onclick = async () => {
    if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = '한 번 더 누르면 삭제'; setTimeout(() => { if (b.isConnected) { b.classList.remove('arm'); b.textContent = '삭제'; } }, 3000); return; }
    try { await call('/api/comments/' + b.dataset.d, { method: 'DELETE' }); await pull(true); } catch (x) { /* 무시 */ }
  }));
}

/* ---------- 실시간 갱신 ---------- */
async function pull(force) {
  if (G || (document.hidden && !force)) return;
  try {
    if (tab === 'rank') {
      const d = await call('/api/rank?unit=' + rankU);
      if (JSON.stringify(d.rows) !== JSON.stringify(rankRows)) { rankRows = d.rows; if (tab === 'rank' && !G) rank(); }
    }
    if (tab === 'talk') {
      const d = await call('/api/comments');
      if (force || JSON.stringify(d.rows) !== JSON.stringify(comments)) {
        comments = d.rows;
        const a = document.activeElement;
        if (tab === 'talk' && !G && (force || !(a && (a.id === 'ct' || a.id === 'cu')))) talk();
      }
    }
  } catch (e) { /* 다음 주기에 재시도 */ }
}

document.querySelectorAll('#tab button').forEach((b) => (b.onclick = () => {
  if (G) return;
  tab = b.dataset.v; editing = false; R = null; render(true); pull();
}));
document.addEventListener('visibilitychange', () => pull());
setInterval(pull, POLL);

(async () => {
  if (token) { M.innerHTML = '<div class="vb-panel empty">로그인 정보 확인 중…</div>'; try { ME = await call('/api/me'); } catch (e) { /* 게스트로 시작 */ } }
  render(true);
})();
})();
