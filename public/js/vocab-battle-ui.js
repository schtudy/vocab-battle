/* Vocab Battle UI helpers
   Design Kit의 vocab-battle-ui.js(setFeedback / setProgress / 패널 등장 효과)를
   동적으로 다시 그려지는 이 앱에 맞게 호출형으로 바꾸고, 게임 연출 유틸을 더한 버전.
   퀴즈·점수 로직은 들어 있지 않습니다(app.js 담당). */
(() => {
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduce = () => !!(mq && mq.matches);
  const fmt = (n) => (Math.round(+n) || 0).toLocaleString('ko-KR');

  window.VocabBattleUI = {
    get reduceMotion() { return reduce(); },
    fmt,

    // 키트 원본 API: 'correct' | 'wrong' | null
    setFeedback(element, state) {
      if (!element) return;
      element.classList.remove('is-correct', 'is-wrong');
      if (state === 'correct') element.classList.add('is-correct');
      if (state === 'wrong') element.classList.add('is-wrong');
    },

    // 키트 원본 API: 0~1
    setProgress(element, ratio) {
      if (!element) return;
      const fill = Math.max(0, Math.min(1, Number(ratio) || 0));
      element.style.width = `${fill * 100}%`;
    },

    // 키트의 DOMContentLoaded 패널 등장 효과를 화면 전환마다 호출할 수 있게 함
    enter(root) {
      if (!root || reduce()) return;
      root.querySelectorAll('.vb-panel, .stat, [data-enter]').forEach((el, index) => {
        el.classList.remove('vb-enter');
        void el.offsetWidth;
        el.style.animationDelay = `${Math.min(index * 55, 330)}ms`;
        el.classList.add('vb-enter');
      });
    },

    // 같은 애니메이션 클래스를 다시 재생
    restart(element, cls) {
      if (!element) return;
      element.classList.remove(cls);
      void element.offsetWidth;
      element.classList.add(cls);
    },

    // 요소 위로 떠오르는 텍스트(+187 등)
    floatText(anchor, text, cls = '') {
      if (!anchor || reduce()) return;
      const s = document.createElement('span');
      s.className = `vb-float ${cls}`.trim();
      s.textContent = text;
      s.setAttribute('aria-hidden', 'true');
      anchor.appendChild(s);
      const rm = () => s.remove();
      s.addEventListener('animationend', rm);
      setTimeout(rm, 1500);
    },

    // 일회성 오버레이(배너·도장·버스트)
    flashNode(parent, className, text, ms = 1000) {
      if (!parent) return null;
      const n = document.createElement('div');
      n.className = className;
      if (text) n.textContent = text;
      n.setAttribute('aria-hidden', 'true');
      parent.appendChild(n);
      setTimeout(() => n.remove(), reduce() ? Math.min(ms, 600) : ms);
      return n;
    },

    // 숫자 카운트업
    countUp(element, from, to, ms = 500) {
      if (!element) return;
      cancelAnimationFrame(element._vbCount);
      if (reduce() || ms <= 0 || from === to) { element.textContent = fmt(to); return; }
      const t0 = performance.now();
      const step = (t) => {
        const p = Math.min(1, (t - t0) / ms);
        const e = 1 - Math.pow(1 - p, 3);
        element.textContent = fmt(from + (to - from) * e);
        if (p < 1) element._vbCount = requestAnimationFrame(step);
      };
      element._vbCount = requestAnimationFrame(step);
    },

    // 오답 진동(지원 기기만)
    buzz(ms = 60) {
      try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* 무시 */ }
    },
  };
})();
