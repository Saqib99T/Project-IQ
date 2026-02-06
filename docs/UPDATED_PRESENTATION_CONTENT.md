# Project IQ - AI-Powered GLPI Support Chatbot
## Presentation Content (Updated January 2026)

---

# Slide 1: Title

## Project IQ - IT Support Chatbot
### AI-Powered Conversational Interface for GLPI Ticketing

**Powered by:**
- Rasa 3.x (Open Source NLU)
- GLPI Integration (REST API)
- PostgreSQL Database (Full Conversation History)
- Modern React Widget (Glassmorphism)

---

# Slide 2: What is Project IQ?

## AI-Powered IT Support Assistant

🎫 **Create Tickets** - Natural language ticket creation with smart categorization

📋 **View & Track** - Real-time ticket status and history

🔍 **Smart Knowledge Base** - Hybrid search (Semantic + Keyword) with Caching

📊 **Analytics** - Comprehensive conversation, intent, and KB usage analytics

🛠️ **Admin Dashboard** - Full management, KB cache control, and monitoring

---

# Slide 3: Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      User Interface                      │
│           (React Chat Widget / Admin Dashboard)          │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                    Flask API Layer                       │
│              (Admin API / Analytics API)                 │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                    Rasa Open Source                      │
│           NLU (DIET Classifier + Response Selector)     │
│           Dialogue Management (Stories/Rules)           │
│           Custom Actions & Tracker Store (Python)       │
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    ┌─────────┐    ┌──────────┐    ┌─────────┐
    │  GLPI   │    │PostgreSQL│    │Cached KB│
    │  API    │    │ Logs/Hist│    │(Hybrid) │
    └─────────┘    └──────────┘    └─────────┘
```

---

# Slide 4: Core Features (Completed ✅)

## Conversational Ticket Management

| Feature | Description |
|---------|-------------|
| 🎫 **Create Tickets** | Natural language → GLPI ticket with smart extraction |
| 📋 **List Tickets** | View all open/closed tickets |
| 🔍 **Check Status** | Real-time ticket status lookup with login enforcement |
| ✏️ **Update Tickets** | Add comments, change status |
| 📎 **File Attachments** | Drag & drop uploads to tickets |
| 📚 **Smart KB Search** | **NEW:** Cache-backed, hybrid search (e.g., "vpn issue") |
| 📊 **Charts & Graphs** | Visual ticket statistics in-chat |
| ⭐ **Satisfaction Rating** | 1-5 star feedback collection |

---

# Slide 5: Admin Dashboard (Completed ✅)

## Comprehensive Management Suite

### 📊 Analytics
- Total conversations, messages, feedback
- Intent distribution charts
- Resolution rates & KB usage stats

### 📚 Knowledge Base Management
- **NEW:** "Project IQ KB" integration
- **NEW:** Admin Cache Control (View status, Manual Refresh)
- Pagination & Search for cached articles

### 🔍 Inspector
- Real-time conversation debugging
- Turn-by-turn NLU analysis & Slot visualization

### 🔒 Login & Security
- Secure GLPI Authentication
- Session Management with token handling

---

# Slide 6: Observability (Completed ✅)

## Real-Time Monitoring

| Component | Metrics |
|-----------|---------|
| **Rasa Core** | Status, PID, Memory, Uptime |
| **Action Server** | Status, Request Count, Errors |
| **Custom Tracker** | **NEW:** Full Postgres Conversation logging |
| **Logs** | Real-time log viewer (Action/Core/Admin) |

### Features:
- Auto-refresh (10s intervals)
- Process health alerts
- Log search and analysis

---

# Slide 7: Recent Technical Wins (2026 Updates)

1.  **Robust NLU Training**:
    - Added **150+** new asset-related training examples.
    - Optimized for short queries (e.g., "printer issue", "vpn down").

2.  **Optimized KB Performance**:
    - Implemented **Local Caching** for KB articles in Admin UI.
    - Prevents unnecessary API calls to GLPI on every page load.
    - Manual refresh capability for admins.

3.  **Enhanced Logging**:
    - **Custom Tracker Store** implemented.
    - Captures **every** user and bot message to PostgreSQL for audit trails.
    - Fixes previous gaps in conversation history.

---

# Slide 8: Future Roadmap with AI Estimations

## Planned Enhancements & Delivery Timeline

| Feature | Description | Traditional Est. | **AI-Agent Est.** |
|---------|-------------|------------------|-------------------|
| 🎙️ **Voice Interface** | Speech-to-Text inputs for hands-free support | 3-4 Weeks | **~3 Days** |
| 🌍 **Multi-Lingual** | Full support for DE, FR, ES via auto-translation | 3-4 Weeks | **~1 Day** |
| 👨‍💻 **Human Hand-over** | Seamless transfer to live agent | 3-4 Weeks | **~2 Days** |
| 🤖 **Auto-Resolution** | AI agent that suggests fixes & closes simple tickets | 4-5 Weeks | **~4 Days** |
| 📈 **Predictive Analytics** | Forecast ticket volume & staffing needs | 2-3 Weeks | **~2 Days** |

| 📱 **Mobile App** | Dedicated React Native mobile interface | 4 Weeks | **~3 Days** |

> **Note:** AI estimations assume usage of agentic coding tools (like Project IQ's current dev setup) for rapid prototyping, boilerplating, and debugging.

---

# Slide 9: Development Velocity Impact

## How AI Agent Acceleration Changes the Game

**Traditional Approach:**
- Manual coding of every API wrapper.
- Writing boilerplate for every UI component.
- Manual debugging of NLU data.
- **Velocity:** Linear.

**With AI Agent (Project IQ Way):**
- **Architecture First:** AI scaffolds entire modules (e.g., `kb_cache_manager.py`).
- **Refactoring:** Instant conversion of patterns (e.g., caching implementation).
- **Data Generation:** 150+ training examples generated and formatted in minutes.
- **Velocity:** Exponential (**10x Speedup**).

---

# Slide 10: Summary & Next Steps

## Project IQ - Ready for Scale

✅ **Solid Foundation:** Core ticketing & KB features are stable and production-ready.
✅ **Optimized Performance:** Caching and efficient NLU ensures fast responses.
✅ **Full Visibility:** Admin dashboard and custom logging provide total insight.

🚀 **Next Focus:** Voice Interface, Human Hand-over & Multi-lingual support to expand accessibility.

### Questions?
