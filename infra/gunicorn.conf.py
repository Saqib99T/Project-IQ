"""
Gunicorn configuration for Project IQ Admin Server.

Usage (Ubuntu):
    cd /home/user/project-iq
    gunicorn -c infra/gunicorn.conf.py web.api.admin_api:app

Install:
    pip install gunicorn eventlet

Scaling workers:
    - Default: workers=1 (safe — background threads run in one process)
    - To scale: set workers=4 AND ensure redis_enabled=true in app.config.local
      so Socket.IO events are shared across workers via the Redis message bus.
    - Never increase workers without Redis — Socket.IO rooms are in-process only
      and clients on different workers won't receive each other's events.
"""
import multiprocessing
import os

# ── Binding ───────────────────────────────────────────────────────────────────
bind        = f"0.0.0.0:{os.environ.get('ADMIN_PORT', '8181')}"
backlog     = 2048

# ── Worker model ─────────────────────────────────────────────────────────────
# Must use eventlet workers to match async_mode='eventlet' in SocketIO.
worker_class = 'eventlet'

# workers=1: safe default. Primary worker runs all background threads.
# workers=4: set this when Redis is enabled. Each worker handles I/O
#            concurrently; background threads run only in worker 0.
workers = int(os.environ.get('GUNICORN_WORKERS', '1'))

# Eventlet is cooperative — threads are green threads, not OS threads.
# 1000 greenlets per worker is comfortable for I/O-bound workloads.
worker_connections = 1000

# ── Process management ────────────────────────────────────────────────────────
# Restart a worker after it has served this many requests (prevents memory leaks).
max_requests        = 1000
max_requests_jitter = 100   # randomise so workers don't all restart at once

# Kill and restart a worker if it hasn't responded within 120 s.
timeout  = 120
keepalive = 5

# ── Preload ───────────────────────────────────────────────────────────────────
# preload_app=False: each worker imports admin_api.py independently.
# This is required so eventlet.monkey_patch() runs in every worker process.
preload_app = False

# ── Logging ───────────────────────────────────────────────────────────────────
accesslog  = '-'          # stdout
errorlog   = '-'          # stderr
loglevel   = 'info'
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s %(D)sµs'

# ── Hooks — inject worker identity so background threads run only in worker 0 ─
def post_fork(server, worker):
    """
    Called in each worker after fork.
    Sets GUNICORN_WORKER_ID so admin_api.py knows which worker starts
    background threads (only worker_id=0 does).
    worker.age is a monotonic counter; the first worker always gets age=1,
    so we map age-1 → 0-based index.
    """
    worker_id = worker.age - 1
    os.environ['GUNICORN_WORKER_ID'] = str(worker_id)
    server.log.info(f"Worker forked: pid={worker.pid} worker_id={worker_id}")


def worker_exit(server, worker):
    """Log worker exits for observability."""
    server.log.info(f"Worker exited: pid={worker.pid}")


def on_starting(server):
    server.log.info("Project IQ Admin Server starting via Gunicorn")


def on_reload(server):
    """Called on SIGHUP (graceful reload). Useful for zero-downtime deploys."""
    server.log.info("Graceful reload triggered")
