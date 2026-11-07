/* VOCAB BATTLE 라이트/다크 전환 — <head>에서 바로 실행해 깜빡임 없이 적용.
   버튼은 헤더의 #theme-slot에 붙어요(없으면 화면 오른쪽 아래). 퀴즈 로직과 무관. */
(() => {
  const KEY = 'vocab-battle-theme';
  const root = document.documentElement;
  const meta = () => document.querySelector('meta[name="theme-color"]');
  const read = () => {
    let saved = null; try { saved = localStorage.getItem(KEY); } catch (e) { /* 무시 */ }
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  const ICON = {
    dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>',
    light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  };
  const apply = (t) => {
    root.dataset.theme = t; root.style.colorScheme = t;
    const m = meta(); if (m) m.content = t === 'dark' ? '#0b1020' : '#101f55';
    const b = document.getElementById('vb-theme-toggle');
    if (b) {
      const dark = t === 'dark';
      b.setAttribute('aria-label', dark ? '라이트 모드로 전환' : '다크 모드로 전환');
      b.title = dark ? '라이트 모드' : '다크 모드';
      b.innerHTML = ICON[dark ? 'light' : 'dark'];
    }
  };
  apply(read());
  const mount = () => {
    if (document.getElementById('vb-theme-toggle')) return apply(read());
    const b = document.createElement('button');
    b.id = 'vb-theme-toggle'; b.type = 'button';
    b.onclick = () => { const n = root.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem(KEY, n); } catch (e) { /* 무시 */ } apply(n); };
    (document.getElementById('theme-slot') || document.body).appendChild(b);
    apply(read());
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
