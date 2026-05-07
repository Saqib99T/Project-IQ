"""Deploy latest fixes to Ubuntu server at 192.168.71.66."""
import paramiko
import os

SERVER = "192.168.71.66"
PORT = 22
USER = "user"
PASSWORD = "99tech6677"
REMOTE_BASE = "/home/user/project-iq"
LOCAL_BASE = "d:/99T/Rasa/Project-IQ"

FILES = [
    ("action_server/actions/actions.py",        "action_server/actions/actions.py"),
    ("admin/api/admin_api.py",                  "admin/api/admin_api.py"),
    ("admin/ui/public/js/admin-inspector.js",   "admin/ui/public/js/admin-inspector.js"),
    ("admin/ui/public/js/admin-system-status.js","admin/ui/public/js/admin-system-status.js"),
    ("admin/ui/dist-widget/js/admin-inspector.js","admin/ui/dist-widget/js/admin-inspector.js"),
    ("admin/ui/public/operator.html",           "admin/ui/public/operator.html"),
    ("admin/ui/public/components/configuration.html","admin/ui/public/components/configuration.html"),
    ("admin/ui/public/cookies_policy.html",     "admin/ui/public/cookies_policy.html"),
    ("admin/ui/public/privacy_notice.html",     "admin/ui/public/privacy_notice.html"),
    ("core/domain.yml",                         "core/domain.yml"),
]

def deploy():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {SERVER}...")
    ssh.connect(SERVER, port=PORT, username=USER, password=PASSWORD)
    sftp = ssh.open_sftp()

    for local_rel, remote_rel in FILES:
        local_path  = os.path.join(LOCAL_BASE, local_rel).replace("\\", "/")
        remote_path = f"{REMOTE_BASE}/{remote_rel}"
        print(f"  Uploading {local_rel}...")
        sftp.put(local_path, remote_path)

    sftp.close()
    print("\nRestarting services...")

    # Restart action server
    _, stdout, stderr = ssh.exec_command(
        "pkill -f 'rasa run actions' ; sleep 1 ; "
        "cd /home/user/Project-IQ && "
        "nohup venv/bin/rasa run actions --actions action_server.actions "
        "--port 5055 --debug > /tmp/actions.log 2>&1 &"
    )
    print("  Action server:", stdout.read().decode().strip() or "restarted")

    # Restart admin API
    _, stdout, stderr = ssh.exec_command(
        "pkill -f 'python.*admin_api' ; sleep 1 ; "
        "cd /home/user/Project-IQ && "
        "nohup venv/bin/python admin/api/admin_api.py > /tmp/admin_api.log 2>&1 &"
    )
    print("  Admin API:", stdout.read().decode().strip() or "restarted")

    ssh.close()
    print("\nDeploy complete.")

if __name__ == "__main__":
    deploy()
