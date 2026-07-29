// Shared client logic for every dashboard page. Each HTML page sets
// `window.__DEMO_PAGE__ = { keys: [...] }` (keys = which cases to show, or
// omit/null for "all") before loading this script.
//
// Two backends can serve this same page: locally, server.js exposes
// GET /api/cases + POST /api/run with no auth at all (fine — only reachable
// from localhost). On prod, the Flask admin app exposes the same two routes
// under /demo/, but POST /demo/api/run requires an X-Demo-Secret header
// (server-configured; unset = the endpoint 503s and this page falls back to
// STATIC_MODE) — anyone could otherwise spawn test runs on a public box.
// All fetches below use *relative* paths so the same file works mounted at
// the site root (local) or under /demo/ (prod). STATIC_CASES + STATIC_MODE
// let this same page degrade to read-only video playback if neither backend
// answers, instead of shipping a second copy of this file.

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
      <label><input type="checkbox" data-role="headed"> Headed (visible browser)</label>
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

function demoSecretHeaders() {
  const secret = localStorage.getItem('demoRunSecret') || '';
  return { 'Content-Type': 'application/json', 'X-Demo-Secret': secret };
}

async function triggerRun(key, el) {
  const headed = el.querySelector('[data-role="headed"]').checked;
  const slowMo = Number(el.querySelector('[data-role="slowmo"]').value) || 0;
  const body = JSON.stringify({ key, headed, slowMo });

  let res = await fetch('api/run', { method: 'POST', headers: demoSecretHeaders(), body });
  if (res.status === 401) {
    // Locally this never happens (server.js doesn't check the header at
    // all); on prod it means no/wrong passphrase is stored yet — ask once.
    const secret = prompt('Enter the demo run passphrase:');
    if (!secret) return;
    localStorage.setItem('demoRunSecret', secret);
    res = await fetch('api/run', { method: 'POST', headers: demoSecretHeaders(), body });
  }
  if (res.status === 401) {
    localStorage.removeItem('demoRunSecret');
    alert('Incorrect passphrase.');
    return;
  }
  if (res.status === 503) {
    alert('Live re-runs are not enabled on this server.');
    return;
  }
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
    el.querySelector('[data-role="badge"]').innerHTML = fmtBadge(c.status);
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
