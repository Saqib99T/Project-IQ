# Project IQ Chatbot - Server Deployment Plan

## ðŸ“‹ Overview

This plan covers deploying the chatbot to a Windows server where GLPI and PostgreSQL are already installed.

| Service | Port | Purpose |
|---------|------|---------|
| Rasa Core | 5005 | NLU + Dialogue Management |
| Action Server | 5055 | Custom Python Actions |
| Admin API | 8181 | Flask API + Static Files |
| Nginx | 80/443 | Reverse Proxy + SSL |
| PostgreSQL | 5432 | Database |
| GLPI | (existing) | Ticketing System |

---

## 1ï¸âƒ£ Prerequisites

### Server Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| OS | Windows Server 2019+ | Windows Server 2022 |
| RAM | 8 GB | 16 GB |
| CPU | 4 cores | 8 cores |
| Disk | 50 GB | 100 GB SSD |
| Python | 3.10.x | 3.10.14 |
| Node.js | 18.x | 20.x (for widget build) |

### Software to Install

```powershell
# 1. Python 3.10 (IMPORTANT: Must be 3.10, not 3.11+)
# Download from: https://www.python.org/downloads/release/python-31014/

# 2. Node.js (for widget build if needed)
# Download from: https://nodejs.org/

# 3. Git (for cloning repo)
winget install --id Git.Git

# 4. Nginx for Windows
# Download from: https://nginx.org/en/download.html

# Verify installations
python --version   # Should be 3.10.x
node --version     # Should be 18.x+
git --version
```

---

## 2ï¸âƒ£ GLPI Configuration

GLPI is already installed. Configure API access:

### 2.1 Enable REST API
1. Login to GLPI as admin
2. Go to **Setup > General > API**
3. Enable **REST API**
4. Note the **API URL** (e.g., `http://localhost/glpi/apirest.php`)

### 2.2 Create API Tokens
1. Go to **Setup > General > API > API clients**
2. Create new API client:
   - Name: `ChatBot`
   - Active: Yes
   - Regenerate App Token: Yes
3. Copy the **App Token**
4. Go to **Administration > Users > [Your User] > API Token**
5. Regenerate and copy **User Token**

### 2.3 Record Credentials
```
GLPI_API_URL=http://localhost/glpi/apirest.php
GLPI_APP_TOKEN=<your-app-token>
GLPI_USER_TOKEN=<your-user-token>
```

---

## 3ï¸âƒ£ PostgreSQL Database Setup

### 3.1 Create Database
```sql
-- Connect to PostgreSQL as admin
psql -U postgres

-- Create database
CREATE DATABASE ChatBot;

-- Connect to database
\c ChatBot

-- Create tables
CREATE TABLE conversations (
    id SERIAL PRIMARY KEY,
    sender_id VARCHAR(255) NOT NULL,
    app_id VARCHAR(100) DEFAULT 'General',
    user_id VARCHAR(255),
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved BOOLEAN DEFAULT FALSE
);

CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER REFERENCES conversations(id),
    sender VARCHAR(50) NOT NULL,
    text TEXT,
    intent VARCHAR(100),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id VARCHAR(255),
    ticket_id VARCHAR(100)
);

CREATE TABLE feedback (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER REFERENCES conversations(id),
    rating INTEGER,
    comment TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id VARCHAR(255),
    ticket_id VARCHAR(100)
);

CREATE TABLE actions (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER REFERENCES conversations(id),
    action_name VARCHAR(100) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN DEFAULT TRUE,
    user_id VARCHAR(255),
    ticket_id VARCHAR(100)
);

-- Create indexes
CREATE INDEX idx_conv_sender ON conversations(sender_id);
CREATE INDEX idx_conv_app ON conversations(app_id);
CREATE INDEX idx_msg_conv ON messages(conversation_id);
CREATE INDEX idx_actions_conv ON actions(conversation_id);
```

### 3.2 Update Connection String
Edit `actions/conversation_db.py` with server credentials:
```python
DB_CONFIG = {
    "host": "localhost",      # or server IP
    "database": "ChatBot",
    "user": "postgres",       # your db user
    "password": "YOUR_PASSWORD",
    "port": "5432"
}
```

---

## 4ï¸âƒ£ Deployment Option #1: Windows Terminal

### 4.1 Clone Repository
```powershell
cd C:\
git clone <your-repo-url> Project-IQ
cd C:\Project-IQ
```

### 4.2 Create Virtual Environment
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
```

### 4.3 Train Rasa Model
```powershell
rasa train --force --num-threads 12
```

### 4.4 Create Start Scripts

**start_rasa.bat:**
```batch
@echo off
cd C:\Project-IQ
call venv\Scripts\activate.bat
rasa run --enable-api --cors "*" --port 5005
```

**start_actions.bat:**
```batch
@echo off
cd C:\Project-IQ
call venv\Scripts\activate.bat
rasa run actions --port 5055
```

**start_admin.bat:**
```batch
@echo off
cd C:\Project-IQ
call venv\Scripts\activate.bat
python actions/admin_api.py
```

### 4.5 Configure as Windows Services (Recommended)

Use NSSM (Non-Sucking Service Manager):
```powershell
# Download NSSM from https://nssm.cc/
# Install services:

nssm install RasaCore "C:\Project-IQ\venv\Scripts\python.exe" "-m rasa run --enable-api --cors * --port 5005"
nssm set RasaCore AppDirectory "C:\Project-IQ"

nssm install RasaActions "C:\Project-IQ\venv\Scripts\python.exe" "-m rasa run actions --port 5055"
nssm set RasaActions AppDirectory "C:\Project-IQ"

nssm install AdminAPI "C:\Project-IQ\venv\Scripts\python.exe" "actions/admin_api.py"
nssm set AdminAPI AppDirectory "C:\Project-IQ"

# Start services
nssm start RasaCore
nssm start RasaActions
nssm start AdminAPI
```

### 4.6 Configure Nginx

**nginx.conf:**
```nginx
worker_processes 1;

events {
    worker_connections 1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;

    server {
        listen 80;
        server_name your-server.com;

        # Chat Widget Static Files
        location / {
            root C:/Project-IQ/client_ui/dist-widget;
            index it.html;
            try_files $uri $uri/ /it.html;
        }

        # Rasa Webhook
        location /webhooks/ {
            proxy_pass http://127.0.0.1:5005;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # Admin API
        location /admin/ {
            proxy_pass http://127.0.0.1:8181/admin/;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
        }

        # Admin Dashboard
        location /admin.html {
            root C:/Project-IQ/client_ui/dist-widget;
        }
    }
}
```

---

## 5ï¸âƒ£ Deployment Option #2: Docker

### 5.1 Create Dockerfiles

**Dockerfile.rasa:**
```dockerfile
FROM rasa/rasa:3.6.16

WORKDIR /app
COPY . /app

USER root
RUN pip install -r requirements.txt

USER 1001
EXPOSE 5005
CMD ["run", "--enable-api", "--cors", "*", "--port", "5005"]
```

**Dockerfile.actions:**
```dockerfile
FROM python:3.10-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY actions/ ./actions/
COPY .env .

EXPOSE 5055
CMD ["python", "-m", "rasa_sdk", "--actions", "actions", "--port", "5055"]
```

**Dockerfile.admin:**
```dockerfile
FROM python:3.10-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY actions/ ./actions/
COPY "client_ui/dist-widget" ./static/
COPY .env .

EXPOSE 8181
CMD ["python", "actions/admin_api.py"]
```

### 5.2 Docker Compose

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  rasa:
    build:
      context: .
      dockerfile: Dockerfile.rasa
    ports:
      - "5005:5005"
    volumes:
      - ./models:/app/models
    depends_on:
      - actions
    networks:
      - chatbot-net

  actions:
    build:
      context: .
      dockerfile: Dockerfile.actions
    ports:
      - "5055:5055"
    environment:
      - DB_HOST=host.docker.internal
      - DB_NAME=ChatBot
      - DB_USER=postgres
      - DB_PASSWORD=${DB_PASSWORD}
    networks:
      - chatbot-net

  admin:
    build:
      context: .
      dockerfile: Dockerfile.admin
    ports:
      - "8181:8181"
    environment:
      - DB_HOST=host.docker.internal
    networks:
      - chatbot-net

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./client_ui/dist-widget:/usr/share/nginx/html
    depends_on:
      - rasa
      - admin
    networks:
      - chatbot-net

networks:
  chatbot-net:
    driver: bridge
```

### 5.3 Deploy with Docker
```powershell
# Build and start
docker-compose up -d --build

# Check status
docker-compose ps

# View logs
docker-compose logs -f rasa
```

---

## 6ï¸âƒ£ Secrets Management with Infisical

Your project uses **Infisical** for secure secrets management. The `.env` file only contains Infisical connection credentials, not the actual secrets.

### 6.1 Current Architecture

```
.env (on server)
    â†“
Contains: INFISICAL_PROJECT_ID, CLIENT_ID, CLIENT_SECRET, ENVIRONMENT
    â†“
config_manager.py â†’ Connects to Infisical Cloud
    â†“
Retrieves: GLPI_*, DB_* secrets at runtime
```

### 6.2 Setup Infisical for Production

**Step 1: Create Production Environment in Infisical**
1. Login to [Infisical](https://app.infisical.com)
2. Go to your project â†’ Environments
3. Create new environment: `prod`

**Step 2: Add Secrets to `prod` Environment**

| Secret Name | Example Value |
|-------------|---------------|
| `DB_HOST` | `localhost` or server IP |
| `DB_PORT` | `5432` |
| `DB_NAME` | `ChatBot` |
| `DB_USER` | `postgres` |
| `DB_PASSWORD` | `your_secure_password` |
| `GLPI_API_URL` | `http://glpi.yourserver.com/apirest.php` |
| `GLPI_APP_TOKEN` | `your_glpi_app_token` |
| `GLPI_USER_TOKEN` | `your_glpi_user_token` |

**Step 3: Create Machine Identity for Server**
1. Go to Project Settings â†’ Machine Identities
2. Create new identity: `production-server`
3. Copy the **Client ID** and **Client Secret**

**Step 4: Create `.env` on Server**

```env
# Infisical Cloud Credentials (PRODUCTION)
INFISICAL_PROJECT_ID=0fdefb89-bbc8-4444-b405-b71bd2b16060
INFISICAL_CLIENT_ID=<production-server-client-id>
INFISICAL_CLIENT_SECRET=<production-server-client-secret>
INFISICAL_ENVIRONMENT=prod
```

### 6.3 Verify Infisical Connection

```python
# Test script: test_infisical.py
from actions.config_manager import get_db_config, get_glpi_config

print("DB Config:", get_db_config())
print("GLPI Config:", get_glpi_config())
```

Run: `python test_infisical.py`

### 6.4 Security Best Practices

| Practice | Implementation |
|----------|----------------|
| Different environments | Use `dev`, `staging`, `prod` in Infisical |
| Rotate secrets | Regenerate Machine Identity periodically |
| Audit access | Review Infisical access logs |
| Backup | Export secrets backup from Infisical |

---

## 7ï¸âƒ£ Firewall Rules

```powershell
# Allow internal ports (only if needed externally)
New-NetFirewallRule -DisplayName "Rasa Core" -Direction Inbound -Port 5005 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "Rasa Actions" -Direction Inbound -Port 5055 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "Admin API" -Direction Inbound -Port 8181 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "HTTP" -Direction Inbound -Port 80 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "HTTPS" -Direction Inbound -Port 443 -Protocol TCP -Action Allow
```

---

## 8ï¸âƒ£ Verification Checklist

| Step | Command/Action | Expected Result |
|------|----------------|-----------------|
| 1 | `curl http://localhost:5005/` | Rasa version info |
| 2 | `curl http://localhost:5055/health` | Action server OK |
| 3 | `curl http://localhost:8181/admin/health` | Admin API OK |
| 4 | Open `http://server/it.html` | Chat widget loads |
| 5 | Open `http://server/admin.html` | Admin dashboard loads |
| 6 | Send test message | Bot responds |
| 7 | Create ticket | Appears in GLPI |

---

## 9ï¸âƒ£ Troubleshooting

| Issue | Solution |
|-------|----------|
| Rasa won't start | Check Python 3.10, verify model exists |
| GLPI connection fails | Verify API tokens, check GLPI API enabled |
| Database connection fails | Check PostgreSQL running, verify credentials |
| Widget not loading | Check Nginx config, verify static files exist |
| CORS errors | Add server URL to Rasa CORS config |

---

## ðŸ• Estimated Deployment Time

| Step | Time |
|------|------|
| Prerequisites | 30 min |
| Database setup | 15 min |
| Clone & configure | 15 min |
| Train model | 10-20 min |
| Option 1 (Terminal) | 30 min |
| Option 2 (Docker) | 45 min |
| Testing | 15 min |
| **Total** | **~2 hours** |

---

## â“ Questions Before Deployment

1. **Server IP/Domain:** What URL will the chatbot be accessible at?
2. **SSL:** Do you need HTTPS? (Recommended for production)
3. **Existing PostgreSQL:** What are the current DB credentials?
4. **GLPI URL:** What is the GLPI API endpoint on the server?
5. **Preferred Option:** Windows Terminal or Docker?
