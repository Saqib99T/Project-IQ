# 📦 Project IQ - External Libraries & Tools Inventory

**Document Version:** 1.0  
**Last Updated:** January 26, 2026  
**Application:** Project IQ - Rasa-based IT Support Chatbot

---

## Table of Contents
1. [Backend Dependencies (Python)](#backend-dependencies)
2. [Frontend Dependencies (JavaScript/Node)](#frontend-dependencies)
3. [External Systems & Services](#external-systems)
4. [Build & Development Tools](#build--development-tools)
5. [Infrastructure & DevOps](#infrastructure--devops)
6. [Summary Table](#summary-table)
7. [Dependency Graph](#dependency-graph)

---

## Backend Dependencies

### Core Framework Stack

#### 🎯 **Rasa** (v3.6.20)
- **Purpose:** Open-source conversational AI framework for building the chatbot
- **Usage:** 
  - NLU (Intent/Entity classification)
  - Core dialogue management
  - Policy-based response generation
- **Key Files:** `domain.yml`, `nlu.yml`, `stories.yml`, `rules.yml`, `data/`
- **Port:** 5005 (Rasa Core server)
- **Dependencies:** TensorFlow/PyTorch, Sanic (async web framework)

#### 🚀 **Rasa-SDK** (v3.6.2)
- **Purpose:** SDK for developing custom actions in Python
- **Usage:**
  - Execute custom business logic (GLPI integration, KB search, etc.)
  - `ActionGlpiLogin`, `ActionCreateGlpiTicket`, `ActionSearchKnowledgeBase`, etc.
- **Key Files:** `actions/actions.py`, `actions/*.py` (all action handlers)
- **Port:** 5055 (Action Server)

#### 📦 **Pydantic** (v1.10.9)
- **Purpose:** Data validation and settings management
- **Usage:** Validate request/response schemas, configuration objects
- **Key Files:** Config models in `actions/config_manager.py`

#### 📦 **Typing-extensions** (v4.5.0)
- **Purpose:** Backport of Python typing features for compatibility
- **Usage:** Type hints in codebase

#### 📦 **Packaging** (v20.9)
- **Purpose:** Core utilities for handling package versions
- **Usage:** Version comparison, dependency management

---

### Web Framework & API

#### 🌐 **Flask** (v3.0.0)
- **Purpose:** Lightweight Python web framework for Admin API
- **Usage:**
  - REST API endpoints for admin dashboard
  - Static file serving (HTML, CSS, JS)
  - Configuration management routes
  - Analytics endpoints
- **Key Files:** `actions/admin_api.py`
- **Port:** 80/8181 (Admin API)
- **Endpoints:** `/admin/*, /themes/*, /config/*, /health/*`

#### 🔌 **Flask-CORS** (v4.0.0)
- **Purpose:** Cross-Origin Resource Sharing support
- **Usage:** Allow frontend to call backend from different origin
- **Key Files:** `actions/admin_api.py` (CORS initialization)

#### ⚙️ **Werkzeug** (v3.0.1)
- **Purpose:** WSGI utilities and HTTP handling
- **Usage:** HTTP request/response handling (used by Flask)
- **Dependencies:** Flask dependency

---

### Database & ORM

#### 🗄️ **PostgreSQL** (via `psycopg2-binary` v2.9.9)
- **Purpose:** Production-grade relational database
- **Usage:**
  - Conversation tracker store (messages, sessions)
  - User feedback and ratings storage
  - Analytics data persistence
  - Theme and configuration storage
- **Key Files:** `actions/conversation_db.py`, `actions/analytics_store.py`
- **Database:** `Chatbot` (default, configurable)
- **Tables:** `conversations`, `messages`, `feedback`, `themes`, `chat_apps`, etc.
- **Port:** 5432

#### 🔌 **psycopg2-binary** (v2.9.9)
- **Purpose:** PostgreSQL Python adapter/driver
- **Usage:** Direct database connection and queries
- **Key Files:** `actions/conversation_db.py`

#### 🛢️ **SQLAlchemy** (<2.0)
- **Purpose:** Python SQL toolkit and Object Relational Mapper
- **Usage:**
  - Rasa tracker store ORM mapping
  - Database connection pooling
  - Query building
- **Key Files:** `endpoints.yml` (tracker_store configuration)
- **Important:** Pinned to <2.0 for Rasa 3.6 compatibility

---

### Secrets & Configuration

#### 🔐 **Infisical SDK** (>=1.0.14)
- **Purpose:** Enterprise secrets management integration
- **Usage:**
  - Retrieve sensitive credentials from Infisical vault
  - Manage API keys, tokens securely
  - Support multiple environments (dev/prod)
- **Key Files:** `actions/config_manager.py`
- **Credentials:** GLPI tokens, DB passwords, API keys
- **Fallback:** Local `.env` file if Infisical unavailable

#### 📋 **python-dotenv** (v1.0.0)
- **Purpose:** Load environment variables from `.env` files
- **Usage:**
  - Load database credentials
  - Rasa API configuration
  - Local development setup
- **Key Files:** `.env` (config file), `actions/config_manager.py`
- **Config Keys:**
  ```
  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
  GLPI_API_URL, GLPI_APP_TOKEN, GLPI_USER_TOKEN
  RASA_API_URL
  ```

---

### Machine Learning & Search

#### 🧠 **Sentence-Transformers** (v2.3.1)
- **Purpose:** Generate semantic embeddings for Knowledge Base search
- **Usage:**
  - Create vector embeddings for KB articles
  - Semantic similarity matching
  - Hybrid search (semantic + keyword matching)
- **Model:** `all-MiniLM-L6-v2` (384-dim embeddings)
- **Key Files:** `actions/kb_cache_manager.py`
- **Dependencies:** PyTorch or TensorFlow (auto-installed)

---

### System Monitoring & Performance

#### 📊 **psutil** (v7.2.1)
- **Purpose:** Cross-platform library for retrieving system & process information
- **Usage:**
  - Monitor CPU usage
  - Track memory consumption
  - Disk space monitoring
  - Process status checks
- **Key Files:** `actions/process_monitor.py`
- **Admin Panel:** System Observability dashboard displays real-time metrics

---

### Data Processing

#### 📄 **PyYAML** (v6.0.1)
- **Purpose:** Parse and generate YAML files
- **Usage:**
  - Read `domain.yml`, `nlu.yml`, `stories.yml`, `rules.yml`
  - Write configuration files
  - Validate YAML syntax
- **Key Files:** `domain.yml`, `endpoints.yml`, multiple action files
- **Critical For:** Rasa configuration, story/rule definitions

---

### HTTP Client

#### 🌐 **Requests** (v2.31.0)
- **Purpose:** HTTP library for making API requests
- **Usage:**
  - Call GLPI REST API (tickets, KB articles)
  - Communicate with Rasa core/actions
  - Call Infisical API
  - External webhook calls
- **Key Files:** `actions/glpi_service.py`, `actions/config_manager.py`, custom actions
- **Common Endpoints:**
  - GLPI: `http://localhost:8083/apirest.php/*`
  - Rasa: `http://localhost:5005/*`
  - Infisical: `https://app.infisical.com/api/v1/*`

---

### Production Server (Optional)

#### 🚀 **Waitress** (v2.1.2)
- **Purpose:** WSGI application server for production deployment
- **Usage:** Alternative to Flask dev server for production
- **When Used:** Production environment (optional, not in dev setup)
- **Benefits:** Better concurrency handling, stability

---

### Testing (Optional)

#### 🧪 **pytest** (v7.4.3)
- **Purpose:** Python testing framework
- **Usage:** Unit tests, integration tests
- **Test Files:** `tests/` directory (if present)

---

## Frontend Dependencies

### UI Framework

#### ⚛️ **React** (v19.2.0)
- **Purpose:** JavaScript library for building UI components
- **Usage:**
  - Admin dashboard components
  - Chat widget UI
  - Studio interface
  - Admin analytics/config panels
- **Key Files:** `client_ui/src/components/*.jsx`, `client_ui/src/App.jsx`

#### 🎨 **React-DOM** (v19.2.0)
- **Purpose:** React rendering for web browsers
- **Usage:** Render React components to DOM
- **Key Files:** `client_ui/src/main.jsx`

---

### Styling & CSS

#### 🎨 **TailwindCSS** (v3.4.17)
- **Purpose:** Utility-first CSS framework
- **Usage:**
  - Style admin dashboard
  - Style chat widget
  - Responsive design
  - Theme customization
- **Key Files:** `client_ui/tailwind.config.js`, `client_ui/src/*.css`
- **Build:** Compiled during Vite build

#### 🔧 **PostCSS** (v8.4.35)
- **Purpose:** Tool for transforming CSS
- **Usage:**
  - Process Tailwind directives
  - Autoprefixing
- **Key Files:** `client_ui/postcss.config.js`

#### 🚀 **Autoprefixer** (v10.4.18)
- **Purpose:** PostCSS plugin to add vendor prefixes
- **Usage:**
  - CSS compatibility across browsers
  - Automatic prefix generation
- **Key Files:** Part of PostCSS pipeline

#### 🔀 **Tailwind-Merge** (v3.4.0)
- **Purpose:** Merge Tailwind CSS class lists intelligently
- **Usage:**
  - Avoid conflicting Tailwind classes
  - Theme override handling
- **Key Files:** `client_ui/src/components/*.jsx` (conditional styling)

---

### Icons & UI Components

#### 🎯 **Lucide-React** (v0.561.0)
- **Purpose:** Beautiful, consistent SVG icon library
- **Usage:**
  - Admin dashboard icons
  - Chat widget icons (send, attach, etc.)
  - UI iconography
- **Icons Used:** Send, Paperclip, Minimize, Trash, User, Lock, etc.

---

### Content & Markdown

#### 📝 **React-Markdown** (v10.1.0)
- **Purpose:** Render Markdown to React components
- **Usage:**
  - Display markdown formatted bot responses
  - Knowledge Base article display
  - Rich text formatting
- **Key Files:** `client_ui/src/components/*.jsx`

#### 📐 **Remark-GFM** (v4.0.1)
- **Purpose:** GitHub Flavored Markdown plugin for remark
- **Usage:**
  - Support tables, strikethrough, etc.
  - Enhanced markdown features
- **Dependencies:** React-Markdown plugin

---

### Utilities

#### 🔑 **UUID** (v13.0.0)
- **Purpose:** Generate universally unique identifiers
- **Usage:**
  - Create unique message IDs
  - Session identifiers
  - Widget instance IDs
- **Key Files:** `client_ui/src/components/ChatWindow.jsx`

#### 🗂️ **clsx** (v2.1.1)
- **Purpose:** Utility for constructing className strings
- **Usage:**
  - Conditional CSS class application
  - Theme-based styling
- **Key Files:** `client_ui/src/components/*.jsx`

---

### Animations

#### ✨ **Framer-Motion** (v12.23.26)
- **Purpose:** Animation library for React
- **Usage:**
  - Chat widget animations
  - Message transitions
  - UI element animations
  - Smooth page transitions
- **Key Files:** `client_ui/src/components/*.jsx`

---

## Build Tools

### Core Build System

#### ⚡ **Vite** (v7.2.4)
- **Purpose:** Next-generation frontend build tool and dev server
- **Usage:**
  - Development server (`npm run dev`)
  - Production bundle creation (`npm run build`)
  - Widget compilation (`npm run build:widget`)
  - Hot module replacement (HMR)
- **Key Files:**
  - `client_ui/vite.config.js` - Main config
  - `client_ui/vite.widget.config.js` - Widget-specific config
- **Output:**
  - `client_ui/dist/` - Admin dashboard
  - `client_ui/dist-widget/` - Embeddable widget (`glpi-chat-widget.js`)

#### 🔌 **@vitejs/plugin-react** (v5.1.1)
- **Purpose:** React plugin for Vite
- **Usage:**
  - JSX transformation
  - Fast refresh during development
- **Key Files:** `client_ui/vite.config.js`

---

### Code Quality

#### 🔍 **ESLint** (v9.39.1)
- **Purpose:** JavaScript linter for code quality
- **Usage:**
  - Find and fix problems in code
  - Enforce coding standards
  - Style consistency
- **Key Files:** `client_ui/.eslintrc.cjs`
- **Plugins:**
  - `@eslint/js`
  - `eslint-plugin-react-hooks`
  - `eslint-plugin-react-refresh`

#### 🌍 **Globals** (v16.5.0)
- **Purpose:** Global variable definitions for ESLint
- **Usage:**
  - Configure ESLint aware of browser/Node globals

---

### Type Safety

#### 📘 **@types/react** (v19.2.5)
- **Purpose:** TypeScript type definitions for React
- **Usage:**
  - Type checking in React components
  - IDE autocomplete

#### 📘 **@types/react-dom** (v19.2.3)
- **Purpose:** TypeScript type definitions for React-DOM
- **Usage:**
  - Type checking for DOM rendering

---

### Server for Widget

#### 🌐 **http-server** (npm, used via script)
- **Purpose:** Simple HTTP server for static files
- **Usage:**
  - Serve the compiled widget (`dist-widget/`)
  - Allow embed testing on different ports
- **Command:** `npx -y http-server dist-widget -p 8181 --cors -c-1`
- **Port:** 8181 (widget serving)
- **Flags:** CORS enabled, no cache

---

## External Systems & Services

### GLPI (ITSM)

#### 🏢 **GLPI** (External System)
- **Purpose:** IT Service Management platform
- **Integration Method:** REST API
- **API Endpoint:** `http://localhost:8083/apirest.php`
- **Operations:**
  - Create/read/update tickets
  - Knowledge base articles
  - User authentication
  - Entity/department management
- **Authentication:** App Token + User Token
- **Key Files:** `actions/glpi_service.py`
- **Tokens Stored In:** Infisical or `.env`

---

### Infisical Vault

#### 🔐 **Infisical** (External Secrets Service)
- **Purpose:** Enterprise secrets vault
- **Integration Method:** HTTP API + SDK
- **API Endpoint:** `https://app.infisical.com/api/v1/`
- **Operations:**
  - Retrieve API tokens
  - Store database credentials
  - Environment-based secrets
- **Fallback:** Local `.env` if Infisical unavailable
- **Key Files:** `actions/config_manager.py`
- **Credentials:** Universal Auth client ID & secret

---

### Rasa Services

#### 🤖 **Rasa Core** (Internal Service)
- **Purpose:** NLU and dialogue management engine
- **Port:** 5005
- **API Endpoints:**
  - `/webhooks/rest/webhook` - Chat messages
  - `/model/parse` - NLU analysis
  - `/domain` - Domain retrieval
  - `/conversations/{id}/tracker` - Conversation history

#### 🔧 **Rasa Action Server** (Internal Service)
- **Purpose:** Execute custom actions
- **Port:** 5055
- **API Endpoints:**
  - `/webhook` - Receive action requests
  - `/health` - Health check

---

## Infrastructure & DevOps

### Containerization

#### 🐳 **Docker** (Container Runtime)
- **Purpose:** Package application in containers
- **Key Files:** `Dockerfile` (if present), `docker-compose.yml`, `docker-compose.infisical.yml`
- **Containers:**
  - Rasa Core container
  - Action Server container
  - Admin API container
  - PostgreSQL container
  - GLPI container
  - Nginx container

#### 🎭 **Docker Compose** (Container Orchestration)
- **Purpose:** Define and run multi-container applications
- **Configs:**
  - `docker-compose.yml` - Base configuration
  - `docker-compose.infisical.yml` - With Infisical integration
- **Services:** Rasa, Actions, Admin, Database, Nginx, GLPI

---

### Reverse Proxy & Load Balancing

#### 🌐 **Nginx** (Reverse Proxy)
- **Purpose:** HTTP reverse proxy and load balancer
- **Usage:**
  - Unified entry point (port 80/443)
  - Route requests to backend services
  - SSL/TLS termination
  - Static file serving
- **Routes:**
  - `/` → Admin API (port 80)
  - `/webhooks/*` → Rasa Core (port 5005)
  - `/actions/*` → Action Server (port 5055)
- **Key Files:** Nginx config (in deployment)

---

### Version Control

#### 📝 **Git** (Version Control System)
- **Purpose:** Source code version control
- **Usage:**
  - Track code changes
  - Branching and merging
  - Collaborative development
- **Key Files:** `.git/`, `.gitignore`

---

### Runtime

#### 🐍 **Python 3.x** (Runtime)
- **Purpose:** Python interpreter for backend
- **Version:** 3.8+ (recommended 3.10+)
- **Package Manager:** pip
- **Virtual Environment:** venv/conda

#### 📦 **Node.js** (JavaScript Runtime)
- **Purpose:** JavaScript runtime for frontend build & serving
- **Package Manager:** npm
- **Key Files:** `package.json`, `package-lock.json`

---

## Development Tools & Scripts

### Shell Scripts (Windows)

#### 💾 **Batch/PowerShell Scripts**
- `start_services.bat` - Start all services
- `stop_services.bat` - Stop all services
- `restart_services.bat` - Restart all services
- `restart_admin_api.bat` - Restart admin API
- `setup.bat` - Initial setup
- `backup_database.bat` - Backup PostgreSQL
- `restore_database.bat` - Restore from backup
- `health_check.bat` - Health check script

#### 💻 **PowerShell Scripts**
- `start_all.ps1` - Start services (PS version)
- `test_departments.ps1` - Department testing

---

## Summary Table

| Library | Version | Type | Purpose | Key File(s) |
|---------|---------|------|---------|------------|
| **rasa** | 3.6.20 | Framework | NLU + Dialogue | domain.yml, nlu.yml, stories.yml |
| **rasa-sdk** | 3.6.2 | SDK | Custom Actions | actions/actions.py |
| **flask** | 3.0.0 | Framework | Admin API | actions/admin_api.py |
| **flask-cors** | 4.0.0 | Middleware | CORS Support | actions/admin_api.py |
| **psycopg2-binary** | 2.9.9 | Driver | PostgreSQL | actions/conversation_db.py |
| **sqlalchemy** | <2.0 | ORM | Database Access | endpoints.yml |
| **pydantic** | 1.10.9 | Validation | Data Validation | config models |
| **infisicalsdk** | >=1.0.14 | SDK | Secrets | actions/config_manager.py |
| **python-dotenv** | 1.0.0 | Config | .env Loading | .env |
| **sentence-transformers** | 2.3.1 | ML | KB Embeddings | actions/kb_cache_manager.py |
| **psutil** | 7.2.1 | Monitoring | System Stats | actions/process_monitor.py |
| **pyyaml** | 6.0.1 | Parser | YAML Processing | All config files |
| **requests** | 2.31.0 | HTTP | API Calls | actions/glpi_service.py |
| **waitress** | 2.1.2 | Server | WSGI Server | (optional) |
| **pytest** | 7.4.3 | Testing | Unit Tests | tests/ |
| **react** | 19.2.0 | Framework | UI Components | client_ui/src/ |
| **react-dom** | 19.2.0 | Library | DOM Rendering | client_ui/src/ |
| **vite** | 7.2.4 | Build Tool | Build System | client_ui/vite.config.js |
| **tailwindcss** | 3.4.17 | CSS | Styling | client_ui/tailwind.config.js |
| **framer-motion** | 12.23.26 | Animation | UI Animation | client_ui/src/components/ |
| **lucide-react** | 0.561.0 | Icons | Icon Library | client_ui/src/components/ |
| **uuid** | 13.0.0 | Utility | ID Generation | client_ui/src/components/ |
| **react-markdown** | 10.1.0 | Component | Markdown Rendering | client_ui/src/components/ |

---

## Dependency Graph

```
Project-IQ
│
├── Backend Services
│   ├── Rasa Core (v3.6.20)
│   │   ├── TensorFlow/PyTorch
│   │   ├── Sanic (async web)
│   │   └── YAML (v6.0.1)
│   │
│   ├── Action Server (rasa-sdk v3.6.2)
│   │   ├── Flask (v3.0.0)
│   │   ├── Requests (v2.31.0)
│   │   ├── psycopg2 (v2.9.9)
│   │   ├── SQLAlchemy (<2.0)
│   │   ├── sentence-transformers (v2.3.1)
│   │   ├── psutil (v7.2.1)
│   │   ├── Infisical SDK (>=1.0.14)
│   │   └── python-dotenv (v1.0.0)
│   │
│   └── Admin API (Flask v3.0.0)
│       ├── Flask-CORS (v4.0.0)
│       ├── Werkzeug (v3.0.1)
│       └── Static Files (HTML/CSS/JS)
│
├── Frontend Stack
│   ├── Build System: Vite (v7.2.4)
│   │   ├── @vitejs/plugin-react (v5.1.1)
│   │   └── TailwindCSS (v3.4.17)
│   │       ├── PostCSS (v8.4.35)
│   │       └── Autoprefixer (v10.4.18)
│   │
│   ├── UI Framework: React (v19.2.0)
│   │   ├── React-DOM (v19.2.0)
│   │   ├── Framer-Motion (v12.23.26)
│   │   ├── Lucide-React (v0.561.0)
│   │   ├── UUID (v13.0.0)
│   │   ├── clsx (v2.1.1)
│   │   ├── Tailwind-Merge (v3.4.0)
│   │   ├── React-Markdown (v10.1.0)
│   │   └── Remark-GFM (v4.0.1)
│   │
│   └── Code Quality: ESLint (v9.39.1)
│       ├── @eslint/js
│       ├── eslint-plugin-react-hooks
│       └── eslint-plugin-react-refresh
│
├── External Services
│   ├── GLPI (REST API)
│   ├── Infisical (Secrets Vault)
│   ├── PostgreSQL (Database)
│   └── Nginx (Reverse Proxy)
│
└── DevOps
    ├── Docker (Containerization)
    ├── Docker Compose (Orchestration)
    └── Git (Version Control)
```

---

## Licensing Summary

| Dependency | License | Type |
|------------|---------|------|
| Rasa | Apache 2.0 | Open Source |
| Flask | BSD-3-Clause | Open Source |
| React | MIT | Open Source |
| TailwindCSS | MIT | Open Source |
| PostgreSQL | PostgreSQL | Open Source |
| Docker | Apache 2.0 | Open Source |
| Nginx | BSD-2-Clause | Open Source |
| sentence-transformers | Apache 2.0 | Open Source |
| Framer-Motion | MIT | Open Source |

---

## Installation Commands

### Backend Dependencies
```bash
pip install -r requirements.txt
```

### Frontend Dependencies
```bash
cd client_ui
npm install
```

### Build Frontend
```bash
npm run build
npm run build:widget
```

---

## Environment Requirements

| Component | Requirement |
|-----------|-------------|
| **OS** | Windows, Linux, macOS |
| **Python** | 3.8+ (recommend 3.10+) |
| **Node.js** | 16+ (recommend 18+) |
| **RAM** | 4GB minimum (8GB+ recommended) |
| **Disk** | 5GB minimum |
| **Database** | PostgreSQL 12+ |
| **Docker** | v20+ (for containerized deployment) |

---

## Critical Version Constraints

### ⚠️ Important Pinning Notes

1. **SQLAlchemy <2.0**
   - Rasa 3.6 is not compatible with SQLAlchemy 2.0+
   - Must be pinned to v1.x series

2. **Rasa 3.6.20**
   - Requires specific versions of dependencies
   - TensorFlow 2.12+ or PyTorch 1.12+
   - Compatible with Python 3.8-3.11

3. **React 19.2.0**
   - Modern React with concurrent features
   - Requires Node 16+

4. **TailwindCSS 3.4.17**
   - Requires PostCSS 8+
   - Node 14+

---

## Monitoring & Health Checks

### Health Check Endpoints

| Service | Endpoint | Port |
|---------|----------|------|
| Rasa Core | `http://localhost:5005/health` | 5005 |
| Action Server | `http://localhost:5055/health` | 5055 |
| Admin API | `http://localhost:80/health` or `http://localhost:8181/health` | 80/8181 |
| PostgreSQL | Connection via `psycopg2` | 5432 |

---

## Troubleshooting

### Common Dependency Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Rasa import error | TensorFlow not installed | `pip install tensorflow` |
| Flask port conflict | Port 80 already in use | Change port or stop conflicting service |
| React build fails | Node version too old | Upgrade to Node 16+ |
| DB connection error | PostgreSQL not running | Start PostgreSQL service |
| CORS errors | Flask-CORS not configured | Check `admin_api.py` CORS setup |
| Sentence-transformers slow | Model not cached | First run downloads 500MB+ model |

---

## Additional Resources

- [Rasa Documentation](https://rasa.com/docs)
- [Flask Documentation](https://flask.palletsprojects.com)
- [React Documentation](https://react.dev)
- [TailwindCSS Documentation](https://tailwindcss.com)
- [PostgreSQL Documentation](https://www.postgresql.org/docs)
- [Docker Documentation](https://docs.docker.com)

---

**Document Status:** ✅ Complete  
**Last Updated:** January 26, 2026  
**Maintained By:** Project IQ Team
