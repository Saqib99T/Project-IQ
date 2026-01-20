# Project IQ - AI-Powered GLPI Support Chatbot
## Presentation Content (Updated January 2026)

---

# Slide 1: Title

## Project IQ - IT Support Chatbot
### AI-Powered Conversational Interface for GLPI Ticketing

**Powered by:**
- Rasa 3.6 (Open Source NLU)
- GLPI Integration
- PostgreSQL Database
- Modern React Widget

---

# Slide 2: What is Project IQ?

## AI-Powered IT Support Assistant

🎫 **Create Tickets** - Natural language ticket creation with smart categorization

📋 **View & Track** - Real-time ticket status and history

🔍 **Knowledge Base** - Search articles before creating tickets

📊 **Analytics** - Comprehensive conversation and intent analytics

🛠️ **Admin Dashboard** - Full management and monitoring suite

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
│           NLU (Intent + Entity Recognition)             │
│           Dialogue Management (Stories/Rules)           │
│           Custom Actions (Python)                        │
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    ┌─────────┐    ┌──────────┐    ┌─────────┐
    │  GLPI   │    │PostgreSQL│    │Knowledge│
    │  API    │    │ Database │    │  Base   │
    └─────────┘    └──────────┘    └─────────┘
```

---

# Slide 4: Core Features (Completed ✅)

## Conversational Ticket Management

| Feature | Description |
|---------|-------------|
| 🎫 **Create Tickets** | Natural language → GLPI ticket with smart extraction |
| 📋 **List Tickets** | View all open/closed tickets |
| 🔍 **Check Status** | Real-time ticket status lookup |
| ✏️ **Update Tickets** | Add comments, change status |
| 📎 **File Attachments** | Upload files to tickets |
| 📚 **KB Search** | Search knowledge base before ticket creation |
| 📊 **Charts & Graphs** | Visual ticket statistics |
| ⭐ **Satisfaction Rating** | 1-5 star feedback collection |

---

# Slide 5: Admin Dashboard (Completed ✅)

## Comprehensive Management Suite

### 📊 Analytics
- Total conversations, messages, feedback
- Intent distribution charts
- Resolution rates
- **Advanced Filters:** User, App, Ticket Status, Date Range

### 🔍 Inspector
- Real-time conversation debugging
- Turn-by-turn NLU analysis
- Slot state visualization
- Live NLU tester

### 🎨 Themes
- Visual theme customization
- Live preview
- Multiple theme support

### ⚙️ Configuration
- GLPI connection settings
- Widget configuration

---

# Slide 6: Observability (Completed ✅)

## Real-Time Monitoring

| Component | Metrics |
|-----------|---------|
| **Rasa Core** | Status, PID, Memory, Uptime |
| **Action Server** | Status, Request Count, Errors |
| **Database** | Connections, Query Stats |
| **Logs** | Real-time log viewer with filtering |

### Features:
- Auto-refresh (10s intervals)
- Error highlighting
- Process health alerts
- Log search and analysis

---

# Slide 7: Studio (Completed ✅)

## No-Code Bot Management

### 📝 NLU Editor
- View/edit training intents
- Add new examples
- Visual intent management

### 📖 Stories & Rules
- View conversation flows
- Rule visualization

### 💬 Responses
- Edit bot responses
- Preview templates

### 🚀 Training
- One-click model training
- Training history
- Model version management

---

# Slide 8: Chat History Filters (Completed ✅)

## Advanced Conversation Search

### Filter Options:
| Filter | Options |
|--------|---------|
| **User Search** | Name, ID, sender_id |
| **App** | IT, HR, Accounting, General |
| **Ticket Status** | Created, Updated, Pending, Resolved, Closed, No Ticket |
| **Time Period** | Last 24h, 7 Days, 30 Days, 90 Days, All Time |

### Display:
- Full date + time format
- Ticket status badges
- User display names
- Message counts

---

# Slide 9: Future Roadmap

## Planned Enhancements

| Feature | AI Effort | Priority |
|---------|-----------|----------|
| 🌍 **Multi-Lingual Support** | ~8 hours | High |
| 🏢 **Multi-Tenant Architecture** | ~22 hours | High |
| 📱 **Mobile Widget** | ~4 hours | Medium |
| 🔔 **Push Notifications** | ~3 hours | Medium |
| 📈 **Advanced Analytics** | ~5 hours | Low |
| 🤖 **AI Intent Suggestions** | ~6 hours | Low |

---

# Slide 10: Multi-Lingual Support (Planned)

## 🌍 German & French Language Support

### Features:
- Auto language detection
- NLU in 3 languages (EN, DE, FR)
- Localized responses
- Widget UI translation
- Admin dashboard localization

### AI Implementation Timeline: **~8 hours**

| Phase | Time |
|-------|------|
| NLU Training Data | 2 hours |
| Response Templates | 1.5 hours |
| Language Detection | 1 hour |
| Widget Localization | 1.5 hours |
| Admin Dashboard | 1 hour |
| Testing & Polish | 1 hour |

---

# Slide 11: Multi-Tenant Architecture (Planned)

## 🏢 SaaS Platform Transformation

### Features:
- Complete data isolation per tenant
- Custom branding & themes
- Independent GLPI connections
- Tenant-specific configurations
- Usage tracking & billing

### AI Implementation Timeline: **~22 hours**

| Phase | Time |
|-------|------|
| Database & Core | 4 hours |
| Authentication | 3 hours |
| API Updates | 3 hours |
| Admin Dashboard | 4 hours |
| Widget & Frontend | 2 hours |
| Operations | 3 hours |
| Testing & Polish | 3 hours |

---

# Slide 12: Technical Stack

## Technologies Used

| Layer | Technology |
|-------|------------|
| **AI/NLU** | Rasa Open Source 3.6 |
| **Backend** | Python, Flask |
| **Database** | PostgreSQL 18 |
| **Frontend** | React, HTML5, TailwindCSS |
| **Charts** | Chart.js |
| **Integration** | GLPI REST API |
| **Deployment** | Nginx, Docker (optional) |

---

# Slide 13: AI Development Speed

## Traditional vs AI-Assisted Development

| Task | Traditional | AI-Assisted |
|------|-------------|-------------|
| Multi-Lingual Support | 3-4 weeks | **8 hours** |
| Multi-Tenant Architecture | 7-8 weeks | **22 hours** |
| Admin Dashboard Features | 2-3 weeks | **6 hours** |
| Chat History Filters | 1 week | **2 hours** |

### 🚀 10x Speed Improvement with AI Agent Assistance

---

# Slide 14: Deployment Architecture

```
┌────────────────────────────────────────────────────────┐
│                     Nginx (Port 80)                    │
│              Reverse Proxy + Static Files              │
└──────────────────┬───────────────┬─────────────────────┘
                   │               │
    ┌──────────────▼───────┐ ┌─────▼──────────────────┐
    │   Rasa Core (:5005)  │ │  Action Server (:5055) │
    │   NLU + Dialogue     │ │  Custom Python Actions │
    └──────────────────────┘ └────────────┬───────────┘
                                          │
                              ┌───────────▼───────────┐
                              │   Admin API (:8181)   │
                              │   Flask + Analytics   │
                              └───────────┬───────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
            ┌───────────────┐   ┌─────────────────┐   ┌─────────────┐
            │   PostgreSQL  │   │      GLPI       │   │  Knowledge  │
            │   (ChatBot)   │   │   (Ticketing)   │   │    Base     │
            └───────────────┘   └─────────────────┘   └─────────────┘
```

---

# Slide 15: Demo & Contact

## Live Demo

- **IT Support Chat:** http://YOUR-IP/it.html
- **Admin Dashboard:** http://YOUR-IP/admin.html

## Key Highlights:
1. Create a ticket using natural language
2. View ticket status and add comments
3. Explore Analytics dashboard
4. Use Inspector to debug conversations
5. Customize themes in real-time

---

# Slide 16: Summary

## Project IQ - Key Takeaways

✅ **Complete GLPI Integration** - Full ticket lifecycle management

✅ **Smart AI Understanding** - 30+ intents, entity extraction

✅ **Modern Admin Dashboard** - Analytics, Inspector, Studio, Observability

✅ **Production Ready** - PostgreSQL, Nginx, Error handling

🔜 **Coming Soon** - Multi-lingual, Multi-tenant, Mobile

### Questions?
