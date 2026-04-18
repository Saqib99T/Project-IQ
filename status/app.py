#!/usr/bin/env python3
"""Project-IQ Status Dashboard API — runs on port 9090"""

import subprocess, json, os, re
from datetime import datetime
from flask import Flask, jsonify, send_from_directory

app = Flask(__name__, static_folder=".")

# ── helpers ──────────────────────────────────────────────────────────────────

def run(cmd, timeout=6):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception:
        return ""

def port_listening(port):
    out = run(f"ss -tlnp 2>/dev/null | grep ':{port} '")
    return bool(out)

def curl_status(url):
    code = run(f"curl -s -o /dev/null -w '%{{http_code}}' --max-time 4 {url}")
    return code

# ── checks ───────────────────────────────────────────────────────────────────

def get_services():
    services = []
    for svc in ["project-iq-rasa", "project-iq-actions", "project-iq-admin"]:
        state  = run(f"systemctl is-active {svc} 2>/dev/null")
        mem    = run(f"systemctl status {svc} 2>/dev/null | grep -oP 'Memory: \\K[^\\n]+' | head -1")
        uptime = run(f"systemctl status {svc} 2>/dev/null | grep -oP 'Active:.*?;\\K[^;]+(?= ago)' | head -1")
        services.append({
            "name":   svc.replace("project-iq-", ""),
            "state":  state or "unknown",
            "mem":    mem or "n/a",
            "uptime": uptime.strip() if uptime else "n/a",
            "ok":     state == "active",
        })
    return services

def get_containers():
    raw = run("docker ps -a --format '{{.Names}}\t{{.Status}}' 2>/dev/null | grep -E 'glpi|firecrawl'")
    containers = []
    for line in raw.splitlines():
        if "\t" in line:
            name, status = line.split("\t", 1)
            containers.append({"name": name, "status": status, "ok": status.lower().startswith("up")})
    return containers

def get_ports():
    labels = {5005:"Rasa Core", 5055:"Rasa Actions", 8181:"Admin API",
              5432:"PostgreSQL", 8083:"GLPI", 3002:"Firecrawl"}
    return [{"port": p, "label": labels[p], "ok": port_listening(p)} for p in labels]

def get_health():
    items = []

    # Rasa
    ver = run("curl -s --max-time 4 http://localhost:5005/version 2>/dev/null")
    m = re.search(r'"version":"([^"]+)"', ver)
    items.append({"name":"Rasa", "ok": bool(m), "detail": f"v{m.group(1)}" if m else "no response"})

    # Admin API
    code = curl_status("http://localhost:8181/")
    items.append({"name":"Admin API", "ok": code in ("200","301","302"), "detail": f"HTTP {code or 'timeout'}"})

    # GLPI
    title = run("curl -s --max-time 4 http://localhost:8083/ 2>/dev/null | grep -oP '<title>\\K[^<]+'")
    ok = bool(re.search(r'Authentication|GLPI', title, re.I))
    items.append({"name":"GLPI", "ok": ok, "detail": title or "no response"})

    # PostgreSQL
    db = run("PGPASSWORD=99tech6677 psql -h 127.0.0.1 -U postgres -d Chatbot -t -c \"SELECT COUNT(*) FROM conversations;\" 2>/dev/null")
    ops = run("PGPASSWORD=99tech6677 psql -h 127.0.0.1 -U postgres -d Chatbot -t -c \"SELECT COUNT(*) FROM operators;\" 2>/dev/null")
    ok_pg = bool(db.strip())
    items.append({"name":"PostgreSQL", "ok": ok_pg,
                  "detail": f"{db.strip()} conversations, {ops.strip()} operators" if ok_pg else "cannot connect"})

    return items

def get_resources():
    cpu_idle = run("top -bn1 | grep 'Cpu(s)' | awk '{print $8}' | sed 's/%id,//'")
    try:    cpu_used = round(100 - float(cpu_idle))
    except: cpu_used = None

    mem = run("free -h | grep Mem")
    mem_parts = mem.split()
    mem_pct_raw = run("free | grep Mem | awk '{printf \"%.0f\", $3/$2*100}'")
    try:    mem_pct = int(mem_pct_raw)
    except: mem_pct = 0

    swap = run("free -h | grep Swap")
    swap_parts = swap.split()

    disk_lines = []
    raw_disk = run("df -h 2>/dev/null | awk 'NR==1 || $NF==\"/\" || $NF==\"/home\"'")
    for line in raw_disk.splitlines():
        parts = line.split()
        pct_str = next((p for p in parts if re.match(r'\d+%$', p)), "0%")
        try:    pct = int(pct_str.rstrip("%"))
        except: pct = 0
        disk_lines.append({"raw": line, "pct": pct})

    load = run("cat /proc/loadavg | awk '{print $1, $2, $3}'")
    cpus = run("nproc")

    return {
        "cpu_used":  cpu_used,
        "mem_used":  mem_parts[2] if len(mem_parts) > 2 else "n/a",
        "mem_total": mem_parts[1] if len(mem_parts) > 1 else "n/a",
        "mem_pct":   mem_pct,
        "swap_used":  swap_parts[2] if len(swap_parts) > 2 else "n/a",
        "swap_total": swap_parts[1] if len(swap_parts) > 1 else "n/a",
        "disk":      disk_lines,
        "load":      load,
        "cpus":      cpus,
    }

def get_errors():
    result = []
    for svc in ["project-iq-rasa", "project-iq-actions", "project-iq-admin"]:
        label  = svc.replace("project-iq-", "")
        errors = run(f"journalctl -u {svc} -p err -n 5 --no-pager --output=short 2>/dev/null | grep -v '^--' | tail -5")
        lines  = [l for l in errors.splitlines() if l.strip()]
        result.append({"service": label, "errors": lines})
    return result

def get_model():
    latest = run("ls -t /home/user/project-iq/core/models/*.tar.gz 2>/dev/null | head -1")
    if not latest:
        return {"found": False}
    size  = run(f"du -sh '{latest}' | cut -f1")
    mtime = run(f"stat -c '%y' '{latest}' | cut -d. -f1")
    count = run("ls /home/user/project-iq/core/models/*.tar.gz 2>/dev/null | wc -l")
    return {"found": True, "name": os.path.basename(latest),
            "size": size, "trained": mtime, "count": count}

# ── routes ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/api/status")
def status():
    return jsonify({
        "timestamp":  datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "services":   get_services(),
        "containers": get_containers(),
        "ports":      get_ports(),
        "health":     get_health(),
        "resources":  get_resources(),
        "errors":     get_errors(),
        "model":      get_model(),
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=9090, debug=False)
