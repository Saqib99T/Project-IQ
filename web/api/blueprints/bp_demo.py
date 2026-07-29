"""
Live demo run-trigger — POST /demo/api/run spawns a real Playwright run
against this same app, so the public /demo dashboard can offer live re-runs
without shipping the Node authoring server (server.js) used locally to build
these recordings. server.js has no auth at all, which is fine on localhost
but would be unauthenticated remote code execution (arbitrary subprocess
spawn) if reachable by any visitor on a public box — so this endpoint exists
instead, gated by a shared secret, with its own bounded case list.

GET /demo/api/cases stays open (no secret) — it only reports status/log text,
nothing that spawns a process.
"""
import os
import re
import shutil
import subprocess
import threading
import time
import logging
from pathlib import Path

from flask import Blueprint, request, jsonify
import web.api.shared as _s

logger = logging.getLogger(__name__)

bp = Blueprint('demo_api', __name__)

CASES = {
    'act1': {'spec': 'tests/act1-tenant-user.spec.js', 'title': 'Act 1 · Tenant User', 'desc': 'Chat widget — KB question, ticket creation, human handoff.'},
    'act2': {'spec': 'tests/act2-tenant-operator.spec.js', 'title': 'Act 2 · Tenant Operator', 'desc': 'Claims the live chat, resolves it, works the same ticket at agent tier.'},
    'act3': {'spec': 'tests/act3-tenant-admin.spec.js', 'title': 'Act 3 · Tenant Admin', 'desc': 'Portal + ITSM admin, integrations, the RCA lifecycle — the centerpiece.'},
    'act4': {'spec': 'tests/act4-super-admin.spec.js', 'title': 'Act 4 · Super Admin', 'desc': 'Cross-tenant Organizations, the tenant switcher, platform routing rules.'},
    'sla': {'spec': 'tests/flow-sla-slo-reliability.spec.js', 'title': 'Flow · SLA / OLA / UC + SLI/SLO Reliability', 'desc': 'Agreements, targets, rules, coverage, at-risk board, ticket SLA panel, error budgets.'},
    'rca': {'spec': 'tests/flow-rca-governance.spec.js', 'title': 'Flow · RCA Governance', 'desc': 'Policy builder, a completed RCA (evidence + actions), recording-blocked RCAs.'},
}

_state = {k: {'status': 'idle', 'startedAt': None, 'finishedAt': None, 'exitCode': None, 'log': ''} for k in CASES}
_lock = threading.Lock()

# Node 18 (the box's system default, used by unrelated already-running
# services) can't run Playwright 1.62 (requires >=20) — an isolated Node 20
# lives here instead, installed just for this. Never touches system node/npm.
_NODE20_BIN = os.path.expanduser('~/tools/node-v20.18.1-linux-x64/bin')


def _demo_dir():
    return os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(_s.STATIC_DIR))), 'scripts', 'demo-automation')


def _has_recording(key):
    return os.path.isfile(os.path.join(_demo_dir(), 'recordings', f'{key}.webm'))


@bp.route('/demo/api/cases')
def demo_cases():
    out = {}
    for k, c in CASES.items():
        with _lock:
            s = dict(_state[k])
        s['hasRecording'] = _has_recording(k)
        out[k] = {**c, **s}
    return jsonify(out)


def _run_case_bg(key):
    demo_dir = _demo_dir()
    spec = CASES[key]['spec']
    env = {**os.environ, 'PATH': f"{_NODE20_BIN}:{os.environ.get('PATH', '')}"}
    # This host's own network can't reach the external IAM login domain
    # directly (see the reverse-tunnel note in playwright.config.js) — a
    # login-driven run needs the proxy to succeed.
    env['DEMO_USE_PROXY'] = '1'

    with _lock:
        _state[key] = {'status': 'running', 'startedAt': int(time.time() * 1000), 'finishedAt': None, 'exitCode': None, 'log': ''}

    try:
        proc = subprocess.Popen(
            [f'{_NODE20_BIN}/npx', 'playwright', 'test', spec, '--workers=1'],
            cwd=demo_dir, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        chunks = []
        for line in proc.stdout:
            chunks.append(line)
            with _lock:
                _state[key]['log'] = ''.join(chunks)[-20000:]
        code = proc.wait()
    except Exception as e:
        logger.error(f"[demo] run failed to launch: {e}")
        with _lock:
            _state[key]['status'] = 'failed'
            _state[key]['log'] += f"\n[server] failed to launch: {e}\n"
            _state[key]['finishedAt'] = int(time.time() * 1000)
        return

    # Copy the resulting video into recordings/<key>.webm, same convention as
    # server.js, then drop the temp per-run folder.
    videos_dir = Path(demo_dir) / 'videos'
    try:
        if videos_dir.is_dir():
            for d in videos_dir.iterdir():
                video = d / 'video.webm'
                if video.is_file():
                    shutil.copyfile(video, Path(demo_dir) / 'recordings' / f'{key}.webm')
            shutil.rmtree(videos_dir, ignore_errors=True)
    except Exception as e:
        logger.warning(f"[demo] video copy failed: {e}")

    with _lock:
        _state[key]['exitCode'] = code
        _state[key]['finishedAt'] = int(time.time() * 1000)
        _state[key]['status'] = 'passed' if code == 0 else 'failed'


@bp.route('/demo/api/run', methods=['POST'])
def demo_run():
    secret = os.environ.get('DEMO_RUN_SECRET')
    if not secret:
        return jsonify({'error': 'run-trigger not configured on this server'}), 503
    if request.headers.get('X-Demo-Secret') != secret:
        return jsonify({'error': 'unauthorized'}), 401

    body = request.get_json(silent=True) or {}
    key = body.get('key')
    if key not in CASES:
        return jsonify({'error': 'unknown case'}), 400
    with _lock:
        if _state[key]['status'] == 'running':
            return jsonify({'ok': True}), 202
    threading.Thread(target=_run_case_bg, args=(key,), daemon=True).start()
    return jsonify({'ok': True}), 202
