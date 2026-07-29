// Shared client logic for every dashboard page. Each HTML page sets
// `window.__DEMO_PAGE__ = { keys: [...] }` (keys = which cases to show, or
// omit/null for "all") before loading this script.

const { keys: WANTED_KEYS = null } = window.__DEMO_PAGE__ || {};
const grid = document.getElementById('grid');
let cards = {};

function fmtBadge(status) {
  const map = { idle: 'Idle', running: 'Running', passed: 'Passed', failed: 'Failed' };
  const spin = status === 'running' ? '<span class="spinner"></span>' : '';
  return `<span class="badge ${status}">${spin}${map[status] || status}</span>`;
}

function buildCard(key, c) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <h2>${c.title} <span data-role="badge">${fmtBadge(c.status)}</span></h2>
    <p class="desc">${c.desc}</p>
    <div data-role="video-wrap">${c.hasRecording ? `<div class="video-frame"><video controls src="/recordings/${key}.webm?t=${c.finishedAt || 0}"></video></div>` : '<div class="novideo">No recording yet — run it once.</div>'}</div>
    <div class="row">
      <button class="run" data-role="runbtn">▶ Run</button>
      <label><input type="checkbox" data-role="headed"> Headed (visible browser)</label>
      <label>SlowMo <input type="number" data-role="slowmo" value="250" min="0" step="50"> ms</label>
    </div>
    <pre class="log" data-role="log"></pre>
  `;
  el.querySelector('[data-role="runbtn"]').addEventListener('click', () => triggerRun(key, el));
  grid.appendChild(el);
  return el;
}

async function triggerRun(key, el) {
  const headed = el.querySelector('[data-role="headed"]').checked;
  const slowMo = Number(el.querySelector('[data-role="slowmo"]').value) || 0;
  await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, headed, slowMo }),
  });
  poll();
}

async function poll() {
  const res = await fetch('/api/cases');
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
    const wantSrc = `/recordings/${key}.webm?t=${c.finishedAt || 0}`;
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
setInterval(poll, 1500);
