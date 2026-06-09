# Project-IQ - Windows Deployment Guide

## 📋 Table of Contents
1. [Prerequisites](#prerequisites)
2. [Installation Steps](#installation-steps)
3. [Database Setup](#database-setup)
4. [Configuration](#configuration)
5. [Starting Services](#starting-services)
6. [Verification](#verification)
7. [Troubleshooting](#troubleshooting)
8. [Production Deployment](#production-deployment)
9. [Maintenance](#maintenance)

---

## 🔧 Prerequisites

### Required Software

1. **Python 3.8, 3.9, or 3.10** (Rasa requires specific versions)
   - Download from: https://www.python.org/downloads/
   - ⚠️ **Important**: Check "Add Python to PATH" during installation
   - Verify installation:
     ```cmd
     python --version
     ```

2. **PostgreSQL 12 or higher**
   - Download from: https://www.postgresql.org/download/windows/
   - Remember the password you set for the `postgres` user
   - Verify installation:
     ```cmd
     psql --version
     ```

3. **Git for Windows** (optional, for version control)
   - Download from: https://git-scm.com/download/win

### System Requirements
- **RAM**: Minimum 8GB, Recommended 16GB+
- **Storage**: 5GB free space
- **OS**: Windows 10/11 or Windows Server 2016+
- **Network**: Port 80, 5005, 5055 should be available

---

## 📦 Installation Steps

### Step 1: Download/Clone the Project

**Option A: If you have Git**
```cmd
cd C:\
git clone <your-repo-url> Project-IQ
cd Project-IQ
```

**Option B: Manual Download**
1. Download the project ZIP file
2. Extract to `C:\Project-IQ` (or your preferred location)
3. Open Command Prompt as Administrator
4. Navigate to the project:
   ```cmd
   cd C:\Project-IQ
   ```

### Step 2: Create Python Virtual Environment

```cmd
# Create virtual environment
python -m venv venv

# Activate virtual environment
venv\Scripts\activate

# Your prompt should now show (venv)
```

### Step 3: Install Python Dependencies

```cmd
# Upgrade pip first
python -m pip install --upgrade pip

# Install Rasa and dependencies
pip install rasa==3.6.20

# Install additional requirements
pip install -r requirements.txt
```

**Common packages included:**
- rasa-sdk (for custom actions)
- psycopg2-binary (PostgreSQL adapter)
- psutil (system monitoring)
- requests (HTTP client)
- pyyaml (YAML parser)
- flask (for admin API)

### Step 4: Verify Rasa Installation

```cmd
rasa --version
# Should display: Rasa 3.6.20 (or your version)
```

---

## 🗄️ Database Setup

### Step 1: Create PostgreSQL Database

1. Open **pgAdmin 4** (installed with PostgreSQL)
2. Connect to PostgreSQL server (use the password you set during installation)
3. Right-click on "Databases" → "Create" → "Database"
4. Enter database name: `rasa_conversations`
5. Click "Save"

**OR via Command Line:**

```cmd
# Open PostgreSQL command prompt
psql -U postgres

# Create database
CREATE DATABASE rasa_conversations;

# Create user (optional, for better security)
CREATE USER rasa_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE rasa_conversations TO rasa_user;

# Exit
\q
```

### Step 2: Initialize Database Tables

The database tables will be created automatically when you first run the application. You can verify by checking:

```cmd
psql -U postgres -d rasa_conversations -c "\dt"
```

Expected tables:
- `conversations`
- `messages`
- `feedback`
- `users`
- `apps`
- `themes`
- `actions`

---

## ⚙️ Configuration

### Step 1: Configure Database Connection

Edit `actions/conversation_db.py` and update the connection details:

```python
DB_CONFIG = {
    'host': 'localhost',
    'port': 5432,
    'database': 'rasa_conversations',
    'user': 'postgres',  # or 'rasa_user' if you created one
    'password': 'your_password_here'
}
```

### Step 2: Configure GLPI (Optional)

If you're using GLPI ticket system, edit `app.config`:

```yaml
glpi:
  base_url: "https://your-glpi-server.com"
  app_token: "your_app_token_here"
  user_token: "your_user_token_here"
```

If not using GLPI, the system will run in demo mode with simulated tickets.

### Step 3: Configure Endpoints

Edit `endpoints.yml`:

```yaml
action_endpoint:
  url: "http://localhost:5055/webhook"

tracker_store:
  type: sql
  dialect: postgresql
  host: localhost
  port: 5432
  db: rasa_conversations
  username: postgres
  password: your_password_here
  login_db: postgres
```

### Step 4: Admin Server Configuration

Edit `actions/admin_api.py` if you need to change the port:

```python
if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        port=80,  # Change this if port 80 is unavailable
        debug=True
    )
```

**Note**: Port 80 requires Administrator privileges. You can use port 8080 or 8000 instead.

---

## 🚀 Starting Services

### Option 1: Start Services Manually (Recommended for Testing)

Open **3 separate Command Prompt windows** as Administrator:

**Window 1 - Rasa Core Server:**
```cmd
cd C:\Project-IQ
venv\Scripts\activate
rasa run --enable-api --cors "*" --port 5005 --debug
```

**Window 2 - Actions Server:**
```cmd
cd C:\Project-IQ
venv\Scripts\activate
python -m rasa_sdk --actions actions -p 5055
```

**Window 3 - Admin API Server:**
```cmd
cd C:\Project-IQ
venv\Scripts\activate
cd actions
python admin_api.py
```

### Option 2: Start Services with Batch Script

Create a file named `start_services.bat`:

```batch
@echo off
echo Starting Project-IQ Services...
echo.

REM Start Rasa Core
start "Rasa Core" cmd /k "cd /d %~dp0 && venv\Scripts\activate && rasa run --enable-api --cors * --port 5005"

REM Wait 5 seconds
timeout /t 5 /nobreak

REM Start Actions Server
start "Actions Server" cmd /k "cd /d %~dp0 && venv\Scripts\activate && python -m rasa_sdk --actions actions -p 5055"

REM Wait 3 seconds
timeout /t 3 /nobreak

REM Start Admin API
start "Admin API" cmd /k "cd /d %~dp0 && venv\Scripts\activate && cd actions && python admin_api.py"

echo.
echo All services started!
echo - Rasa Core: http://localhost:5005
echo - Actions Server: http://localhost:5055
echo - Admin Dashboard: http://localhost:80
echo.
pause
```

Right-click `start_services.bat` and select "Run as Administrator"

### Option 3: Create Windows Services (Production)

For production deployment, you should create Windows Services. Create `install_services.bat`:

```batch
@echo off
REM Install NSSM (Non-Sucking Service Manager)
REM Download from: https://nssm.cc/download

REM Install Rasa Core Service
nssm install RasaCore "%CD%\venv\Scripts\python.exe" "-m rasa run --enable-api --cors * --port 5005"
nssm set RasaCore AppDirectory "%CD%"
nssm set RasaCore DisplayName "Rasa Core Server"
nssm set RasaCore Description "Rasa conversational AI core server"
nssm set RasaCore Start SERVICE_AUTO_START

REM Install Actions Service
nssm install RasaActions "%CD%\venv\Scripts\python.exe" "-m rasa_sdk --actions actions -p 5055"
nssm set RasaActions AppDirectory "%CD%"
nssm set RasaActions DisplayName "Rasa Actions Server"
nssm set RasaActions Description "Rasa custom actions server"
nssm set RasaActions Start SERVICE_AUTO_START

REM Install Admin API Service
nssm install RasaAdmin "%CD%\venv\Scripts\python.exe" "%CD%\actions\admin_api.py"
nssm set RasaAdmin AppDirectory "%CD%"
nssm set RasaAdmin DisplayName "Rasa Admin Dashboard"
nssm set RasaAdmin Description "Rasa administration and analytics dashboard"
nssm set RasaAdmin Start SERVICE_AUTO_START

echo Services installed successfully!
echo Start services with: net start RasaCore RasaActions RasaAdmin
pause
```

---

## ✅ Verification

### Step 1: Check Service Status

**Rasa Core:**
```cmd
curl http://localhost:5005/status
```
Expected output: JSON with model information

**Actions Server:**
```cmd
curl http://localhost:5055/health
```
Expected output: `{"status":"ok"}`

**Admin Dashboard:**
```cmd
curl http://localhost:80/admin/health/rasa
```
Expected output: `{"healthy":true,"service":"rasa","status":"ok"}`

### Step 2: Access Admin Dashboard

1. Open browser and go to: http://localhost:80
2. You should see the admin login page
3. Default credentials (if implemented):
   - Username: `admin`
   - Password: `admin123`

### Step 3: Test Chatbot

**Option A: Via Admin Dashboard**
1. Go to http://localhost:80
2. Click on "Test Widget" or similar section
3. Type a message to test the bot

**Option B: Via API**
```cmd
curl -X POST http://localhost:5005/webhooks/rest/webhook ^
  -H "Content-Type: application/json" ^
  -d "{\"sender\":\"test_user\",\"message\":\"hello\"}"
```

Expected output: JSON array with bot responses

### Step 4: Check Logs

Logs are stored in the `Log/` directory:
- `core.log` - Rasa Core logs
- `actions.log` - Actions Server logs
- `admin_new.err` - Admin API logs

```cmd
# View latest logs
type Log\core.log
type Log\actions.log
type admin_new.err
```

---

## 🔍 Troubleshooting

### Issue: Port Already in Use

**Error:** `Address already in use`

**Solution:**
1. Find which process is using the port:
   ```cmd
   netstat -ano | findstr :5005
   netstat -ano | findstr :5055
   netstat -ano | findstr :80
   ```

2. Kill the process:
   ```cmd
   taskkill /F /PID <process_id>
   ```

3. Or change the port in configuration

### Issue: Database Connection Failed

**Error:** `could not connect to server: Connection refused`

**Solution:**
1. Verify PostgreSQL is running:
   ```cmd
   sc query postgresql-x64-14
   ```

2. Start PostgreSQL if not running:
   ```cmd
   net start postgresql-x64-14
   ```

3. Check credentials in `conversation_db.py` and `endpoints.yml`

### Issue: Module Not Found Errors

**Error:** `ModuleNotFoundError: No module named 'XXX'`

**Solution:**
1. Ensure virtual environment is activated:
   ```cmd
   venv\Scripts\activate
   ```

2. Reinstall requirements:
   ```cmd
   pip install -r requirements.txt
   ```

### Issue: Rasa Model Not Found

**Error:** `No Rasa model found`

**Solution:**
1. Train a new model:
   ```cmd
   rasa train
   ```

2. This will create a model in the `models/` directory

### Issue: Permission Denied on Port 80

**Error:** `Permission denied: Cannot bind to port 80`

**Solution:**
1. Run Command Prompt as Administrator
2. Or change admin server port to 8080 in `admin_api.py`

### Issue: Actions Server Import Errors

**Error:** `Failed to register package 'actions'`

**Solution:**
1. Check that you're running from the project root directory
2. Verify `actions/__init__.py` exists
3. Check `actions/actions.py` for syntax errors

---

## 🏭 Production Deployment

### Step 1: Use Production WSGI Server

Replace Flask's development server with **Waitress** or **Gunicorn**:

```cmd
pip install waitress
```

Edit `actions/admin_api.py`:
```python
if __name__ == '__main__':
    from waitress import serve
    serve(app, host='0.0.0.0', port=80, threads=4)
```

### Step 2: Configure Firewall

1. Open **Windows Defender Firewall**
2. Click "Advanced Settings"
3. Create new Inbound Rules:
   - Port 5005 (Rasa Core)
   - Port 5055 (Actions Server)
   - Port 80 (Admin Dashboard)

### Step 3: Setup Reverse Proxy (Optional)

For production, use **Nginx** or **IIS** as reverse proxy:

**Using Nginx on Windows:**
1. Download Nginx: http://nginx.org/en/download.html
2. Extract to `C:\nginx`
3. Edit `conf/nginx.conf`:

```nginx
http {
    upstream rasa_core {
        server localhost:5005;
    }

    upstream admin_dashboard {
        server localhost:8080;
    }

    server {
        listen 80;
        server_name your-domain.com;

        location / {
            proxy_pass http://admin_dashboard;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        location /webhooks/rest/webhook {
            proxy_pass http://rasa_core;
            proxy_set_header Host $host;
        }
    }
}
```

4. Start Nginx:
```cmd
cd C:\nginx
start nginx
```

### Step 4: Enable HTTPS (Recommended)

1. Obtain SSL certificate (Let's Encrypt, Cloudflare, etc.)
2. Configure Nginx with SSL:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate C:/path/to/certificate.crt;
    ssl_certificate_key C:/path/to/private.key;

    # ... rest of configuration
}
```

### Step 5: Setup Automatic Backups

Create `backup_database.bat`:

```batch
@echo off
set BACKUP_DIR=C:\Project-IQ\backups
set TIMESTAMP=%date:~-4,4%%date:~-10,2%%date:~-7,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%

mkdir %BACKUP_DIR% 2>nul

"C:\Program Files\PostgreSQL\14\bin\pg_dump.exe" ^
  -U postgres ^
  -d rasa_conversations ^
  -F c ^
  -f "%BACKUP_DIR%\backup_%TIMESTAMP%.backup"

echo Backup completed: backup_%TIMESTAMP%.backup
```

Schedule this script using Windows Task Scheduler (daily at 2 AM):
```cmd
schtasks /create /tn "Rasa DB Backup" /tr "C:\Project-IQ\backup_database.bat" /sc daily /st 02:00
```

### Step 6: Monitoring and Logging

**Setup Log Rotation:**
Create `rotate_logs.bat`:

```batch
@echo off
cd C:\Project-IQ\Log

REM Archive logs older than 7 days
forfiles /p . /m *.log /d -7 /c "cmd /c move @file Archive\@file.%date:~-4,4%%date:~-10,2%%date:~-7,2%"

REM Delete archives older than 30 days
forfiles /p Archive /m *.* /d -30 /c "cmd /c del @file"
```

Schedule daily execution.

### Step 7: Performance Tuning

**Increase Rasa worker threads:**
```cmd
rasa run --enable-api --cors "*" --port 5005 --workers 4
```

**Optimize PostgreSQL:**
Edit `postgresql.conf`:
```ini
shared_buffers = 256MB
effective_cache_size = 1GB
maintenance_work_mem = 128MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
max_connections = 100
```

Restart PostgreSQL service after changes.

---

## 🔧 Maintenance

### Update Rasa Model

1. Make changes to training data (nlu.yml, stories.yml, rules.yml)
2. Train new model:
   ```cmd
   cd C:\Project-IQ
   venv\Scripts\activate
   rasa train
   ```
3. Restart Rasa Core service
4. New model will be loaded automatically

### Update Dependencies

```cmd
venv\Scripts\activate
pip install --upgrade rasa rasa-sdk
pip list --outdated
```

### Database Maintenance

**Vacuum and analyze:**
```cmd
psql -U postgres -d rasa_conversations -c "VACUUM ANALYZE;"
```

**Check database size:**
```cmd
psql -U postgres -d rasa_conversations -c "SELECT pg_size_pretty(pg_database_size('rasa_conversations'));"
```

### Monitor Service Health

Create `health_check.bat`:

```batch
@echo off
echo Checking service health...
echo.

curl -s http://localhost:5005/status && echo [OK] Rasa Core || echo [FAIL] Rasa Core
curl -s http://localhost:5055/health && echo [OK] Actions Server || echo [FAIL] Actions Server
curl -s http://localhost:80/admin/health/rasa && echo [OK] Admin Dashboard || echo [FAIL] Admin Dashboard

echo.
pause
```

Schedule this to run every 5 minutes and alert on failures.

---

## 📞 Support & Additional Resources

### Common URLs
- **Admin Dashboard**: http://localhost:80
- **Rasa API**: http://localhost:5005
- **Actions Server**: http://localhost:5055
- **Observability**: http://localhost:80/#observability
- **Studio**: http://localhost:80/#studio

### Useful Commands

```cmd
# Check service status
netstat -ano | findstr ":5005 :5055 :80"

# View real-time logs
powershell Get-Content Log\core.log -Wait

# Restart all services (if using NSSM)
net stop RasaCore RasaActions RasaAdmin
net start RasaCore RasaActions RasaAdmin

# Train model
rasa train

# Test NLU only
rasa shell nlu

# Interactive learning
rasa interactive
```

### Documentation Links
- Rasa Documentation: https://rasa.com/docs/rasa/
- PostgreSQL Documentation: https://www.postgresql.org/docs/
- Flask Documentation: https://flask.palletsprojects.com/

---

## 📝 Deployment Checklist

- [ ] Python 3.8-3.10 installed
- [ ] PostgreSQL installed and running
- [ ] Virtual environment created and activated
- [ ] All dependencies installed via pip
- [ ] Database created and configured
- [ ] Configuration files updated (endpoints.yml, app.config)
- [ ] Rasa model trained
- [ ] All three services started successfully
- [ ] Service health checks passing
- [ ] Admin dashboard accessible
- [ ] Chatbot responding to test messages
- [ ] Firewall rules configured (if needed)
- [ ] Backup script created and scheduled
- [ ] Monitoring setup (optional)
- [ ] Windows Services installed (production)
- [ ] SSL certificate configured (production)

---

## 🎉 Deployment Complete!

Your Project-IQ application should now be fully deployed and running on Windows.

For issues or questions, check the logs in the `Log/` directory or review the troubleshooting section above.

**Happy Chatbot Building! 🤖**
