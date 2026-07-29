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


def _run_case_bg(key, headed, slow_mo):
    demo_dir = _demo_dir()
    spec = CASES[key]['spec']
    env = dict(os.environ)
    if slow_mo:
        env['SLOWMO'] = str(slow_mo)

    with _lock:
        _state[key] = {'status': 'running', 'startedAt': int(time.time() * 1000), 'finishedAt': None, 'exitCode': None, 'log': ''}

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
    with _lock:
        if _state[key]['status'] == 'running':
            return jsonify({'ok': True}), 202
    threading.Thread(target=_run_case_bg, args=(key, headed, slow_mo), daemon=True).start()
    return jsonify({'ok': True}), 202
