# Infisical Secret Management Setup

Secure your chatbot secrets using **Infisical Cloud** (free tier available).

## Quick Start (5 minutes)

### 1. Create Infisical Account

Go to **https://app.infisical.com** and sign up (free).

### 2. Create Project & Add Secrets

1. Click **Create Project** → Name it "ChatBot"
2. Select **prod** environment
3. Click **Add Secret** and add these:

| Secret Key | Your Value |
|------------|------------|
| `GLPI_API_URL` | `http://your-glpi-ip:8083/apirest.php` |
| `GLPI_APP_TOKEN` | Your GLPI app token |
| `GLPI_USER_TOKEN` | Your GLPI user token |
| `DB_HOST` | Your PostgreSQL IP |
| `DB_PORT` | `5432` |
| `DB_NAME` | `ChatBot` |
| `DB_USER` | `postgres` |
| `DB_PASSWORD` | Your database password |

### 3. Create Machine Identity

1. Go to **Project Settings** → **Machine Identities**
2. Click **Create** → Name it "chatbot-app"
3. Copy the **Client ID** and **Client Secret**
4. Get **Project ID** from URL: `app.infisical.com/project/[PROJECT_ID]/...`

### 4. Set Environment Variables

**PowerShell:**
```powershell
$env:INFISICAL_CLIENT_ID = "your-client-id"
$env:INFISICAL_CLIENT_SECRET = "your-client-secret"
$env:INFISICAL_PROJECT_ID = "your-project-id"
$env:INFISICAL_ENVIRONMENT = "prod"
```

**Or create `.env` file:**
```
INFISICAL_CLIENT_ID=your-client-id
INFISICAL_CLIENT_SECRET=your-client-secret
INFISICAL_PROJECT_ID=your-project-id
INFISICAL_ENVIRONMENT=prod
```

### 5. Install & Run

```powershell
pip install infisical-python
.\start_all.ps1
```

## Fallback Behavior

- ✅ If Infisical configured → Uses cloud secrets
- ✅ If not configured → Uses local `app.config` file

## Self-Hosted Option

If you prefer self-hosting, use the included Docker Compose:
```powershell
docker-compose -f docker-compose.infisical.yml up -d
# Then set: INFISICAL_SITE_URL=http://localhost:8089
```
