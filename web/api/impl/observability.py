"""
Observability and system-health implementations.
Routes served via bp_admin_ops.py: /api/status, /admin/observability/*,
/admin/health/<service>, /observability/*
"""
import eventlet
import eventlet.tpool
import os
import json
from datetime import datetime
from flask import request, jsonify
from common.conversation_db import _get_connection, _release_connection

def system_status():
    """System status dashboard — Python-native checks, safe under eventlet."""
    import socket, re, os, glob, urllib.request, urllib.error
    from datetime import datetime

    def _tpool(fn, *args, **kwargs):
        """Run a blocking call in a real thread (safe under eventlet monkey-patch)."""
        try:
            return eventlet.tpool.execute(fn, *args, **kwargs)
        except Exception:
            return None

    def _shell(cmd, timeout=5):
        """Run a shell command in a real thread to avoid eventlet blocking."""
        import subprocess
        def _run():
            try:
                r = subprocess.run(cmd, shell=True, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, timeout=timeout)
                return r.stdout.decode('utf-8', errors='replace').strip()
            except Exception:
                return ''
        return _tpool(_run) or ''

    # ── Ports — read /proc/net/tcp[6] directly (no subprocess, no socket) ──
    _listening_ports = set()
    try:
        for path in ('/proc/net/tcp', '/proc/net/tcp6'):
            try:
                with open(path) as f:
                    for line in f.readlines()[1:]:
                        parts = line.split()
                        if len(parts) >= 4 and parts[3] == '0A':  # 0A = LISTEN
                            local_addr = parts[1]
                            port_hex = local_addr.split(':')[1]
                            _listening_ports.add(int(port_hex, 16))
            except Exception:
                pass
    except Exception:
        pass

    def port_listening(port):
        return port in _listening_ports

    # ── Services (systemctl) ──────────────────────────────────────────────
    # Service check: read systemd private state files (works in any user context)
    def _svc_info(svc):
        """Check service state by reading /run/systemd and /proc directly."""
        # Try reading the MainPID from systemd's runtime state
        pid = None
        state = 'unknown'
        mem_str = 'n/a'
        uptime = 'n/a'
        try:
            # /run/systemd/units/ has per-unit state
            unit_state_path = f'/run/systemd/units/{svc}.service'
            if os.path.exists(unit_state_path):
                with open(unit_state_path) as f:
                    for line in f:
                        if line.startswith('MAINPID='):
                            pid = int(line.strip().split('=')[1])
                        if line.startswith('ACTIVE='):
                            state = line.strip().split('=')[1]
        except Exception:
            pass

        # Fallback: search /proc for the process name
        if state == 'unknown' or pid is None:
            try:
                keyword_map = {
                    'project-iq-rasa':    'rasa run',
                    'project-iq-actions': 'rasa run actions',
                    'project-iq-admin':   'web.api.web_api',
                }
                keyword = keyword_map.get(svc, svc)
                for entry in os.listdir('/proc'):
                    if not entry.isdigit():
                        continue
                    try:
                        with open(f'/proc/{entry}/cmdline', 'rb') as f:
                            cmd = f.read().replace(b'\x00', b' ').decode('utf-8', errors='replace')
                        if keyword in cmd:
                            pid = int(entry)
                            state = 'active'
                            break
                    except Exception:
                        pass
                if state == 'unknown':
                    state = 'inactive'
            except Exception:
                pass

        # Memory from /proc/<pid>/status
        if pid:
            try:
                with open(f'/proc/{pid}/status') as f:
                    for line in f:
                        if line.startswith('VmRSS:'):
                            kb = int(line.split()[1])
                            mem_str = f'{kb//1024}M' if kb < 1024*1024 else f'{kb//1024//1024}G'
                            break
            except Exception:
                pass
            # Start time from /proc/<pid>/stat
            try:
                with open('/proc/stat') as f:
                    for line in f:
                        if line.startswith('btime'):
                            boot_time = int(line.split()[1])
                            break
                with open(f'/proc/{pid}/stat') as f:
                    fields = f.read().split()
                    import time as _time
                    starttime_ticks = int(fields[21])
                    hz = os.sysconf('SC_CLK_TCK')
                    start_epoch = boot_time + starttime_ticks / hz
                    elapsed = int(_time.time() - start_epoch)
                    if elapsed < 60:   uptime = f'{elapsed}s'
                    elif elapsed < 3600: uptime = f'{elapsed//60}m {elapsed%60}s'
                    else: uptime = f'{elapsed//3600}h {(elapsed%3600)//60}m'
            except Exception:
                pass

        return state, mem_str, uptime

    services = []
    for svc in ['project-iq-rasa', 'project-iq-actions', 'project-iq-admin']:
        state, mem_str, uptime = _svc_info(svc)
        services.append({'name':   svc.replace('project-iq-', ''),
                         'state':  state,
                         'mem':    mem_str,
                         'uptime': uptime,
                         'ok':     state == 'active'})

    # ── Docker containers ─────────────────────────────────────────────────
    raw = _shell('docker ps -a --format "{{.Names}}\t{{.Status}}" 2>/dev/null | grep -E "itsm|firecrawl"')
    containers = []
    for line in raw.splitlines():
        if '\t' in line:
            name, status = line.split('\t', 1)
            containers.append({'name': name, 'status': status,
                                'ok': status.lower().startswith('up')})

    # ── Ports ─────────────────────────────────────────────────────────────
    port_labels = {5005: 'ML Platform Core', 5055: 'ML Platform Actions', 8181: 'Admin API',
                   5432: 'PostgreSQL', 8000: 'ITSM', 3002: 'Firecrawl'}
    ports = [{'port': p, 'label': port_labels[p], 'ok': port_listening(p)}
             for p in port_labels]

    # ── App health — raw TCP socket HTTP (safe under eventlet tpool) ────────
    import socket as _sock
    def _http_raw(host, port, path='/', timeout=4):
        """Minimal HTTP GET via raw socket in a real thread."""
        def _req():
            try:
                s = _sock.socket(_sock.AF_INET, _sock.SOCK_STREAM)
                s.settimeout(timeout)
                s.connect((host, port))
                req = f'GET {path} HTTP/1.0\r\nHost: {host}\r\nConnection: close\r\n\r\n'
                s.sendall(req.encode())
                data = b''
                while True:
                    chunk = s.recv(4096)
                    if not chunk:
                        break
                    data += chunk
                    if len(data) > 32768:
                        break
                s.close()
                text = data.decode('utf-8', errors='replace')
                status_match = re.match(r'HTTP/\S+ (\d+)', text)
                code = int(status_match.group(1)) if status_match else None
                return code, text
            except Exception:
                return None, ''
        return _tpool(_req) or (None, '')

    health = []

    # ML Platform
    rasa_code, rasa_body = _http_raw('127.0.0.1', 5005, '/version')
    m = re.search(r'"version":"([^"]+)"', rasa_body)
    health.append({'name': 'ML Platform', 'ok': bool(m),
                   'detail': f'v{m.group(1)}' if m else 'no response'})

    # Admin API (self — check port directly, skip HTTP to avoid self-loop)
    admin_up = 8181 in _listening_ports
    health.append({'name': 'Admin API', 'ok': admin_up,
                   'detail': 'listening' if admin_up else 'not listening'})

    # ITSM service (itsm-service FastAPI on :8000)
    itsm_code, itsm_body = _http_raw('127.0.0.1', 8000, '/api/v1/health')
    itsm_ok = (itsm_code == 200) or bool(re.search(r'"status"\s*:\s*"ok"', itsm_body, re.I))
    mv = re.search(r'"version"\s*:\s*"([^"]+)"', itsm_body)
    health.append({'name': 'ITSM', 'ok': itsm_ok,
                   'detail': (f'v{mv.group(1)}' if mv else ('up' if itsm_ok else 'no response'))})

    # PostgreSQL (use existing DB connection)
    pg_ok, pg_detail = False, 'cannot connect'
    try:
        from common.conversation_db import _get_connection, _release_connection
        conn = _get_connection()
        try:
            cur = conn.cursor()
            cur.execute('SELECT COUNT(*) FROM conversations')
            conv_count = cur.fetchone()[0]
            cur.execute('SELECT COUNT(*) FROM operators')
            ops_count = cur.fetchone()[0]
            cur.close()
        finally:
            conn.rollback()
            _release_connection(conn)
        pg_ok, pg_detail = True, f'{conv_count} conversations, {ops_count} operators'
    except Exception as e:
        pg_detail = str(e)[:80]
    health.append({'name': 'PostgreSQL', 'ok': pg_ok, 'detail': pg_detail})

    # ── System resources (read /proc directly) ────────────────────────────
    resources = {'cpu_used': None, 'mem_used': 'n/a', 'mem_total': 'n/a',
                 'mem_pct': 0, 'swap_used': 'n/a', 'swap_total': 'n/a',
                 'disk': [], 'load': 'n/a', 'cpus': 'n/a'}
    try:
        # Load average
        with open('/proc/loadavg') as f:
            la = f.read().split()
            resources['load'] = f'{la[0]} {la[1]} {la[2]}'

        # CPU count
        resources['cpus'] = str(os.cpu_count() or 'n/a')

        # CPU usage — two /proc/stat samples 0.3s apart (inside tpool real thread)
        def _cpu_pct():
            import time as _time
            def _read_stat():
                with open('/proc/stat') as f:
                    l = f.readline().split()
                vals = list(map(int, l[1:8]))   # user nice sys idle iowait irq softirq
                idle  = vals[3] + vals[4]        # idle + iowait
                total = sum(vals)
                return idle, total
            try:
                i1, t1 = _read_stat()
                _time.sleep(0.3)
                i2, t2 = _read_stat()
                dt = t2 - t1
                di = i2 - i1
                return round((1 - di / dt) * 100) if dt else 0
            except Exception:
                return 0
        resources['cpu_used'] = _tpool(_cpu_pct) or 0

        # Memory from /proc/meminfo
        meminfo = {}
        with open('/proc/meminfo') as f:
            for line in f:
                k, v = line.split(':', 1)
                meminfo[k.strip()] = int(v.strip().split()[0])  # kB
        mem_total_kb  = meminfo.get('MemTotal', 0)
        mem_avail_kb  = meminfo.get('MemAvailable', 0)
        mem_used_kb   = mem_total_kb - mem_avail_kb
        swap_total_kb = meminfo.get('SwapTotal', 0)
        swap_free_kb  = meminfo.get('SwapFree', 0)
        swap_used_kb  = swap_total_kb - swap_free_kb

        def _fmt(kb):
            if kb >= 1024**2: return f'{kb/1024**2:.1f}G'
            if kb >= 1024:    return f'{kb/1024:.0f}M'
            return f'{kb}K'

        resources['mem_total'] = _fmt(mem_total_kb)
        resources['mem_used']  = _fmt(mem_used_kb)
        resources['mem_pct']   = round(mem_used_kb / mem_total_kb * 100) if mem_total_kb else 0
        resources['swap_total'] = _fmt(swap_total_kb)
        resources['swap_used']  = _fmt(swap_used_kb)

        # Disk usage via os.statvfs for / and /home
        disk_lines = []
        seen = set()
        for path in ['/', '/home']:
            try:
                st = os.statvfs(path)
                total = st.f_blocks * st.f_frsize
                free  = st.f_bfree  * st.f_frsize
                used  = total - free
                pct   = round(used / total * 100) if total else 0
                key   = (st.f_fsid if hasattr(st, 'f_fsid') else path)
                if key not in seen:
                    seen.add(key)
                    def _fmt_b(b):
                        if b >= 1024**3: return f'{b/1024**3:.1f}G'
                        if b >= 1024**2: return f'{b/1024**2:.0f}M'
                        return f'{b//1024}K'
                    raw_str = f'disk  {_fmt_b(total)}  {_fmt_b(used)}  {_fmt_b(free)}  {pct}%  {path}'
                    disk_lines.append({'raw': raw_str, 'pct': pct})
            except Exception:
                pass
        # prepend header row for the JS table renderer
        resources['disk'] = [{'raw': 'Filesystem  Size  Used  Avail  Use%  Mount', 'pct': 0}] + disk_lines

    except Exception:
        pass

    # ── Recent errors (journalctl) ────────────────────────────────────────
    errors = []
    for svc in ['project-iq-rasa', 'project-iq-actions', 'project-iq-admin']:
        label = svc.replace('project-iq-', '')
        raw_e = _shell(f'journalctl -u {svc} -p err -n 5 --no-pager --output=short 2>/dev/null | grep -v "^--" | tail -5')
        errors.append({'service': label,
                       'errors': [l for l in raw_e.splitlines() if l.strip()]})

    # ── Rasa model ────────────────────────────────────────────────────────
    model_dir = '/home/user/project-iq/core/models'
    model_files = sorted(glob.glob(f'{model_dir}/*.tar.gz'), key=os.path.getmtime, reverse=True)
    if model_files:
        f = model_files[0]
        try:    size_bytes = os.path.getsize(f)
        except: size_bytes = 0
        def _fmt_size(b):
            if b >= 1024**3: return f'{b/1024**3:.1f}G'
            if b >= 1024**2: return f'{b/1024**2:.0f}M'
            return f'{b//1024}K'
        try:    mtime = datetime.fromtimestamp(os.path.getmtime(f)).strftime('%Y-%m-%d %H:%M:%S')
        except: mtime = 'unknown'
        model = {'found': True, 'name': os.path.basename(f),
                 'size': _fmt_size(size_bytes), 'trained': mtime,
                 'count': str(len(model_files))}
    else:
        model = {'found': False}

    return jsonify({
        'timestamp':  datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'services':   services,
        'containers': containers,
        'ports':      ports,
        'health':     health,
        'resources':  resources,
        'errors':     errors,
        'model':      model,
    })




def get_system_metrics():
    """Get system metrics using psutil for real data."""
    conn = None
    try:
        import psutil
        import os
        import platform
        from common.conversation_db import _get_connection, _release_connection

        # Get real system metrics
        cpu_percent = psutil.cpu_percent(interval=0.1)
        cpu_count = psutil.cpu_count()

        memory = psutil.virtual_memory()
        memory_percent = memory.percent
        memory_used = memory.used
        memory_total = memory.total

        # Get disk usage - handle Windows vs Unix paths
        if platform.system() == 'Windows':
            # Use the drive where the script is running (typically C:)
            disk_path = os.path.splitdrive(os.getcwd())[0] + '\\'
        else:
            disk_path = '/'

        disk = psutil.disk_usage(disk_path)
        disk_percent = disk.percent
        disk_used = disk.used
        disk_total = disk.total

        # Get per-service metrics
        services = {}
        current_pid = os.getpid()

        # Helper function to find process by name or port
        def find_process_metrics(name_patterns, port=None):
            """Find a process and return its CPU and memory usage."""
            matched_processes = []
            try:
                for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
                    try:
                        proc_info = proc.info
                        proc_name = proc_info.get('name', '').lower()
                        cmdline = ' '.join(proc_info.get('cmdline', [])).lower() if proc_info.get('cmdline') else ''

                        # Check if process matches any pattern
                        for pattern in name_patterns:
                            pattern_lower = pattern.lower()
                            if pattern_lower in proc_name or pattern_lower in cmdline:
                                matched_processes.append(proc)
                                break  # Found match, move to next process
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        continue

                # If we found matching processes, aggregate their metrics
                if matched_processes:
                    total_cpu = 0.0
                    total_mem = 0.0
                    count = 0

                    for proc in matched_processes:
                        try:
                            cpu = proc.cpu_percent(interval=0.5)  # Blocking — accurate reading
                            mem = proc.memory_percent()
                            total_cpu += cpu
                            total_mem += mem
                            count += 1
                        except (psutil.NoSuchProcess, psutil.AccessDenied):
                            continue

                    if count > 0:
                        return {
                            'cpu': round(total_cpu, 1),
                            'memory': round(total_mem, 1),
                            'pid': matched_processes[0].pid,
                            'count': count
                        }
            except Exception as e:
                print(f"Error finding process {name_patterns}: {e}")
            return {'cpu': 0.0, 'memory': 0.0, 'pid': None, 'count': 0}

        # Get metrics for each service
        # Look for rasa.exe or python running rasa
        services['rasa'] = find_process_metrics(['rasa.exe', 'rasa run'])
        # Look for rasa_sdk (actions server) - check for python process running rasa_sdk
        services['actions'] = find_process_metrics(['rasa_sdk', 'rasa-sdk', 'rasa_sdk.cli', 'actions.py'])
        # Look for postgres
        services['database'] = find_process_metrics(['postgres.exe', 'postgres', 'postgresql'])

        # Admin API is the current process
        try:
            current_proc = psutil.Process(current_pid)
            services['admin'] = {
                'cpu': round(current_proc.cpu_percent(interval=0.5), 1),
                'memory': round(current_proc.memory_percent(), 1),
                'pid': current_pid
            }
        except Exception as e:
            print(f"Error getting current process metrics: {e}")
            services['admin'] = {'cpu': 0.0, 'memory': 0.0, 'pid': current_pid}

        # Get real performance metrics from database
        try:
            conn = _get_connection()
            cursor = conn.cursor()

            # Response time: avg ms between each user msg and the NEAREST following bot msg
            # Try last 7 days first, fall back to all-time if no data
            cursor.execute('''
                WITH bot_responses AS (
                    SELECT
                        bot.id,
                        bot.conversation_id,
                        bot.timestamp AS bot_ts,
                        (
                            SELECT MAX(u.timestamp)
                            FROM messages u
                            WHERE u.conversation_id = bot.conversation_id
                              AND u.sender = 'user'
                              AND u.timestamp < bot.timestamp
                        ) AS prev_user_ts
                    FROM messages bot
                    WHERE bot.sender = 'bot'
                      AND bot.timestamp > NOW() - INTERVAL '7 days'
                )
                SELECT AVG(EXTRACT(EPOCH FROM (bot_ts - prev_user_ts)) * 1000)
                FROM bot_responses
                WHERE prev_user_ts IS NOT NULL
            ''')
            result = cursor.fetchone()
            avg_response_time = round(result[0]) if result and result[0] else 0

            # If still 0 (no data in last 7 days), try all-time
            if avg_response_time == 0:
                cursor.execute('''
                    WITH bot_responses AS (
                        SELECT
                            bot.timestamp AS bot_ts,
                            (
                                SELECT MAX(u.timestamp)
                                FROM messages u
                                WHERE u.conversation_id = bot.conversation_id
                                  AND u.sender = 'user'
                                  AND u.timestamp < bot.timestamp
                            ) AS prev_user_ts
                        FROM messages bot
                        WHERE bot.sender = 'bot'
                    )
                    SELECT AVG(EXTRACT(EPOCH FROM (bot_ts - prev_user_ts)) * 1000)
                    FROM bot_responses
                    WHERE prev_user_ts IS NOT NULL
                ''')
                result = cursor.fetchone()
                avg_response_time = round(result[0]) if result and result[0] else 0

            # Throughput: messages per minute averaged over last 24 hours
            # Falls back to all-time average if no recent data
            cursor.execute('''
                SELECT COUNT(*) FROM messages
                WHERE timestamp > NOW() - INTERVAL '24 hours'
            ''')
            daily_messages = cursor.fetchone()[0] or 0
            throughput = round(daily_messages / 1440.0, 2)  # per minute over 24h

            if throughput == 0:
                # All-time fallback: total messages / total elapsed minutes
                cursor.execute('''
                    SELECT COUNT(*),
                           EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 60.0
                    FROM messages
                ''')
                row = cursor.fetchone()
                if row and row[0] and row[1] and row[1] > 0:
                    throughput = round(row[0] / row[1], 2)

            # Error rate: % of bot messages that are fallbacks/errors in last 7 days
            # Falls back to all-time if no recent data
            cursor.execute('''
                SELECT
                    COUNT(*) FILTER (WHERE
                        text ILIKE '%error%' OR
                        text ILIKE '%failed%' OR
                        text ILIKE '%sorry%' OR
                        text ILIKE '%not sure%' OR
                        text ILIKE '%don''t understand%' OR
                        text ILIKE '%couldn''t%' OR
                        text ILIKE '%unable%' OR
                        text ILIKE '%cannot%' OR
                        text ILIKE '%not understand%'
                    ) AS errors,
                    COUNT(*) AS total
                FROM messages
                WHERE sender = 'bot'
                  AND timestamp > NOW() - INTERVAL '7 days'
            ''')
            result = cursor.fetchone()
            if result and result[1] and result[1] > 0:
                error_rate = round((result[0] / result[1]) * 100, 2)
            else:
                # All-time fallback
                cursor.execute('''
                    SELECT
                        COUNT(*) FILTER (WHERE
                            text ILIKE '%error%' OR text ILIKE '%failed%' OR
                            text ILIKE '%sorry%' OR text ILIKE '%not sure%' OR
                            text ILIKE '%don''t understand%' OR text ILIKE '%couldn''t%' OR
                            text ILIKE '%unable%' OR text ILIKE '%cannot%' OR
                            text ILIKE '%not understand%'
                        ) AS errors,
                        COUNT(*) AS total
                    FROM messages
                    WHERE sender = 'bot'
                ''')
                result = cursor.fetchone()
                error_rate = round((result[0] / result[1]) * 100, 2) if result and result[1] else 0

            cursor.close()
        except Exception as e:
            print(f"Error getting performance metrics: {e}")
            avg_response_time = 0
            throughput = 0
            error_rate = 0
        finally:
            if conn:
                conn.rollback()
                _release_connection(conn)
                conn = None

        data = {
            "success": True,
            "data": {
                "cpu_percent": round(cpu_percent, 1),
                "cpu_count": cpu_count,
                "memory_percent": round(memory_percent, 1),
                "memory_used": memory_used,
                "memory_total": memory_total,
                "disk_percent": round(disk_percent, 1),
                "disk_used": disk_used,
                "disk_total": disk_total,
                "avg_response_time": avg_response_time,
                "throughput": throughput,
                "error_rate": error_rate,
                "services": services
            }
        }
        return jsonify(data)
    except Exception as e:
        print(f"Error in get_system_metrics: {e}")
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            try:
                conn.rollback()
                _release_connection(conn)
            except:
                pass



def get_db_stats():
    """Get database statistics."""
    conn = None
    try:
        from common.conversation_db import _get_connection, _release_connection
        conn = _get_connection()
        cursor = conn.cursor()

        # Count rows in key tables
        tables = ['conversations', 'messages', 'feedback', 'users']
        stats = {}

        for table in tables:
            try:
                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                stats[table] = cursor.fetchone()[0]
            except Exception as e:
                conn.rollback()
                stats[table] = 0

        # Recent activity
        try:
            cursor.execute("SELECT COUNT(*) FROM messages WHERE timestamp > NOW() - INTERVAL '1 hour'")
            msgs_hour = cursor.fetchone()[0]
        except:
            conn.rollback()
            msgs_hour = 0

        try:
            cursor.execute("SELECT COUNT(*) FROM conversations WHERE start_time > CURRENT_DATE")
            convs_today = cursor.fetchone()[0]
        except:
            conn.rollback()
            convs_today = 0

        # Get real average response time
        try:
            cursor.execute('''
                SELECT AVG(
                    EXTRACT(EPOCH FROM (
                        bot.timestamp - user_msg.timestamp
                    ))
                ) * 1000 as avg_ms
                FROM messages bot
                JOIN messages user_msg ON bot.conversation_id = user_msg.conversation_id
                    AND bot.timestamp > user_msg.timestamp
                WHERE bot.sender = 'bot'
                    AND user_msg.sender = 'user'
                    AND bot.timestamp > NOW() - INTERVAL '24 hours'
                LIMIT 5000
            ''')
            result = cursor.fetchone()
            avg_response_ms = round(result[0]) if result and result[0] else 0
        except:
            conn.rollback()
            avg_response_ms = 0

        cursor.close()
        return jsonify({
            "success": True,
            "data": {
                "tables": stats,
                "activity": {
                    "messages_last_hour": msgs_hour,
                    "conversations_today": convs_today
                },
                "performance": {
                    "avg_response_ms": avg_response_ms
                }
            }
        })
    except Exception as e:
        print(f"DB Stats Error: {e}")
        if conn:
            conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            conn.rollback()
            _release_connection(conn)



def get_recent_logs():
    """Get recent application logs."""
    try:
        base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        logs = []
        log_files = {
            'rasa': os.path.join(base_path, 'Log', 'core.log'),
            'actions': os.path.join(base_path, 'Log', 'actions.log'),
            'admin': os.path.join(base_path, 'Log', 'admin_new.err')
        }

        for source, path in log_files.items():
            if os.path.exists(path):
                try:
                    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                        # Get last 20 lines
                        all_lines = f.readlines()
                        lines = all_lines[-20:] if len(all_lines) > 20 else all_lines

                        for line in lines:
                            if not line.strip():
                                continue

                            level = 'INFO'
                            if 'ERROR' in line.upper() or 'Exception' in line:
                                level = 'ERROR'
                            elif 'WARNING' in line.upper() or 'WARN' in line.upper():
                                level = 'WARNING'
                            elif 'DEBUG' in line.upper():
                                level = 'DEBUG'

                            logs.append({
                                "timestamp": datetime.now().isoformat(),
                                "level": level,
                                "source": source,
                                "message": line.strip()[:300]
                            })
                except Exception as e:
                    print(f"Error reading log file {path}: {e}")

        return jsonify({
            "success": True,
            "data": logs[-50:]
        })
    except Exception as e:
        print(f"Error in get_recent_logs: {e}")
        return jsonify({"success": False, "error": str(e)}), 500



def service_health(service):
    """Check health of specific service."""
    try:
        import requests
        healthy = True

        if service == 'database':
            from common.conversation_db import _get_connection, _release_connection
            try:
                conn = _get_connection()
                _release_connection(conn)
            except:
                healthy = False
        elif service == 'rasa':
            try:
                response = requests.get(
                    f'{RASA_URL}/status',
                    headers={'Accept': 'application/json'},
                    timeout=3
                )
                healthy = response.status_code == 200
            except:
                healthy = False
        elif service == 'actions':
            try:
                action_health = ACTION_URL.replace('/webhook', '/health')
                response = requests.get(action_health, timeout=3)
                healthy = response.status_code == 200
            except:
                healthy = False

        return jsonify({
            "status": "ok",
            "healthy": healthy,
            "service": service
        })
    except Exception as e:
        return jsonify({"status": "error", "healthy": False, "error": str(e)})

# =============================
# KNOWLEDGE BASE ENDPOINTS
# =============================



def observability_metrics():
    """Get observability metrics."""
    conn = None
    try:
        conn = _get_connection()
        cursor = conn.cursor()
        
        # Get response time stats from last 1000 messages
        cursor.execute('''
            SELECT AVG(EXTRACT(EPOCH FROM (timestamp - LAG(timestamp) OVER (PARTITION BY conversation_id ORDER BY timestamp))))
            FROM messages 
            WHERE sender = 'bot' 
            LIMIT 1000
        ''')
        avg_response = cursor.fetchone()[0] or 0
        
        # Get throughput (messages per minute in last hour)
        cursor.execute('''
            SELECT COUNT(*) 
            FROM messages 
            WHERE timestamp > NOW() - INTERVAL '1 hour'
        ''')
        hourly_messages = cursor.fetchone()[0] or 0
        throughput = round(hourly_messages / 60, 2)
        
        # Get error rate from actions table
        cursor.execute('''
            SELECT 
                COUNT(*) FILTER (WHERE status = 'error') as errors,
                COUNT(*) as total
            FROM actions
            WHERE timestamp > NOW() - INTERVAL '24 hours'
        ''')
        result = cursor.fetchone()
        errors = result[0] if result[0] else 0
        total = result[1] if result[1] else 1
        error_rate = round((errors / total) * 100, 2) if total > 0 else 0
        
        return jsonify({
            "success": True,
            "data": {
                "avg_response_time": round(avg_response * 1000, 0) if avg_response else 100,  # ms
                "throughput": throughput,
                "error_rate": f"{error_rate}%",
                "healthy_services": 3  # TODO: count actual healthy services
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            conn.rollback()
            _release_connection(conn)


# ============================================================================
# INSPECTOR DEBUG APIs - Real-time Debugging
# ============================================================================



def observability_logs():
    """Get recent system logs."""
    try:
        log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'Log')
        logs = []
        
        # Read recent error logs if available
        error_log = os.path.join(log_dir, 'action_server.err')
        if os.path.exists(error_log):
            with open(error_log, 'r') as f:
                lines = f.readlines()
                logs.extend(lines[-20:])  # Last 20 lines
        
        return jsonify({"success": True, "data": logs})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "data": []})


# ============================================================================
# OBSERVABILITY APIs - Real Monitoring
# ============================================================================



def observability_processes():
    """Get detailed status of all Rasa-related processes."""
    try:
        from web.api.process_monitor import get_all_service_processes, get_system_resources, ensure_collector_running
        ensure_collector_running()
        
        processes = get_all_service_processes()
        system = get_system_resources()
        
        return jsonify({
            "success": True,
            "data": {
                "services": processes,
                "system": system
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500




def observability_metrics_history():
    """Get historical metrics for charts."""
    try:
        from web.api.process_monitor import get_metrics_history, ensure_collector_running
        ensure_collector_running()
        
        points = request.args.get('points', 60, type=int)
        history = get_metrics_history(points)
        
        return jsonify({
            "success": True,
            "data": history
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500




def observability_logs_filtered():
    """Get filtered logs from all log files."""
    try:
        from web.api.log_parser import get_all_logs
        
        log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'Log')
        level = request.args.get('level', None)
        max_lines = request.args.get('limit', 100, type=int)
        
        logs = get_all_logs(log_dir, max_lines=max_lines, level_filter=level)
        
        return jsonify({
            "success": True,
            "data": logs
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "data": []})




def observability_logs_search():
    """Search logs for a query string."""
    try:
        from web.api.log_parser import search_logs
        
        log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'Log')
        query = request.args.get('q', '')
        max_results = request.args.get('limit', 50, type=int)
        
        if not query:
            return jsonify({"success": False, "error": "Query parameter 'q' is required"})
        
        results = search_logs(log_dir, query, max_results)
        
        return jsonify({
            "success": True,
            "data": results,
            "query": query
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "data": []})




def observability_logs_stats():
    """Get log file statistics."""
    try:
        from web.api.log_parser import get_log_stats
        
        log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'Log')
        stats = get_log_stats(log_dir)
        
        return jsonify({
            "success": True,
            "data": stats
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})




def observability_database_stats():
    """Get database connection and table statistics."""
    try:
        from common.conversation_db import _get_connection, _release_connection

        conn = _get_connection()
        if not conn:
            return jsonify({
                "success": False,
                "error": "Could not connect to database"
            })

        try:
            cursor = conn.cursor()

            # Get table sizes
            tables = {}
            for table in ['conversations', 'messages', 'feedback', 'actions', 'themes', 'apps']:
                try:
                    cursor.execute(f"SELECT COUNT(*) FROM {table}")
                    tables[table] = cursor.fetchone()[0]
                except:
                    conn.rollback()
                    tables[table] = 0

            # Get recent activity
            cursor.execute("""
                SELECT COUNT(*) FROM messages
                WHERE created_at > NOW() - INTERVAL '1 hour'
            """)
            messages_last_hour = cursor.fetchone()[0]

            cursor.execute("""
                SELECT COUNT(*) FROM conversations
                WHERE created_at > NOW() - INTERVAL '24 hours'
            """)
            conversations_today = cursor.fetchone()[0]

            # Get average response time (from message pairs)
            cursor.execute("""
                WITH user_messages AS (
                    SELECT sender_id, created_at, ROW_NUMBER() OVER (PARTITION BY sender_id ORDER BY created_at) as rn
                    FROM messages WHERE role = 'user'
                ),
                bot_messages AS (
                    SELECT sender_id, created_at, ROW_NUMBER() OVER (PARTITION BY sender_id ORDER BY created_at) as rn
                    FROM messages WHERE role = 'assistant'
                )
                SELECT AVG(EXTRACT(EPOCH FROM (b.created_at - u.created_at)) * 1000)::INT as avg_ms
                FROM user_messages u
                JOIN bot_messages b ON u.sender_id = b.sender_id AND u.rn = b.rn
                WHERE b.created_at > u.created_at
                AND b.created_at - u.created_at < INTERVAL '1 minute'
            """)
            result = cursor.fetchone()
            avg_response_ms = result[0] if result and result[0] else 0

            cursor.close()
        finally:
            conn.rollback()
            _release_connection(conn)

        return jsonify({
            "success": True,
            "data": {
                "tables": tables,
                "total_rows": sum(tables.values()),
                "activity": {
                    "messages_last_hour": messages_last_hour,
                    "conversations_today": conversations_today
                },
                "performance": {
                    "avg_response_ms": avg_response_ms
                }
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


