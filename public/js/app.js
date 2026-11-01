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
let attToday = null, attRank = null, attMonth = null, attRankMode = 'streak', attFresh = false;
const attDays = {}; // 'YYYY-MM' -> 출석한 날짜 배열
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
    <div class="menu-h"><b>${esc(ME.nick)}</b><small>플레이 ${fmt(ME.plays)}회 · 합산 ${fmt(sumBest(ME.best))}점${ME.attend && ME.attend.streak ? ' · ' + ME.attend.streak + '일 연속 출석' : ''}</small></div>
    <button type="button" role="menuitem" id="cn">닉네임 변경</button>
    <button type="button" role="menuitem" id="lo">로그아웃</button>
  </div>`;
  const mb = $('mb'), mm = $('mm');
  mb.onclick = (e) => { e.stopPropagation(); mm.hidden = !mm.hidden; mb.setAttribute('aria-expanded', String(!mm.hidden)); };
  $('cn').onclick = () => { if (G) return; mm.hidden = true; editing = true; tab = 'quiz'; R = null; render(true); };
  $('lo').onclick = async () => {
    if (G) quitGame();
    try { await call('/api/logout', { method: 'POST' }); } catch (e) { /* 무시 */ }
    token = null; LS.set('vb-token', null); ME = null; R = null; ST.loaded = false; tab = 'quiz'; render(true);
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
  else if (tab === 'att') att();
  else if (tab === 'study') study();
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
      token = d.token; LS.set('vb-token', token); ME = await call('/api/me'); ST.loaded = false; render(true);
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
    <div class="hello"><div><span class="eyebrow">READY PLAYER</span><h1>${esc(ME.nick)}님, 한 판 할까요?</h1></div>${attBadge()}</div>
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
        <button type="button" class="vb-secondary" id="sd">카드로 공부하기 · 시간 제한 없음</button>
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
  $('sd').onclick = () => { setDeck('u' + unit); S.dir = dir; saveSP(); tab = 'study'; render(true); };
  const ab = $('ab'); if (ab) ab.onclick = () => { tab = 'att'; render(true); pull(); };
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

/* ---------- 카드 학습 (시간 제한 없음) ---------- */
const SP = (() => { try { return JSON.parse(LS.get('vb-study-pref') || '{}'); } catch (e) { return {}; } })();
const S = { deck: SP.deck || 'u1', dir: SP.dir ? 1 : 0, mode: SP.mode === 'list' ? 'list' : 'card', shuffle: !!SP.shuffle, hideKnown: !!SP.hideKnown, hideMean: false, base: null, baseKey: '', i: 0, flip: false };
const SPOS = (() => { try { return JSON.parse(LS.get('vb-study-pos') || '{}'); } catch (e) { return {}; } })();
const ST = { known: new Set(), star: new Set(), remote: false, loaded: false };
if (!S.shuffle) S.i = Math.max(0, +SPOS[S.deck] || 0);
const saveSP = () => LS.set('vb-study-pref', JSON.stringify({ deck: S.deck, dir: S.dir, mode: S.mode, shuffle: S.shuffle, hideKnown: S.hideKnown }));
const savePos = () => { if (!S.shuffle) { SPOS[S.deck] = S.i; LS.set('vb-study-pos', JSON.stringify(SPOS)); } };
const saveLocalST = () => { if (!ST.remote) LS.set('vb-study-local', JSON.stringify({ known: [...ST.known], star: [...ST.star] })); };
const canSpeak = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
function speak(w) {
  if (!canSpeak) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(w); u.lang = 'en-US'; u.rate = 0.9; speechSynthesis.speak(u); } catch (e) { /* 무시 */ }
}
async function loadStudy() {
  ST.known.clear(); ST.star.clear();
  if (ME) {
    try { const d = await call('/api/study'); d.known.forEach((w) => ST.known.add(w)); d.star.forEach((w) => ST.star.add(w)); ST.remote = true; ST.loaded = true; return; }
    catch (e) { /* 아래 로컬로 */ }
  }
  ST.remote = false; ST.loaded = true;
  try { const d = JSON.parse(LS.get('vb-study-local') || '{}'); (d.known || []).forEach((w) => ST.known.add(w)); (d.star || []).forEach((w) => ST.star.add(w)); } catch (e) { /* 무시 */ }
}
async function mark(word, field) {
  const set = ST[field], on = !set.has(word);
  on ? set.add(word) : set.delete(word);
  saveLocalST();
  if (ST.remote) {
    try { await call('/api/study', { method: 'POST', body: { word, [field]: on } }); }
    catch (x) { on ? set.delete(word) : set.add(word); if (tab === 'study') { const e = $('se'); if (e) e.textContent = '저장하지 못했어요 · ' + x.message; study(); } return; }
  }
  if (field === 'known' && on && S.mode === 'card' && !S.hideKnown) { S.flip = false; S.i++; savePos(); }
  if (tab === 'study') study();
}
const deckName = (k) => (k === 'wrong' ? '오답노트' : k === 'star' ? '별표 단어' : 'Unit ' + pad(+k.slice(1)));
function deckSource(k) {
  if (k === 'wrong') return wrongWords().map((x) => x.word);
  if (k === 'star') return W.filter((x) => ST.star.has(x.w)).map((x) => x.w);
  const u = +k.slice(1); return W.filter((x) => x.u === u).map((x) => x.w);
}
function visibleDeck() {
  const key = S.deck + '|' + S.shuffle;
  const src = deckSource(S.deck);
  if (S.baseKey !== key || !S.base) { S.base = S.shuffle ? sh(src) : src; S.baseKey = key; }
  else { const have = new Set(S.base), now = new Set(src); S.base = S.base.filter((w) => now.has(w)).concat(src.filter((w) => !have.has(w))); }
  return S.hideKnown ? S.base.filter((w) => !ST.known.has(w)) : S.base;
}
function setDeck(k) { S.deck = k; S.base = null; S.i = S.shuffle ? 0 : Math.max(0, +SPOS[k] || 0); S.flip = false; saveSP(); }

function study() {
  if (!ST.loaded) { M.innerHTML = '<div class="vb-panel empty">학습 기록 불러오는 중…</div>'; loadStudy().then(() => tab === 'study' && !G && study()); return; }
  const sl = $('dk') ? $('dk').scrollLeft : null;
  const deck = visibleDeck(), all = deckSource(S.deck), knownN = all.filter((w) => ST.known.has(w)).length;
  if (S.i > deck.length) S.i = deck.length;
  const wc = wrongWords().length;
  const pills = Array.from({ length: UNITS }, (_, k) => `u${k + 1}`).map((k) => `<button type="button" class="pill${S.deck === k ? ' on' : ''}" data-d="${k}">${deckName(k)}</button>`).join('')
    + `<button type="button" class="pill${S.deck === 'wrong' ? ' on' : ''}" data-d="wrong">오답노트 ${wc}</button><button type="button" class="pill${S.deck === 'star' ? ' on' : ''}" data-d="star">★ 별표 ${ST.star.size}</button>`;
  const tg = (id, on, label) => `<button type="button" class="tgl${on ? ' on' : ''}" id="${id}" aria-pressed="${on}"><span class="sw" aria-hidden="true"></span>${label}</button>`;
  let body;
  if (!all.length) {
    body = `<div class="vb-panel empty"><b>${S.deck === 'star' ? '별표한 단어가 없어요' : '오답노트가 비었어요'}</b>${S.deck === 'star' ? '카드에서 ★를 눌러 모아보세요' : '퀴즈에서 틀린 단어가 여기에 모여요'}</div>`;
  } else if (S.mode === 'list') {
    body = `<div class="vb-panel slist-p"><div class="ph"><h3>${deckName(S.deck)} · ${deck.length}단어</h3>${tg('hm', S.hideMean, S.dir ? '영단어 가리기' : '뜻 가리기')}</div>
      <ul class="slist">${deck.map((w) => { const x = BYW[w]; const a = S.dir ? x.m : x.w, b = S.dir ? x.w : x.m; return `<li class="${ST.known.has(w) ? 'kn' : ''}">
        <button type="button" class="ic st${ST.star.has(w) ? ' on' : ''}" data-s="${esc(w)}" aria-label="별표" aria-pressed="${ST.star.has(w)}">★</button>
        <div class="wm"><b lang="${S.dir ? 'ko' : 'en'}">${esc(a)}</b><span class="mn${S.hideMean ? ' hid' : ''}" tabindex="${S.hideMean ? 0 : -1}" lang="${S.dir ? 'en' : 'ko'}">${esc(b)}</span></div>
        ${canSpeak ? `<button type="button" class="ic" data-p="${esc(w)}" aria-label="발음 듣기">${spkSVG}</button>` : ''}
        <button type="button" class="ic kn${ST.known.has(w) ? ' on' : ''}" data-k="${esc(w)}" aria-label="외웠어요" aria-pressed="${ST.known.has(w)}">✓</button></li>`; }).join('')}</ul></div>`;
  } else if (S.i >= deck.length) {
    body = `<div class="vb-panel done-p"><span class="eyebrow">DECK CLEAR</span><h2>${deckName(S.deck)} 한 바퀴 끝!</h2>
      <p class="note">${all.length}단어 중 <b>${knownN}</b>개를 외웠어요${all.length - knownN ? ` · 남은 ${all.length - knownN}개` : ''}</p>
      <div class="vb-progress"><span style="width:${(knownN / all.length * 100).toFixed(1)}%"></span></div>
      <div class="res-actions"><button type="button" class="vb-primary" id="rs1">${all.length - knownN && !S.hideKnown ? '모르는 단어만 다시' : '처음부터 다시'}</button><button type="button" class="vb-secondary" id="rs2">처음부터 전체</button>${S.deck.startsWith('u') ? `<button type="button" class="vb-secondary" id="rs3">이 Unit 퀴즈 도전</button>` : ''}</div></div>`;
  } else {
    const w = deck[S.i], x = BYW[w], front = S.dir ? x.m : x.w, back = S.dir ? x.w : x.m;
    body = `<div class="fc-wrap">
      <div class="fc${S.flip ? ' flip' : ''}" id="fc" role="button" tabindex="0" aria-label="${S.flip ? '앞면 보기' : '뒤집어서 ' + (S.dir ? '영단어' : '뜻') + ' 보기'}">
        <div class="fc-in">
          <div class="fc-face front"><span class="vb-chip">Unit ${pad(x.u)}</span>${ST.known.has(w) ? '<span class="fc-tag">외움</span>' : ''}<b lang="${S.dir ? 'ko' : 'en'}" class="${[...front].length > 12 ? 'l' : ''}">${esc(front)}</b><small>탭해서 ${S.dir ? '영단어' : '뜻'} 보기</small></div>
          <div class="fc-face back"><small lang="${S.dir ? 'ko' : 'en'}">${esc(front)}</small><b lang="${S.dir ? 'en' : 'ko'}" class="${[...back].length > 12 ? 'l' : ''}">${esc(back)}</b><small>다시 탭하면 앞면</small></div>
        </div>
      </div>
      <div class="fc-nav">
        <button type="button" class="vb-secondary" id="pv" ${S.i ? '' : 'disabled'} aria-label="이전 카드">‹ 이전</button>
        <button type="button" class="vb-secondary" id="fl">뒤집기</button>
        <button type="button" class="vb-primary" id="nx" aria-label="다음 카드">다음 ›</button>
      </div>
      <div class="fc-act">
        <button type="button" class="act st${ST.star.has(w) ? ' on' : ''}" id="bs" aria-pressed="${ST.star.has(w)}"><span>★</span>${ST.star.has(w) ? '별표 해제' : '별표'}</button>
        ${canSpeak ? `<button type="button" class="act" id="sp2">${spkSVG}발음 듣기</button>` : ''}
        <button type="button" class="act kn${ST.known.has(w) ? ' on' : ''}" id="bk2" aria-pressed="${ST.known.has(w)}"><span>✓</span>${ST.known.has(w) ? '외움 취소' : '외웠어요'}</button>
      </div>
      <p class="kbd-hint"><kbd>Space</kbd> 뒤집기 · <kbd>←</kbd><kbd>→</kbd> 이동 · <kbd>K</kbd> 외웠어요 · <kbd>S</kbd> 별표 · <kbd>P</kbd> 발음</p>
    </div>`;
  }
  const pos = S.mode === 'card' && deck.length ? Math.min(S.i + 1, deck.length) : deck.length;
  M.innerHTML = `<section class="study">
    <div class="rank-head"><div><span class="eyebrow">STUDY · 시간 제한 없음</span><h1>카드 학습</h1></div>
      <small>${ME ? (ST.remote ? '외운 단어·별표가 계정에 저장돼요' : '오프라인 · 이 기기에만 저장 중') : '게스트 · 이 기기에만 저장돼요'}</small></div>
    <div class="hscroll" id="dk" role="tablist" aria-label="학습할 단어 묶음">${pills}</div>
    <div class="s-ctrl">
      <div class="seg" id="sdir" role="group" aria-label="방향"><button type="button" data-v="0" class="${S.dir ? '' : 'on'}">영 → 뜻</button><button type="button" data-v="1" class="${S.dir ? 'on' : ''}">뜻 → 영</button></div>
      <div class="seg" id="smode" role="group" aria-label="보기 방식"><button type="button" data-v="card" class="${S.mode === 'card' ? 'on' : ''}">카드</button><button type="button" data-v="list" class="${S.mode === 'list' ? 'on' : ''}">목록</button></div>
      ${tg('shf', S.shuffle, '섞기')}${tg('hk', S.hideKnown, '외운 단어 빼기')}
    </div>
    ${all.length ? `<div class="s-prog"><div class="row"><b>${S.mode === 'card' ? `${pos} / ${deck.length}` : `${deck.length}단어`}</b><span>외운 단어 <b>${knownN}</b> / ${all.length}</span></div>
      <div class="vb-progress"><span style="width:${(knownN / all.length * 100).toFixed(1)}%"></span></div></div>` : ''}
    <p class="err" id="se" role="alert"></p>
    ${body}
  </section>`;
  const dk = $('dk'); if (sl != null) dk.scrollLeft = sl; else dk.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  dk.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { setDeck(b.dataset.d); study(); }));
  M.querySelectorAll('#sdir button').forEach((b) => (b.onclick = () => { S.dir = +b.dataset.v; S.flip = false; saveSP(); study(); }));
  M.querySelectorAll('#smode button').forEach((b) => (b.onclick = () => { S.mode = b.dataset.v; saveSP(); study(); }));
  $('shf').onclick = () => { S.shuffle = !S.shuffle; S.base = null; S.i = S.shuffle ? 0 : Math.max(0, +SPOS[S.deck] || 0); S.flip = false; saveSP(); study(); };
  $('hk').onclick = () => { S.hideKnown = !S.hideKnown; S.i = 0; S.flip = false; saveSP(); study(); };
  const hmb = $('hm'); if (hmb) hmb.onclick = () => { S.hideMean = !S.hideMean; study(); };
  M.querySelectorAll('.slist .mn.hid').forEach((n) => { const r = () => n.classList.toggle('peek'); n.onclick = r; n.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); r(); } }; });
  M.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => mark(b.dataset.s, 'star')));
  M.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => mark(b.dataset.k, 'known')));
  M.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => speak(b.dataset.p)));
  const r1 = $('rs1'); if (r1) r1.onclick = () => { if (all.length - knownN && !S.hideKnown) S.hideKnown = true; S.i = 0; S.flip = false; if (S.shuffle) S.base = null; saveSP(); savePos(); study(); };
  const r2 = $('rs2'); if (r2) r2.onclick = () => { S.hideKnown = false; S.i = 0; S.flip = false; if (S.shuffle) S.base = null; saveSP(); savePos(); study(); };
  const r3 = $('rs3'); if (r3) r3.onclick = () => { unit = +S.deck.slice(1); LS.set('vb-unit', unit); tab = 'quiz'; R = null; start(unit); };
  const fc = $('fc');
  if (fc) {
    const w = deck[S.i];
    const flip = () => { S.flip = !S.flip; fc.classList.toggle('flip', S.flip); fc.setAttribute('aria-label', S.flip ? '앞면 보기' : '뒤집기'); if (S.flip) say(fc.querySelector('.back b').textContent); };
    let sx = null, sy = 0, moved = false;
    fc.onpointerdown = (e) => { sx = e.clientX; sy = e.clientY; moved = false; };
    fc.onpointermove = (e) => { if (sx == null) return; const dx = e.clientX - sx; if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - sy)) { moved = true; fc.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`; } };
    const end = (e) => { if (sx == null) return; const dx = e.clientX - sx; sx = null; fc.style.transform = ''; if (moved && Math.abs(dx) > 70) { go(dx < 0 ? 1 : -1); } else if (!moved) flip(); };
    fc.onpointerup = end; fc.onpointercancel = () => { sx = null; fc.style.transform = ''; };
    fc.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); flip(); } };
    $('fl').onclick = flip;
    $('pv').onclick = () => go(-1);
    $('nx').onclick = () => go(1);
    $('bs').onclick = () => mark(w, 'star');
    $('bk2').onclick = () => mark(w, 'known');
    const sp2 = $('sp2'); if (sp2) sp2.onclick = () => speak(w);
  }
}
const spkSVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
function go(d) {
  const n = visibleDeck().length; const ni = Math.max(0, Math.min(n, S.i + d));
  if (ni === S.i) return; S.i = ni; S.flip = false; savePos(); study();
  const fc = $('fc'); if (fc) UI.restart(fc, d > 0 ? 'in-r' : 'in-l');
}
document.addEventListener('keydown', (e) => {
  if (tab !== 'study' || G || S.mode !== 'card' || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  const fc = $('fc'), w = fc ? visibleDeck()[S.i] : null;
  if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  else if (!fc) return;
  else if (e.key === ' ' && t === document.body || e.key === ' ' && t === fc) { e.preventDefault(); $('fl').click(); }
  else if (e.key === 'k' || e.key === 'K') mark(w, 'known');
  else if (e.key === 's' || e.key === 'S') mark(w, 'star');
  else if ((e.key === 'p' || e.key === 'P') && canSpeak) speak(w);
});

/* ---------- 출석부 ---------- */
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const hm = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
const dayLabel = (d) => { const x = new Date(d + 'T00:00:00Z'); return `${x.getUTCMonth() + 1}월 ${x.getUTCDate()}일 ${WD[x.getUTCDay()]}요일`; };
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const stampSVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17 19 7.5"/></svg>';

function attBadge() {
  const a = ME && ME.attend; if (!a) return '';
  return a.checked
    ? `<button type="button" class="att-badge done" id="ab"><span class="dot"></span>${a.streak}일 연속 출석 중</button>`
    : `<button type="button" class="att-badge" id="ab"><span class="dot"></span>오늘 출석 체크 안 했어요 · 출석하기</button>`;
}

async function loadAtt(all) {
  const today = (attToday && attToday.day) || kstToday();
  if (!attMonth) attMonth = today.slice(0, 7);
  const jobs = [call('/api/attend/today'), call('/api/attend/rank')];
  if (ME && (all || !attDays[attMonth])) jobs.push(call('/api/attend?month=' + attMonth));
  const [t, r, mine] = await Promise.all(jobs);
  let changed = JSON.stringify(t) !== JSON.stringify(attToday) || JSON.stringify(r) !== JSON.stringify(attRank);
  attToday = t; attRank = r;
  if (mine) {
    changed = changed || JSON.stringify(mine.days) !== JSON.stringify(attDays[mine.month]);
    attDays[mine.month] = mine.days;
    if (ME) ME.attend = { today: mine.today, checked: mine.checked, streak: mine.streak, total: mine.total };
  }
  return changed;
}

function calendar() {
  const ym = attMonth, today = (attToday && attToday.day) || kstToday();
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = new Set(attDays[ym] || []);
  let cells = '';
  for (let i = 0; i < first; i++) cells += '<span class="cd pad"></span>';
  for (let d = 1; d <= n; d++) {
    const key = `${ym}-${pad(d)}`, on = days.has(key), isT = key === today, fut = key > today;
    cells += `<span class="cd${on ? ' on' : ''}${isT ? ' today' : ''}${fut ? ' fut' : ''}" aria-label="${m}월 ${d}일${on ? ' 출석' : ''}"><i>${d}</i>${on ? stampSVG : ''}</span>`;
  }
  const canNext = ym < today.slice(0, 7);
  return `<div class="ph cal-h"><button type="button" class="cal-nav" id="cp" aria-label="이전 달">‹</button><h3>${y}년 ${m}월</h3><button type="button" class="cal-nav" id="cx" aria-label="다음 달" ${canNext ? '' : 'disabled'}>›</button></div>
    <div class="cal" role="grid">${WD.map((w, i) => `<span class="wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</span>`).join('')}${cells}</div>
    <p class="note cal-sum">${ME ? `이번 달 ${(attDays[ym] || []).length}일 출석` : '로그인하면 내 출석 달력이 보여요'}</p>`;
}

function att() {
  const draft = $('am2') ? $('am2').value : '';
  const rows = attToday ? attToday.rows : null, day = (attToday && attToday.day) || kstToday();
  const a = ME && ME.attend, myOrder = ME && rows ? rows.findIndex((x) => x.nick === ME.nick) + 1 : 0;
  const rk = attRank ? (attRankMode === 'streak' ? attRank.streak.map((x) => ({ nick: x.nick, v: x.streak })) : attRank.monthly.map((x) => ({ nick: x.nick, v: x.n }))) : null;
  if (!attMonth) attMonth = day.slice(0, 7);
  M.innerHTML = `<section class="att">
    <div class="rank-head"><div><span class="eyebrow">ATTENDANCE</span><h1>출석부</h1></div><small><i class="live-dot"></i>오늘 ${rows ? rows.length : '–'}명 출석</small></div>
    <div class="att-grid"><div class="att-col">
      <div class="stampp vb-panel vb-glow" id="sp">
        <div class="ph"><div><span class="eyebrow">TODAY</span><h2>${dayLabel(day)}</h2></div></div>
        ${!ME ? `<div class="stamp-zone"><div class="seal empty"><span>출석</span></div><p class="note">로그인하면 매일 출석 도장을 찍을 수 있어요.</p><button type="button" class="vb-primary" id="ag">로그인 / 가입</button></div>`
        : a && a.checked ? `<div class="stamp-zone"><div class="seal${attFresh ? ' fresh' : ''}" id="seal"><img src="/images/logo-mark.svg" alt="" width="44" height="44"><b>출석</b><small>${day.slice(5).replace('-', '.')}</small></div>
            <p class="stamp-msg"><b>출석 완료!</b> ${myOrder ? `오늘 ${myOrder}번째로 왔어요` : ''}</p></div>`
        : `<form class="stamp-zone" id="af2" novalidate><div class="seal empty"><span>?</span></div>
            <div class="field"><label for="am2">오늘의 한마디 <small>(선택 · 50자)</small></label><input class="input" id="am2" maxlength="50" placeholder="예: 오늘은 Unit 5 정복한다"></div>
            <p class="err" id="ae2" role="alert"></p>
            <button class="vb-primary stamp-btn" id="as2" type="submit">출석 도장 찍기</button></form>`}
        ${ME && a ? `<div class="att-stats">
          <div class="stat"><small>연속 출석</small><b>${a.streak}<i>일</i></b></div>
          <div class="stat"><small>누적 출석</small><b>${a.total}<i>일</i></b></div>
          <div class="stat"><small>이번 달</small><b>${(attDays[day.slice(0, 7)] || []).length}<i>일</i></b></div></div>` : ''}
      </div>
      <div class="calp vb-panel">${calendar()}</div>
      </div><div class="att-col">
      <div class="todayp vb-panel">
        <div class="ph"><h3>오늘의 출석부</h3><small>${rows ? rows.length + '명' : ''}</small></div>
        ${rows == null ? '<p class="empty">불러오는 중…</p>' : !rows.length ? '<p class="empty"><b>아직 아무도 없어요</b>오늘 1등으로 출석해보세요</p>'
          : `<ol class="alist">${rows.map((x, i) => `<li class="${ME && x.nick === ME.nick ? 'mine' : ''}"><span class="rk${i < 3 ? ' vb-rank-' + (i + 1) : ''}">${i + 1}</span>${avatar(x.nick)}<div class="ab"><div class="h"><b>${esc(x.nick)}</b>${x.streak > 1 ? `<span class="vb-chip st">${x.streak}일 연속</span>` : ''}<span class="tm">${hm(x.at)}</span></div>${x.msg ? `<p>${esc(x.msg)}</p>` : ''}</div></li>`).join('')}</ol>`}
      </div>
      <div class="arank vb-panel">
        <div class="ph"><h3>출석 랭킹</h3><div class="seg sm" id="arm"><button type="button" data-v="streak" class="${attRankMode === 'streak' ? 'on' : ''}">연속 출석</button><button type="button" data-v="monthly" class="${attRankMode === 'monthly' ? 'on' : ''}">이번 달</button></div></div>
        ${rk == null ? '<p class="empty">불러오는 중…</p>' : !rk.length ? '<p class="empty">아직 기록이 없어요</p>'
          : `<ol class="mini">${rk.slice(0, 10).map((x, i) => { const mi = ME && x.nick === ME.nick; return `<li class="${mi ? 'mine' : ''}"><span class="rk${i < 3 ? ' vb-rank-' + (i + 1) : ''}">${i + 1}</span><b>${esc(x.nick)}${mi ? '<span class="you">나</span>' : ''}</b><span>${x.v}일</span></li>`; }).join('')}</ol>`}
      </div>
    </div></div>
  </section>`;
  attFresh = false;
  const f = $('af2');
  if (f) {
    $('am2').value = draft;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('as2'); btn.disabled = true; $('ae2').textContent = '';
      try {
        const d = await call('/api/attend', { method: 'POST', body: { msg: $('am2').value } });
        ME.attend = { today: d.today, checked: true, streak: d.streak, total: d.total };
        const ym = d.today.slice(0, 7); attDays[ym] = [...new Set([...(attDays[ym] || []), d.today])].sort();
        await loadAtt().catch(() => {});
        attFresh = true; att(); header();
        const sp = $('sp'); UI.flashNode(sp, 'combo-burst', '', 800); UI.buzz(40);
        say(`출석 완료. 오늘 ${d.order}번째, ${d.streak}일 연속 출석`);
      } catch (x) {
        $('ae2').textContent = x.message; btn.disabled = false;
        if (/이미/.test(x.message)) { await loadAtt(true).catch(() => {}); att(); }
      }
    };
  }
  const ag = $('ag'); if (ag) ag.onclick = () => { tab = 'quiz'; render(true); };
  $('cp').onclick = () => { attMonth = shiftMonth(attMonth, -1); att(); if (ME && !attDays[attMonth]) loadAtt().then(() => tab === 'att' && !G && att()).catch(() => {}); };
  $('cx').onclick = () => { attMonth = shiftMonth(attMonth, 1); att(); if (ME && !attDays[attMonth]) loadAtt().then(() => tab === 'att' && !G && att()).catch(() => {}); };
  M.querySelectorAll('#arm button').forEach((b) => (b.onclick = () => { attRankMode = b.dataset.v; att(); }));
}

/* ---------- 실시간 갱신 ---------- */
async function pull(force) {
  if (G || (document.hidden && !force)) return;
  try {
    if (tab === 'rank') {
      const d = await call('/api/rank?unit=' + rankU);
      if (JSON.stringify(d.rows) !== JSON.stringify(rankRows)) { rankRows = d.rows; if (tab === 'rank' && !G) rank(); }
    }
    if (tab === 'att') {
      const a = document.activeElement;
      if ((await loadAtt(force)) && tab === 'att' && !G && !(a && a.id === 'am2')) att();
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
