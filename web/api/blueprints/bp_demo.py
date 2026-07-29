"""
Live demo run-trigger — POST /demo/api/run spawns a real Playwright run
against this same app, mirroring server.js's local dashboard (port 4600) but
reachable at the same /demo URL the static recordings are served from.

Gated to loopback requests only (remote_addr == 127.0.0.1/::1): a real
visitor hitting this app over the public IP always shows their own address
here, never loopback, so this can never accidentally spawn processes for a
public prod visitor — no secret/config needed to get that right in both
places. GET /demo/api/cases stays open everywhere (read-only status/log).
"""
import os
import shutil
import subprocess
import time
import logging
from pathlib import Path

import eventlet
from eventlet import tpool
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

LIVE_BASE_URL = 'http://198.233.100.77:8181'

_state = {k: {'status': 'idle', 'startedAt': None, 'finishedAt': None, 'exitCode': None, 'log': '', 'target': 'local'} for k in CASES}
# web_api.py calls eventlet.monkey_patch() at import time, which replaces
# threading.Lock with a greenthread-aware one. That's fine on its own, but
# _run_case_bg below runs inside tpool.execute() — a REAL OS thread outside
# the greenthread hub — and mixing a green lock across that boundary isn't
# something to rely on. eventlet.patcher.original() returns the genuine
# stdlib threading module, so this Lock behaves correctly from both sides.
_lock = eventlet.patcher.original('threading').Lock()


def _demo_dir():
    return os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(_s.STATIC_DIR))), 'scripts', 'demo-automation')


def _has_recording(key):
    return os.path.isfile(os.path.join(_demo_dir(), 'recordings', f'{key}.webm'))


def _is_loopback():
    return request.remote_addr in ('127.0.0.1', '::1')


@bp.route('/demo/api/cases')
def demo_cases():
    out = {}
    for k, c in CASES.items():
        with _lock:
            s = dict(_state[k])
        s['hasRecording'] = _has_recording(k)
        out[k] = {**c, **s}
    return jsonify(out)


def _run_case_bg(key, headed, slow_mo, target):
    demo_dir = _demo_dir()
    spec = CASES[key]['spec']
    env = dict(os.environ)
    if slow_mo:
        env['SLOWMO'] = str(slow_mo)
    if target == 'live':
        # The browser still runs right here — only the URL it drives changes.
        # No remote tunnel, no remote Node-version mismatch; Keycloak's
        # registered redirect_uri allows this origin too, so login behaves
        # identically to the local target.
        env['DEMO_BASE_URL'] = LIVE_BASE_URL

    with _lock:
        _state[key] = {'status': 'running', 'startedAt': int(time.time() * 1000), 'finishedAt': None, 'exitCode': None, 'log': '', 'target': target}

    args = ['npx', 'playwright', 'test', spec, '--workers=1']
    if headed:
        args.append('--headed')

    try:
        proc = subprocess.Popen(
            args, cwd=demo_dir, env=env, shell=os.name == 'nt',
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

    # Copy the resulting video into recordings/<key>.webm (same convention as
    # server.js), then drop the temp per-run folder.
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
    if not _is_loopback():
        return jsonify({'error': 'live re-runs are local-only'}), 403

    body = request.get_json(silent=True) or {}
    key = body.get('key')
    if key not in CASES:
        return jsonify({'error': 'unknown case'}), 400
    headed = bool(body.get('headed'))
    slow_mo = int(body.get('slowMo') or 0)
    target = body.get('target') or 'local'
    if target not in ('local', 'live'):
        return jsonify({'error': 'target must be "local" or "live"'}), 400
    with _lock:
        if _state[key]['status'] == 'running':
            return jsonify({'ok': True}), 202
    # Spawning the test + reading its output is genuinely blocking work (a
    # real OS pipe read). eventlet.monkey_patch() doesn't make that safe to
    # run directly on a greenthread — it would stall the whole server's
    # request loop for the run's entire duration (this is exactly what broke
    # earlier: every other page load, including the test's own navigation to
    # this same server, hung until the run finished). tpool.execute() hands
    # it to a real worker thread instead; eventlet.spawn() just fires that
    # off without the request handler waiting for it to finish.
    eventlet.spawn(tpool.execute, _run_case_bg, key, headed, slow_mo, target)
    return jsonify({'ok': True}), 202
