// Tiny zero-dependency dashboard server: lists every demo case, plays its
// recorded .webm, and lets you trigger a real re-run from the browser. The
// "run" is real Playwright driving a real (optionally visible) browser on
// this machine — a static page can't execute Node/Playwright itself, so this
// is the minimal server that makes "click a button, watch it run" possible.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, stat, copyFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4600;

const CASES = {
  act1: { spec: 'tests/act1-tenant-user.spec.js', title: 'Act 1 · Tenant User', desc: 'Chat widget — KB question, ticket creation, human handoff.' },
  act2: { spec: 'tests/act2-tenant-operator.spec.js', title: 'Act 2 · Tenant Operator', desc: 'Claims the live chat, resolves it, works the same ticket at agent tier.' },
  act3: { spec: 'tests/act3-tenant-admin.spec.js', title: 'Act 3 · Tenant Admin', desc: 'Portal + ITSM admin, integrations, the RCA lifecycle — the centerpiece.' },
  act4: { spec: 'tests/act4-super-admin.spec.js', title: 'Act 4 · Super Admin', desc: 'Cross-tenant Organizations, the tenant switcher, platform routing rules.' },
  sla: { spec: 'tests/flow-sla-slo-reliability.spec.js', title: 'Flow · SLA / OLA / UC + SLI/SLO Reliability', desc: 'Agreements, targets, rules, coverage, at-risk board, ticket SLA panel, error budgets.' },
  rca: { spec: 'tests/flow-rca-governance.spec.js', title: 'Flow · RCA Governance', desc: 'Policy builder, a completed RCA (evidence + actions), recording-blocked RCAs.' },
};

// in-memory run state — this process's lifetime only, not persisted
const state = {};
for (const key of Object.keys(CASES)) state[key] = { status: 'idle', startedAt: null, finishedAt: null, exitCode: null, log: '' };

function findCaseByRecording(name) {
  return Object.keys(CASES).find((k) => `${k}.webm` === name);
}

async function runCase(key, { headed = false, slowMo = 0 } = {}) {
  const c = CASES[key];
  if (!c) throw new Error('unknown case');
  if (state[key].status === 'running') return; // already going

  state[key] = { status: 'running', startedAt: Date.now(), finishedAt: null, exitCode: null, log: '' };

  const args = ['playwright', 'test', c.spec, '--workers=1'];
  if (headed) args.push('--headed');
  const env = { ...process.env };
  if (slowMo) env.SLOWMO = String(slowMo);

  const child = spawn('npx', args, { cwd: __dirname, shell: true, env });
  child.stdout.on('data', (d) => { state[key].log += d.toString(); });
  child.stderr.on('data', (d) => { state[key].log += d.toString(); });

  child.on('close', async (code) => {
    state[key].exitCode = code;
    state[key].finishedAt = Date.now();
    state[key].status = code === 0 ? 'passed' : 'failed';
    try {
      const videosDir = path.join(__dirname, 'videos');
      const dirs = await readdir(videosDir).catch(() => []);
      for (const d of dirs) {
        const src = path.join(videosDir, d, 'video.webm');
        if (await stat(src).then(() => true).catch(() => false)) {
          const dest = path.join(__dirname, 'recordings', `${key}.webm`);
          await copyFile(src, dest);
          break; // single-spec run — exactly one video dir
        }
      }
      await rm(videosDir, { recursive: true, force: true });
    } catch (e) {
      state[key].log += `\n[dashboard] video copy failed: ${e.message}\n`;
    }
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webm': 'video/webm', '.json': 'application/json' };

async function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const st = await stat(filePath).catch(() => null);
  if (!st) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size });
  const data = await readFile(filePath);
  res.end(data);
}

async function serveVideoWithRange(req, res, filePath) {
  const st = await stat(filePath).catch(() => null);
  if (!st) { res.writeHead(404); res.end('not found'); return; }
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    res.end(await readFile(filePath));
    return;
  }
  const [, startStr, endStr] = /bytes=(\d*)-(\d*)/.exec(range) || [];
  const start = startStr ? parseInt(startStr, 10) : 0;
  const end = endStr ? parseInt(endStr, 10) : st.size - 1;
  const buf = await readFile(filePath);
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${st.size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Type': 'video/webm',
  });
  res.end(buf.subarray(start, end + 1));
}

// any of these can be requested directly by name — kept to an allow-list
// rather than serving the whole directory tree
const STATIC_FILES = ['dashboard.html', 'dashboard.css', 'dashboard.js', 'features.html', 'sla.html', 'rca.html'];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/') {
    return serveFile(res, path.join(__dirname, 'dashboard.html'));
  }
  const staticName = url.pathname.replace(/^\//, '');
  if (STATIC_FILES.includes(staticName)) {
    return serveFile(res, path.join(__dirname, staticName));
  }

  if (url.pathname === '/api/cases' && req.method === 'GET') {
    const payload = Object.fromEntries(Object.keys(CASES).map((k) => [k, {
      ...CASES[k],
      ...state[k],
      hasRecording: false,
    }]));
    for (const k of Object.keys(payload)) {
      payload[k].hasRecording = await stat(path.join(__dirname, 'recordings', `${k}.webm`)).then(() => true).catch(() => false);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(payload));
  }

  if (url.pathname === '/api/run' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const { key, headed, slowMo } = JSON.parse(body || '{}');
      if (!CASES[key]) { res.writeHead(400); return res.end('unknown case'); }
      runCase(key, { headed: !!headed, slowMo: Number(slowMo) || 0 }).catch((e) => {
        state[key].status = 'failed';
        state[key].log += `\n[dashboard] failed to start: ${e.message}\n`;
      });
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  if (url.pathname.startsWith('/recordings/')) {
    const file = path.basename(url.pathname);
    return serveVideoWithRange(req, res, path.join(__dirname, 'recordings', file));
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`Demo dashboard: http://localhost:${PORT}`);
});
