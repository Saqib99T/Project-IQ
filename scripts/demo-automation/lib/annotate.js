// Injects an on-screen "comment bubble" into the page during a recording so
// the .webm video is self-narrating — no voiceover needed. Pure DOM overlay,
// removed at the end of each step; has no effect on the app itself.

const STYLE_ID = '__demo_annotate_style__';
const HOST_ID = '__demo_annotate_host__';

async function ensureHost(page) {
  await page.evaluate(({ styleId, hostId }) => {
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #${hostId} {
        position: fixed; z-index: 2147483647; left: 50%; top: 20px;
        transform: translateX(-50%);
        /* responsive so it never overflows a narrow recording viewport (e.g.
           the ~460px-wide chat-widget cases) as well as full-HD ones */
        max-width: min(720px, calc(100vw - 32px)); width: max-content;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${hostId} .bubble {
        background: #16202E; color: #EEF2FA; border-radius: 12px;
        padding: 12px 16px; font-size: 15px; line-height: 1.4;
        box-shadow: 0 8px 28px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.06);
        opacity: 0; transform: translateY(-8px);
        transition: opacity .25s ease, transform .25s ease;
        position: relative; text-align: center;
      }
      #${hostId} .bubble.show { opacity: 1; transform: translateY(0); }
      #${hostId} .bubble::before {
        content: ""; position: absolute; left: 50%; top: -8px;
        width: 16px; height: 16px; background: #16202E;
        clip-path: polygon(0 100%, 100% 100%, 100% 0);
        transform: translateX(-50%) rotate(-45deg);
      }
      #${hostId} .bubble b { color: #7691FF; }
      #${hostId} .tag {
        display: inline-block; font-family: ui-monospace, monospace; font-size: 11px;
        letter-spacing: .06em; text-transform: uppercase; color: #7691FF;
        background: rgba(118,145,255,.14); padding: 2px 8px; border-radius: 99px;
        margin-bottom: 8px;
      }
      .__demo_highlight__ {
        outline: 3px solid #FF8A65 !important;
        outline-offset: 2px !important;
        border-radius: 6px !important;
        transition: outline-color .2s ease !important;
      }
    `;
    document.head.appendChild(style);
    const host = document.createElement('div');
    host.id = hostId;
    document.body.appendChild(host);
  }, { styleId: STYLE_ID, hostId: HOST_ID });
}

/**
 * Show a narration bubble in the corner of the screen for the given text.
 * @param {import('@playwright/test').Page} page
 * @param {string} text - supports simple **bold** markdown-ish via <b> conversion
 * @param {{tag?: string, holdMs?: number}} [opts]
 */
export async function say(page, text, opts = {}) {
  const { tag = null, holdMs = 4800 } = opts;
  await ensureHost(page);
  const html = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  await page.evaluate(({ hostId, html, tag }) => {
    const host = document.getElementById(hostId);
    host.innerHTML = `<div class="bubble">${tag ? `<span class="tag">${tag}</span><br/>` : ''}${html}</div>`;
    requestAnimationFrame(() => host.querySelector('.bubble').classList.add('show'));
  }, { hostId: HOST_ID, html, tag });
  await page.waitForTimeout(holdMs);
}

/** Draws a temporary highlight ring around an element so the bubble's
 * subject is obvious on camera, without depending on a screenshot crop. */
export async function highlight(locator, holdMs = 1500) {
  await locator.evaluate((el) => el.classList.add('__demo_highlight__')).catch(() => {});
  await locator.page().waitForTimeout(holdMs);
  await locator.evaluate((el) => el.classList.remove('__demo_highlight__')).catch(() => {});
}

/** Clears the bubble (e.g. right before navigating away). */
export async function clear(page) {
  await page.evaluate((hostId) => {
    const host = document.getElementById(hostId);
    if (host) host.innerHTML = '';
  }, HOST_ID).catch(() => {});
}
