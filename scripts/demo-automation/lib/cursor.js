// Injects a visible fake cursor + click-ripple overlay so headed runs are
// easy to follow — Playwright's synthetic input is real at the CDP level (it
// fires genuine mousemove/mousedown DOM events), so a plain listener is
// enough; no need to hook every action. Uses addInitScript so it survives
// every navigation in the login flows (a one-off evaluate() would be wiped
// out by the next page.goto()).
export async function injectFakeCursor(page) {
  await page.addInitScript(() => {
    if (window.__demo_cursor_installed__) return;
    window.__demo_cursor_installed__ = true;

    // addInitScript runs at the earliest possible moment for a new document —
    // in Chromium that can be *before* document.documentElement exists at all,
    // not just before document.body. Touching documentElement synchronously
    // here throws ("Cannot read properties of null"), which aborts the whole
    // script before mount() ever runs. Poll via rAF until both exist.
    function mount() {
      if (!document.documentElement || !document.body) { requestAnimationFrame(mount); return; }

      const style = document.createElement('style');
      style.textContent = `
        #__demo_cursor__{
          position:fixed; left:0; top:0; width:22px; height:22px; z-index:2147483647;
          pointer-events:none; transform:translate(-3px,-3px);
          background:radial-gradient(circle at 30% 30%, #fff, #FF8A65 60%);
          border:2px solid rgba(0,0,0,.35); border-radius:50% 50% 50% 4px;
          box-shadow:0 2px 6px rgba(0,0,0,.4);
          transition:left .06s linear, top .06s linear;
        }
        #__demo_ripple_host__{ position:fixed; inset:0; z-index:2147483646; pointer-events:none; }
        .__demo_ripple__{
          position:fixed; width:16px; height:16px; margin:-8px 0 0 -8px; border-radius:50%;
          background:rgba(255,138,101,.55); border:2px solid rgba(255,138,101,.9);
          animation:__demo_ripple_anim__ .55s ease-out forwards;
        }
        @keyframes __demo_ripple_anim__{
          from{ transform:scale(0.4); opacity:1; }
          to{ transform:scale(2.6); opacity:0; }
        }
        @media (prefers-reduced-motion:reduce){ .__demo_ripple__{ animation-duration:.01s; } }
      `;
      document.documentElement.appendChild(style);

      const cur = document.createElement('div');
      cur.id = '__demo_cursor__';
      document.body.appendChild(cur);
      const rippleHost = document.createElement('div');
      rippleHost.id = '__demo_ripple_host__';
      document.body.appendChild(rippleHost);

      document.addEventListener('mousemove', (e) => {
        cur.style.left = e.clientX + 'px';
        cur.style.top = e.clientY + 'px';
      }, true);

      document.addEventListener('mousedown', (e) => {
        cur.style.left = e.clientX + 'px';
        cur.style.top = e.clientY + 'px';
        const r = document.createElement('div');
        r.className = '__demo_ripple__';
        r.style.left = e.clientX + 'px';
        r.style.top = e.clientY + 'px';
        rippleHost.appendChild(r);
        setTimeout(() => r.remove(), 650);
      }, true);
    }
    mount();
  });
}
