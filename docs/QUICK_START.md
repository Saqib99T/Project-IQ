# Quick Start Guide - Project-IQ

## 🚀 5-Minute Setup

### Prerequisites
- Windows 10/11 or Windows Server 2016+
- Python 3.8, 3.9, or 3.10
- PostgreSQL 12+
- 8GB RAM minimum

### Step 1: Run Setup Wizard

1. **Right-click `setup.bat`** and select **"Run as Administrator"**
2. Follow the prompts - the script will:
   - Check Python installation
   - Create virtual environment
   - Install all dependencies
   - Create necessary directories
   - Optionally train the Rasa model

**Time:** ~15 minutes (depending on internet speed)

### Step 2: Configure Database

1. Create PostgreSQL database:
   ```sql
   CREATE DATABASE rasa_conversations;
   ```

2. Edit `actions/conversation_db.py`:
   ```python
   DB_CONFIG = {
       'host': 'localhost',
       'port': 5432,
       'database': 'rasa_conversations',
       'user': 'postgres',
       'password': 'YOUR_PASSWORD_HERE'  # Change this!
   }
   ```

3. Edit `endpoints.yml`:
   ```yaml
   tracker_store:
     type: sql
     dialect: postgresql
     host: localhost
     port: 5432
     db: rasa_conversations
     username: postgres
     password: YOUR_PASSWORD_HERE  # Change this!
   ```

### Step 3: Start Services

**Right-click `start_services.bat`** and select **"Run as Administrator"**

Three windows will open:
- **Rasa Core** (Port 5005)
- **Actions Server** (Port 5055)
- **Admin Dashboard** (Port 80)

Wait ~30 seconds for all services to initialize.

### Step 4: Access Application

Open your browser and go to:
```
http://localhost:80
```

You should see the Admin Dashboard!

---

## 🎯 Usage

### Admin Dashboard Features

**Navigation:**
- 📊 **Analytics** - View conversation metrics and statistics
- 🔧 **Configuration** - Manage GLPI settings and API tokens
- 🎨 **Themes** - Customize chatbot widget appearance
- 🔍 **Inspector** - View and analyze conversation history
- 👁️ **Observability** - Monitor system health and performance
- 🎪 **Studio** - Manage NLU data, stories, and responses

### Testing the Chatbot

**Method 1: Via Studio Page**
1. Go to Admin Dashboard → Studio
2. Use the "Live Test Console" on the left
3. Type a message and press Enter

**Method 2: Via API**
```bash
curl -X POST http://localhost:5005/webhooks/rest/webhook \
  -H "Content-Type: application/json" \
  -d '{"sender":"test_user","message":"hello"}'
```

**Method 3: Embed Widget**
Add to your website:
```html
<script src="http://localhost:80/widget.js"></script>
<script>
  RasaWidget.init({
    socketUrl: 'http://localhost:5005',
    customData: {app_id: 'your-app-id'},
    title: 'IT Support Bot'
  });
</script>
```

---

## 🛠️ Common Tasks

### Start Services
```cmd
start_services.bat
```

### Stop Services
```cmd
stop_services.bat
```

### Check Service Health
```cmd
health_check.bat
```

### Train New Model
```cmd
venv\Scripts\activate
rasa train
```

### Backup Database
```cmd
backup_database.bat
```

### View Logs
```cmd
type Log\core.log
type Log\actions.log
type admin_new.err
```

---

## 📁 Project Structure

```
Project-IQ/
├── actions/                 # Custom action code
│   ├── actions.py          # Main actions file
│   ├── admin_api.py        # Admin dashboard API
│   ├── conversation_db.py  # Database connection
│   └── glpi_service.py     # GLPI integration
├── client_ui/              # Admin dashboard frontend
│   ├── dist-widget/        # Production widget files
│   └── public/             # Development files
├── data/                   # Training data
│   ├── nlu.yml            # Intent examples
│   ├── stories.yml        # Conversation flows
│   └── rules.yml          # Rules and fallbacks
├── Log/                    # Application logs
├── models/                 # Trained Rasa models
├── venv/                   # Python virtual environment
├── domain.yml             # Rasa domain configuration
├── config.yml             # Rasa NLU pipeline config
├── endpoints.yml          # Service endpoints config
├── app.config             # Application configuration
├── start_services.bat     # Start all services
├── stop_services.bat      # Stop all services
├── health_check.bat       # Check service health
├── setup.bat              # Initial setup wizard
└── DEPLOYMENT_GUIDE.md    # Full deployment guide
```

---

## 🔧 Troubleshooting

### Services Won't Start

**Check if ports are in use:**
```cmd
netstat -ano | findstr ":5005 :5055 :80"
```

**Kill processes on those ports:**
```cmd
stop_services.bat
```

### Database Connection Error

1. Verify PostgreSQL is running:
   ```cmd
   sc query postgresql-x64-14
   ```

2. Start if not running:
   ```cmd
   net start postgresql-x64-14
   ```

3. Check credentials in `conversation_db.py` and `endpoints.yml`

### Module Not Found

Ensure virtual environment is activated:
```cmd
venv\Scripts\activate
pip install -r requirements.txt
```

### Model Not Found

Train a new model:
```cmd
venv\Scripts\activate
rasa train
```

### Port 80 Permission Denied

Either:
- Run as Administrator, OR
- Change port in `actions/admin_api.py` to 8080

---

## 📊 Monitoring

### System Health

Run health check:
```cmd
health_check.bat
```

Expected output:
```
[OK] Rasa Core is healthy
[OK] Actions Server is healthy
[OK] Admin Dashboard is healthy
```

### View Real-Time Logs

**PowerShell:**
```powershell
Get-Content Log\core.log -Wait
```

**Or use the Admin Dashboard:**
Go to Observability → System Logs

---

## 🔒 Security Considerations

### For Production:

1. **Change Default Credentials**
   - Update admin password in database
   - Change PostgreSQL password

2. **Use HTTPS**
   - Configure SSL certificate
   - Setup reverse proxy (Nginx/IIS)

3. **Restrict Ports**
   - Only expose port 80/443 externally
   - Keep 5005 and 5055 internal

4. **Enable Authentication**
   - Implement JWT tokens
   - Add session management

5. **Regular Backups**
   - Schedule daily database backups
   - Store backups securely offsite

---

## 📞 Need Help?

1. **Check Logs:** `Log/` directory
2. **Read Full Guide:** `DEPLOYMENT_GUIDE.md`
3. **Check Service Health:** `health_check.bat`
4. **Review Configuration:** Verify all config files

---

## 🎉 Success!

If you can access http://localhost:80 and see the dashboard, you're all set!

**Next Steps:**
- Customize responses in `domain.yml`
- Add more training examples in `data/nlu.yml`
- Configure GLPI integration in `app.config`
- Customize widget theme in Admin Dashboard → Themes
- Monitor conversations in Admin Dashboard → Inspector

**Happy Chatbot Building! 🤖**
