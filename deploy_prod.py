"""Deploy to production server: SFTP upload changed files + systemctl restart."""
import paramiko, os, time

SERVER   = '192.168.71.66'
USER     = 'user'
PASS     = '99tech6677'
LOCAL    = 'd:/99T/Code/Project-IQ-V1'
REMOTE   = '/home/user/project-iq'

# Files changed in this release — relative paths from project root
UPLOAD_FILES = [
    'action_server/actions/glpi_service.py',
    'admin/api/admin_api.py',
    'admin/ui/dist-widget/components/inspector.html',
    'admin/ui/dist-widget/js/admin-inspector.js',
    'admin/ui/dist-widget/js/admin-knowledge-base.js',
    'admin/ui/public/components/inspector.html',
    'admin/ui/public/js/admin-inspector.js',
    'admin/ui/public/js/admin-knowledge-base.js',
    'common/firecrawl_ingester.py',
    'docker-compose-firecrawl.yml',
]

def run(ssh, cmd, wait=30):
    _, o, e = ssh.exec_command(cmd, timeout=wait)
    out = o.read().decode().strip()
    err = e.read().decode().strip()
    return out, err

def main():
    print(f"Connecting to {SERVER}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SERVER, port=22, username=USER, password=PASS, timeout=15)
    sftp = ssh.open_sftp()
    print("Connected.\n")

    # --- 1. Upload files ---
    print("Uploading files...")
    for rel in UPLOAD_FILES:
        local_path  = os.path.join(LOCAL, rel.replace('/', os.sep))
        remote_path = f"{REMOTE}/{rel}"
        # Ensure remote directory exists
        remote_dir = remote_path.rsplit('/', 1)[0]
        run(ssh, f'mkdir -p {remote_dir}')
        sftp.put(local_path, remote_path)
        print(f"  OK  {rel}")

    sftp.close()
    print()

    # --- 2. Restart services ---
    print("Restarting services...")
    for svc in ['project-iq-admin', 'project-iq-actions']:
        out, err = run(ssh, f'sudo systemctl restart {svc} 2>&1')
        time.sleep(3)
        status, _ = run(ssh, f'systemctl is-active {svc}')
        print(f"  {svc}: {status}" + (f"  [{err}]" if err else ""))

    # --- 3. Health check after settle ---
    print("\nWaiting 8s for services to settle...")
    time.sleep(8)

    out, _ = run(ssh, 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8181/ 2>/dev/null', wait=10)
    print(f"  Admin API  (8181): HTTP {out}")

    out, _ = run(ssh, 'curl -s http://127.0.0.1:5005/version 2>/dev/null', wait=8)
    import json
    try:
        v = json.loads(out).get('version','?')
        print(f"  ML Platform(5005): v{v}")
    except Exception:
        print(f"  ML Platform(5005): {out[:80] or 'no response'}")

    out, _ = run(ssh, 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5055/ 2>/dev/null', wait=8)
    print(f"  Actions    (5055): HTTP {out}")

    ssh.close()
    print("\nDeploy complete.")

if __name__ == '__main__':
    main()
