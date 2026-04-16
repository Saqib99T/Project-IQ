# Project-IQ Full Deployment Guide

## 1. OS Choice

**Recommended:**
- **Ubuntu Server 22.04 LTS** (best support, easiest for open-source, Docker, and Python stacks)
- Red Hat is fine for enterprise, but Ubuntu is simpler for most teams.
- Windows is not recommended for production for this stack.

---

## 2. Minimum Resource Requirements

| Component         | CPU      | RAM   | Disk (SSD) | Notes                        |
|-------------------|----------|-------|------------|------------------------------|
| PostgreSQL        | 2 cores  | 2 GB  | 10 GB      | Can share with app server    |
| GLPI (Docker)     | 2 cores  | 2 GB  | 10 GB      | PHP + MySQL in Docker        |
| Firecrawl (Docker)| 2 cores  | 2 GB  | 5 GB       | Node.js in Docker            |
| Rasa Core         | 2 cores  | 4 GB  | 5 GB       | Python, TensorFlow           |
| Action Server     | 1 core   | 2 GB  | 2 GB       | Python SDK                   |
| Admin/Operator    | 2 cores  | 2 GB  | 5 GB       | Flask, Node.js for build     |
| **Total**         | **4–6 cores** | **8–12 GB** | **30–40 GB** | All can run on one VM for pilot |

---

## 2a. Additional Server Requirements & Best Practices

- **Static IP Address:**
  - Assign a static IP to your server for reliable access and DNS mapping.
- **DNS Record:**
  - Set up an A record (or CNAME) pointing your domain/subdomain to the server's static IP.
- **Firewall Configuration:**
  - Only open required ports. See port table below.
  - Use `ufw` or your cloud provider's firewall.
- **Time Synchronization:**
  ```sh
  sudo apt install ntp
  sudo systemctl enable --now ntp
  ```
- **Security:**
  - Disable root SSH login, use SSH keys, keep system/packages updated, install fail2ban.
- **Reverse Proxy/SSL:**
  - Use Nginx for HTTPS, domain routing, and security headers. Use Let's Encrypt for SSL.

### Port Reference

| Port  | Service              | Expose Externally? |
|-------|----------------------|--------------------|
| 22    | SSH                  | Yes (restrict to your IP) |
| 80    | Nginx HTTP           | Yes (redirects to 443) |
| 443   | Nginx HTTPS          | Yes |
| 8181  | Admin API / Web UI   | Via Nginx only (proxy) |
| 5005  | Rasa Core            | Only if mobile app is used directly |
| 5055  | Rasa Action Server   | **No** — internal only |
| 5432  | PostgreSQL           | **No** — internal only |
| 8080  | GLPI Web             | Via Nginx only (proxy) |
| 3002  | Firecrawl            | **No** — internal only |

---

## 3. Prepare the Server

```sh
sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential curl git unzip htop python3 python3-venv python3-pip
```

**(Optional) Create a non-root user:**
```sh
sudo adduser chatbot
sudo usermod -aG sudo chatbot
su - chatbot
```

---

## 4. Install Docker & Docker Compose

```sh
sudo apt install -y docker.io docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# Log out and back in for group changes to take effect
```

---

## 5. Install PostgreSQL with pgvector

```sh
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

**Install pgvector extension** (required for semantic knowledge base):
```sh
sudo apt install -y postgresql-server-dev-all build-essential git
git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git /tmp/pgvector
cd /tmp/pgvector
make
sudo make install
```

**Create the database** (project uses the `postgres` superuser):
```sh
sudo -u postgres psql
ALTER USER postgres WITH PASSWORD 'YOUR_DB_PASSWORD';
CREATE DATABASE "Chatbot";
\c Chatbot
CREATE EXTENSION IF NOT EXISTS vector;
\q
```

> **Note:** The database name is `Chatbot` with a capital C — keep it exactly as shown.

---

## 6. Deploy GLPI in Docker

**Create `docker-compose-glpi.yml`:**
```yaml
version: '3.7'
services:
  glpi-db:
    image: mysql:5.7
    container_name: glpi-db
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: glpi_root_pw
      MYSQL_DATABASE: glpidb
      MYSQL_USER: glpi
      MYSQL_PASSWORD: glpi_pw
    volumes:
      - glpi-db-data:/var/lib/mysql

  glpi:
    image: diouxx/glpi
    container_name: glpi
    restart: always
    ports:
      - "8080:80"
    environment:
      TIMEZONE: Europe/Paris
    volumes:
      - glpi-data:/var/www/html
    depends_on:
      - glpi-db

volumes:
  glpi-db-data:
  glpi-data:
```

**Start GLPI:**
```sh
docker-compose -f docker-compose-glpi.yml up -d
```

- Access GLPI at `http://your-server:8080` and complete the web installer.

**After GLPI is running — required setup:**

1. Log in as `glpi` / `glpi` (default) and change the admin password.
2. Go to **Setup → General → API** and enable the REST API. Generate an **App Token**.
3. Go to **Administration → Users** → open `glpi` user → **Remote access keys** → generate a **User Token**.
4. Go to **Administration → Groups** → create a group named `Support`.
5. Create the operator user (e.g. `support-it`) and add them to the `Support` group.
6. Set the operator's password — this same password must be set in the local DB (done in step 11).

---

## 7. Deploy Firecrawl Self-Hosted in Docker

**Create `docker-compose-firecrawl.yml`:**
```yaml
version: '3.7'
services:
  firecrawl:
    image: firecrawl/firecrawl-selfhost:latest
    container_name: firecrawl
    restart: always
    ports:
      - "3002:3000"
    env_file:
      - .env
    volumes:
      - firecrawl-data:/app/data

volumes:
  firecrawl-data:
```

- Create and configure your `.env` file as needed.
- Start Firecrawl:
  ```sh
  docker-compose -f docker-compose-firecrawl.yml up -d
  ```
- Firecrawl will be accessible internally at `http://localhost:3002`.

---

## 8. Install Node.js (for Admin UI build)

```sh
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## 9. Deploy Project-IQ

**Clone your repo:**
```sh
git clone <your-repo-url> ~/project-iq
cd ~/project-iq
```

**Set up Python virtual environment:**
```sh
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

**Install Node.js dependencies and build the widget:**
```sh
cd admin/ui
npm install
npm run build:widget   # IMPORTANT: always use this script — do NOT prefix with NODE_ENV=development
cd ../../
```

> **Critical:** The widget build script runs Vite in `--mode production`. Using `NODE_ENV=development` instead causes `jsxDEV is not a function` errors in the browser.

**Build the admin UI:**
```sh
cd admin/ui
npm run build
cd ../../
```

---

## 10. Configure the Application

**Set the active profile** so the app uses `common/app.config.prod`:
```sh
export APP_PROFILE=prod
```

Add this to your shell's `.bashrc` / `.profile` or to the systemd service files (shown in section 13).

**Edit `common/app.config.prod`** and fill in all `YOUR_*` placeholders:

| Key | What to set |
|-----|-------------|
| `glpi_api_url` | `http://localhost:8080/apirest.php` |
| `glpi_app_token` | App token from GLPI Setup → API |
| `glpi_user_token` | User token from GLPI user profile |
| `db_password` | The PostgreSQL password you set in step 5 |
| `cors_origins` | Your domain, e.g. `https://iq.yourcompany.com` |
| `operator_jwt_secret` | A long random string — never share this |
| `smtp_*` | Your SMTP relay credentials |
| `socketio_cors_allowed_origins` | Same as `cors_origins` |

**Update `core/endpoints.yml`** with your production DB password:
```yaml
action_endpoint:
  url: "http://127.0.0.1:5055/webhook"

tracker_store:
  type: custom_tracker_store.CustomTrackerStore
  url: "postgresql://postgres:YOUR_DB_PASSWORD@localhost:5432/Chatbot"
```

---

## 11. Initialize the Database

The database schema is created automatically when the admin server starts (`_init_database()` runs on module load). However, run these scripts first for pgvector setup and any data migration:

```sh
source venv/bin/activate
python scripts/setup_pgvector.py
python scripts/migrate_to_postgres.py   # Only if migrating from a previous setup
```

> **Operator accounts:** Operators are managed entirely in GLPI — create users there and add them to the `Support` group (see step 6). On an operator's first successful login, the system automatically creates a local Postgres record used only for chat history and session metadata. No manual DB setup is needed for operators.

---

## 12. Train the Rasa Model

**This step is mandatory before Rasa can start.** The model is not included in the repo.

```sh
cd ~/project-iq/core
../venv/bin/rasa train
cd ..
```

Training takes 5–15 minutes depending on hardware. The model is saved to `core/models/`.

---

## 13. Run All Services

**Start Rasa Core:**
```sh
cd ~/project-iq/core
APP_PROFILE=prod ../venv/bin/rasa run --enable-api --cors "*"
```

**Start Action Server:**
```sh
cd ~/project-iq/action_server
APP_PROFILE=prod ../venv/bin/rasa run actions
```

**Start Admin Server:**
```sh
cd ~/project-iq
APP_PROFILE=prod venv/bin/python -m admin.api.admin_api
```

> The admin server must be started from the **project root** (`~/project-iq`) so the `admin.api.admin_api` module path resolves correctly.

---

## 14. Set Up as Systemd Services

Create a service file for each component so they auto-start and restart on failure.

**`/etc/systemd/system/project-iq-rasa.service`**
```ini
[Unit]
Description=Project-IQ Rasa Core
After=network.target postgresql.service

[Service]
User=chatbot
WorkingDirectory=/home/chatbot/project-iq/core
Environment=APP_PROFILE=prod
ExecStart=/home/chatbot/project-iq/venv/bin/rasa run --enable-api --cors "*"
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**`/etc/systemd/system/project-iq-actions.service`**
```ini
[Unit]
Description=Project-IQ Rasa Action Server
After=network.target postgresql.service

[Service]
User=chatbot
WorkingDirectory=/home/chatbot/project-iq/action_server
Environment=APP_PROFILE=prod
ExecStart=/home/chatbot/project-iq/venv/bin/rasa run actions
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**`/etc/systemd/system/project-iq-admin.service`**
```ini
[Unit]
Description=Project-IQ Admin API
After=network.target postgresql.service project-iq-rasa.service

[Service]
User=chatbot
WorkingDirectory=/home/chatbot/project-iq
Environment=APP_PROFILE=prod
ExecStart=/home/chatbot/project-iq/venv/bin/python -m admin.api.admin_api
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Enable and start all services:**
```sh
sudo systemctl daemon-reload
sudo systemctl enable project-iq-rasa project-iq-actions project-iq-admin
sudo systemctl start project-iq-rasa project-iq-actions project-iq-admin
sudo systemctl status project-iq-*
```

---

## 15. Reverse Proxy with Nginx

Install Nginx and certbot:
```sh
sudo apt install -y nginx certbot python3-certbot-nginx
```

Create `/etc/nginx/sites-available/project-iq`:
```nginx
server {
    listen 80;
    server_name iq.yourcompany.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name iq.yourcompany.com;

    ssl_certificate     /etc/letsencrypt/live/iq.yourcompany.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/iq.yourcompany.com/privkey.pem;

    # Admin API + Web UI + Socket.IO
    location / {
        proxy_pass http://127.0.0.1:8181;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    # GLPI
    location /glpi/ {
        proxy_pass http://127.0.0.1:8080/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```sh
sudo ln -s /etc/nginx/sites-available/project-iq /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d iq.yourcompany.com
```

> **Socket.IO requires** the `Upgrade` and `Connection` headers above — without them, Socket.IO falls back to polling and the operator live-chat panel will not work properly.

---

## 16. Security & Maintenance

```sh
# Firewall
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# fail2ban
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban

# Disable root SSH login
sudo sed -i 's/^PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl reload sshd
```

---

## 17. Backups

### PostgreSQL Backup & Restore

**Backup:**
```sh
pg_dump -U postgres -F c -b -v -f chatbot_db.backup Chatbot
```

**Restore:**
```sh
sudo -u postgres createdb Chatbot
pg_restore -U postgres -d Chatbot -v chatbot_db.backup
```

### GLPI Backup & Restore

**Backup MySQL Database:**
```sh
docker exec glpi-db mysqldump -u glpi -pglpi_pw glpidb > glpi_db.sql
```

**Backup GLPI Files:**
```sh
docker cp glpi:/var/www/html ./glpi_files
```

**Restore MySQL Database:**
```sh
docker exec -i glpi-db mysql -u glpi -pglpi_pw glpidb < glpi_db.sql
```

**Restore GLPI Files:**
```sh
docker cp ./glpi_files/. glpi:/var/www/html
```

### Summary Table

| What         | Backup Command                                              | Restore Command                                               |
|--------------|------------------------------------------------------------|---------------------------------------------------------------|
| PostgreSQL   | `pg_dump -U postgres -F c -b -v -f chatbot_db.backup Chatbot` | `pg_restore -U postgres -d Chatbot -v chatbot_db.backup`   |
| GLPI DB      | `docker exec glpi-db mysqldump ... > glpi_db.sql`           | `docker exec -i glpi-db mysql ... < glpi_db.sql`              |
| GLPI Files   | `docker cp glpi:/var/www/html ./glpi_files`                 | `docker cp ./glpi_files/. glpi:/var/www/html`                 |
