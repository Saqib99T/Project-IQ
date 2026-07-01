# SSH Hardening Runbook — ProjectIQ2_Server (192.168.71.66)

**Purpose:** Stop the SSH brute-force traffic seen in the Jun 30 2026 logs by switching the
server to **key-only authentication** and (optionally) firewalling port 22. No breach was found
in the logs — every one of the ~8,018 events was a *failed* login from automated internet bots.
This runbook closes the exposure they were feeding on.

- **Target server:** `192.168.71.66` (ProjectIQ2_Server)
- **Login user:** `user`
- **Your workstation:** Windows 11 (run PowerShell steps here)
- **Your public key (safe to share):**
  ```
  ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBfKT7pxWYEan4ub4k+dKpVwzcRKHwPoOFt+L9SuRaE2 hp@Laptop-SI
  ```
- **Private key (NEVER share / never copy to the server):** `C:\Users\hp\.ssh\id_ed25519`

> ⚠️ Do every step in order. **Do not close your working SSH session** until a second,
> independent login has been confirmed (Step 4). This prevents locking yourself out.

---

## Step 1 — Install your public key on the server (PowerShell, on your laptop)

You will be prompted for the server password **one last time**.

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh user@192.168.71.66 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

## Step 2 — Verify key-based login works (PowerShell, on your laptop)

```powershell
ssh user@192.168.71.66
```

Expected: it logs you in **without** asking for the server password.
(It may ask for your key *passphrase* if you set one — that's fine.)
If it still asks for the server password, STOP and fix Step 1 before continuing.

## Step 3 — Harden sshd (run ON the server, in the Step 2 session)

Keep this session open after running these commands.

```bash
# Back up current config (timestamped)
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak.$(date +%s)

# Disable password auth, keyboard-interactive, and root login
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config

# Validate config BEFORE applying (catches typos that would break sshd)
sudo sshd -t && echo "config OK"

# Apply (use whichever service name exists on this box)
sudo systemctl reload ssh || sudo systemctl reload sshd
```

## Step 4 — Safety check (do this BEFORE closing the Step 2 session)

Open a **second** PowerShell window on your laptop and run:

```powershell
ssh user@192.168.71.66
```

- If it logs in via key → success. Password brute force is now harmless. You may close sessions.
- If it fails → use your still-open Step 2 session to investigate (see Rollback).

---

## Step 5 (Optional, recommended) — Add a passphrase to your key

Protects the key if your laptop is lost/stolen. Does NOT change the public key, so no reinstall.

```powershell
ssh-keygen -p -f $env:USERPROFILE\.ssh\id_ed25519
```

## Step 6 (Optional, defense-in-depth) — Firewall port 22 to your admin IP only

Replace `YOUR.ADMIN.IP.HERE` with your real public IP (find it: `curl ifconfig.me`).
Run ON the server. **Add the SSH allow rule BEFORE enabling the firewall**, or you lock yourself out.

Using ufw:
```bash
sudo ufw allow from YOUR.ADMIN.IP.HERE to any port 22 proto tcp
sudo ufw enable
sudo ufw status numbered
```

## Step 7 (Optional) — Install fail2ban to auto-ban repeat offenders

```bash
sudo apt-get update && sudo apt-get install -y fail2ban
sudo tee /etc/fail2ban/jail.d/sshd.local >/dev/null <<'EOF'
[sshd]
enabled = true
maxretry = 4
findtime = 10m
bantime = 1h
EOF
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

---

## Top offender IPs from the Jun 30 logs (block at perimeter if desired)

- 45.153.34.181   (heaviest — sustained ~16:08–17:18)
- 117.25.149.146  (sustained ~10:46–11:43)
- 87.251.64.145 / 87.251.64.144
- 158.69.194.208
- 45.148.10.0/24  (cluster: .121 .141 .147 .151 .152 .157 .239)

---

## Rollback (if you get locked out of key login)

From your still-open working session on the server:

```bash
# Restore the most recent backup
sudo cp "$(ls -t /etc/ssh/sshd_config.bak.* | head -1)" /etc/ssh/sshd_config
sudo sshd -t && (sudo systemctl reload ssh || sudo systemctl reload sshd)
```

This re-enables the previous (password) auth so you can get back in and retry.

---

## Verify no compromise occurred (peace-of-mind check, run on server)

```bash
# Any SUCCESSFUL logins? Review carefully — should only be you.
sudo grep -Ei "accepted (password|publickey)" /var/log/auth.log
last -20
sudo lastlog | grep -vi "Never logged in"
```

If the only successful logins are yours, the brute force never got in — consistent with the log.
```
