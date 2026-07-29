// Shared client logic for every dashboard page. Each HTML page sets
// `window.__DEMO_PAGE__ = { keys: [...] }` (keys = which cases to show, or
// omit/null for "all") before loading this script.
//
// Locally, server.js exposes GET /api/cases + POST /api/run (spawns real
// Playwright runs, live status, re-recording) — that's the "run the live
// demo" mode, and it's local-only on purpose. On prod, only the static files
// (this page, dashboard.css, recordings/*.webm) are hosted — no run-trigger
// endpoint exists there at all, so /api/cases 404s and STATIC_CASES /
// STATIC_MODE below render the same page as read-only video playback
// instead. All fetches use *relative* paths so this one file works mounted
// at the site root (local) or under /demo/ (prod).

const { keys: WANTED_KEYS = null } = window.__DEMO_PAGE__ || {};
const grid = document.getElementById('grid');
let cards = {};
let STATIC_MODE = false;
let pollTimer = null;

const STATIC_CASES = {
  act1: { title: 'Act 1 · Tenant User', desc: 'Chat widget — KB question, ticket creation, human handoff.' },
  act2: { title: 'Act 2 · Tenant Operator', desc: 'Claims the live chat, resolves it, works the same ticket at agent tier.' },
  act3: { title: 'Act 3 · Tenant Admin', desc: 'Portal + ITSM admin, integrations, the RCA lifecycle — the centerpiece.' },
  act4: { title: 'Act 4 · Super Admin', desc: 'Cross-tenant Organizations, the tenant switcher, platform routing rules.' },
  sla: { title: 'Flow · SLA / OLA / UC + SLI/SLO Reliability', desc: 'Agreements, targets, rules, coverage, at-risk board, ticket SLA panel, error budgets.' },
  rca: { title: 'Flow · RCA Governance', desc: 'Policy builder, a completed RCA (evidence + actions), recording-blocked RCAs.' },
};

function fmtBadge(status) {
  const map = { idle: 'Idle', running: 'Running', passed: 'Passed', failed: 'Failed' };
  const spin = status === 'running' ? '<span class="spinner"></span>' : '';
  return `<span class="badge ${status}">${spin}${map[status] || status}</span>`;
}

function buildCard(key, c) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <h2>${c.title} ${STATIC_MODE ? '' : `<span data-role="badge">${fmtBadge(c.status)}</span>`}</h2>
    <p class="desc">${c.desc}</p>
    <div data-role="video-wrap">${c.hasRecording ? `<div class="video-frame"><video controls src="recordings/${key}.webm?t=${c.finishedAt || 0}"></video></div>` : '<div class="novideo">No recording yet — run it once.</div>'}</div>
    ${STATIC_MODE ? '' : `
    <div class="row">
      <button class="run" data-role="runbtn">▶ Run</button>
      <label class="target-toggle">
        <select data-role="target">
          <option value="local" selected>Local</option>
          <option value="live">Live</option>
        </select>
      </label>
      <label><input type="checkbox" data-role="headed" checked> Open Browser</label>
      <label>SlowMo <input type="number" data-role="slowmo" value="250" min="0" step="50"> ms</label>
    </div>
    <pre class="log" data-role="log"></pre>
    `}
  `;
  if (!STATIC_MODE) {
    el.querySelector('[data-role="runbtn"]').addEventListener('click', () => triggerRun(key, el));
  }
  grid.appendChild(el);
  return el;
}

async function triggerRun(key, el) {
  const headed = el.querySelector('[data-role="headed"]').checked;
  const slowMo = Number(el.querySelector('[data-role="slowmo"]').value) || 0;
  const target = el.querySelector('[data-role="target"]').value;
  await fetch('api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, headed, slowMo, target }),
  });
  poll();
}

function renderStatic() {
  STATIC_MODE = true;
  const entries = Object.entries(STATIC_CASES).filter(([key]) => !WANTED_KEYS || WANTED_KEYS.includes(key));
  for (const [key, c] of entries) {
    cards[key] = buildCard(key, { ...c, hasRecording: true });
  }
}

async function poll() {
  let res;
  try {
    res = await fetch('api/cases');
  } catch {
    res = null;
  }
  if (!res || !res.ok) {
    // No run-trigger backend here (e.g. the prod static deploy) — render once
    // in read-only mode and stop polling an endpoint that will never appear.
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (!STATIC_MODE) renderStatic();
    return;
  }
  const data = await res.json();
  const entries = Object.entries(data).filter(([key]) => !WANTED_KEYS || WANTED_KEYS.includes(key));
  for (const [key, c] of entries) {
    if (!cards[key]) cards[key] = buildCard(key, c);
    const el = cards[key];
    const targetTag = c.status !== 'idle' && c.target === 'live' ? ' <span class="badge live-tag">live</span>' : '';
    el.querySelector('[data-role="badge"]').innerHTML = fmtBadge(c.status) + targetTag;
    const runBtn = el.querySelector('[data-role="runbtn"]');
    runBtn.disabled = c.status === 'running';
    runBtn.textContent = c.status === 'running' ? '● Running…' : '▶ Run';

    const videoWrap = el.querySelector('[data-role="video-wrap"]');
    const wantSrc = `recordings/${key}.webm?t=${c.finishedAt || 0}`;
    const existingVideo = videoWrap.querySelector('video');
    if (c.hasRecording && (!existingVideo || !existingVideo.src.endsWith(wantSrc))) {
      videoWrap.innerHTML = `<div class="video-frame"><video controls src="${wantSrc}"></video></div>`;
    } else if (!c.hasRecording && !videoWrap.querySelector('.novideo')) {
      videoWrap.innerHTML = '<div class="novideo">No recording yet — run it once.</div>';
    }

    const logEl = el.querySelector('[data-role="log"]');
    if (c.status === 'running' || c.status === 'failed') {
      logEl.classList.add('show');
      logEl.textContent = c.log.slice(-4000);
      logEl.scrollTop = logEl.scrollHeight;
    } else if (c.status === 'passed') {
      logEl.classList.remove('show');
    }
  }
}

poll();
pollTimer = setInterval(poll, 1500);
