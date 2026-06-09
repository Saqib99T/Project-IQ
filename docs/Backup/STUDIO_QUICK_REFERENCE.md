# 🎯 AI Studio - Complete Rasa Frontend Quick Reference

## ✨ What You'll Be Able to Do

### 1️⃣ **Intent Management**
```
✅ Create new intents with training examples
✅ Edit intent definitions
✅ Delete intents (with safety checks)
✅ Test intent classification
✅ View intent usage in stories/rules
✅ Import/export intents
```

### 2️⃣ **Story Management**
```
✅ Create dialogue flows visually
✅ Drag-and-drop story builder
✅ Edit existing stories
✅ Delete stories
✅ Visualize story paths as flowcharts
✅ Test story flow with simulator
✅ Manage branching logic
```

### 3️⃣ **Domain Configuration**
```
✅ View complete domain structure
✅ Manage entities (types & values)
✅ Create/edit slots
✅ Define forms for guided conversations
✅ Validate domain consistency
✅ Export domain as YAML
```

### 4️⃣ **Rules Management**
```
✅ Create strict business logic rules
✅ Set rule conditions and outcomes
✅ Edit/delete rules
✅ Test rules with sample inputs
✅ View rule impact
✅ Set rule priority
✅ Enable/disable rules
```

### 5️⃣ **Custom Actions**
```
✅ Create Python action handlers
✅ Write action code with syntax highlighting
✅ Test actions in isolation
✅ Browse action library
✅ Document action parameters
✅ Version control actions
```

### 6️⃣ **Training & Deployment**
```
✅ Train models with one click
✅ Monitor training progress
✅ View training metrics (accuracy, precision, recall)
✅ Compare model versions
✅ Deploy models to Rasa Core
✅ Rollback to previous versions
✅ View training logs & errors
```

---

## 🎮 User Interface Layout

```
┌─────────────────────────────────────────────────────┐
│  Project IQ Admin - AI Studio                    [×] │
├─────────────────────────────────────────────────────┤
│ ┌──────────────┐  ┌──────────────────────────────┐  │
│ │   Studio     │  │  Main Content Area           │  │
│ │  Navigation  │  │  (Intent/Story/Rules/etc)    │  │
│ ├──────────────┤  ├──────────────────────────────┤  │
│ │ • Intents    │  │ [+] Create New Intent        │  │
│ │ • Stories    │  │ ┌────────────────────────┐   │  │
│ │ • Domain     │  │ │ Intent List            │   │  │
│ │ • Rules      │  │ │ ├─ create_ticket      │   │  │
│ │ • Actions    │  │ │ ├─ check_status       │   │  │
│ │ • Training   │  │ │ ├─ list_tickets       │   │  │
│ │ • Chat Test  │  │ │ └─ update_ticket      │   │  │
│ │              │  │ └────────────────────────┘   │  │
│ │              │  │                              │  │
│ │              │  │ [Edit] [Test] [Delete]       │  │
│ └──────────────┘  └──────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## 📋 Feature Comparison: Before vs After

| Feature | Before | After |
|---------|--------|-------|
| **Intent Management** | Manual YAML editing | ✅ Visual editor |
| **Story Creation** | Text-based YAML | ✅ Drag-drop builder |
| **Domain Updates** | Edit files directly | ✅ Form-based editor |
| **Rules Management** | Manual YAML | ✅ Rule builder + tester |
| **Custom Actions** | External IDE | ✅ Built-in code editor |
| **Training** | Command line | ✅ One-click training |
| **Model Deployment** | Manual process | ✅ Automated deployment |
| **Rollback** | Manual backup restore | ✅ One-click rollback |
| **Testing** | Run Rasa CLI | ✅ Integrated simulator |
| **Validation** | Manual verification | ✅ Automatic validation |

---

## 🔄 Typical Workflow

### Creating a New Support Flow

```
1. Click "Intents" → [+] New Intent
   ├─ Name: "report_problem"
   ├─ Examples:
   │  ├─ "I have an issue"
   │  ├─ "Something is broken"
   │  └─ "Can you help me?"
   └─ [Save]

2. Click "Domain" → [+] Add Slot
   ├─ Name: "problem_type"
   ├─ Type: "text"
   └─ [Add]

3. Click "Stories" → [+] New Story
   ├─ Name: "report_flow"
   ├─ Step 1: User intent "report_problem"
   ├─ Step 2: Bot action "action_ask_details"
   ├─ Step 3: User entity "problem_type"
   ├─ Step 4: Bot action "action_create_ticket"
   └─ [Save]

4. Click "Training" → [Train Model]
   ├─ Training in progress... ✓
   ├─ Metrics:
   │  ├─ Accuracy: 95%
   │  └─ F1 Score: 0.93
   └─ [Deploy]

5. Click "Chat Test"
   └─ Test the new flow interactively
```

---

## 🛡️ Safety Features

```
✅ Auto-backup before changes
✅ Impact analysis before deletion
✅ Syntax validation
✅ Concurrent edit prevention
✅ Audit logging
✅ One-click rollback
✅ Version history
✅ Test before training
```

---

## ⚡ Time Savings

| Task | Before | After | Savings |
|------|--------|-------|---------|
| Create new intent | 5-10 min | 1-2 min | 75-80% ⏱️ |
| Build story | 15-20 min | 5-7 min | 65-70% ⏱️ |
| Create rule | 10-15 min | 2-3 min | 75-85% ⏱️ |
| Update domain | 10 min | 2-3 min | 70-80% ⏱️ |
| Train & deploy | 20-30 min | 2-5 min | 85-90% ⏱️ |
| **Total per update** | **60-85 min** | **12-20 min** | **75% faster** ✨ |

---

## 🎓 Who Benefits?

✨ **Rasa Developers**
- Build bots without YAML editing
- Faster iteration cycles
- Better testing capabilities

✨ **Business Analysts**
- No coding required
- Visual story building
- Easy rule management

✨ **QA/Testing Teams**
- Integrated testing tools
- Intent classification testing
- Story flow validation

✨ **DevOps/MLOps**
- One-click training
- Model versioning
- Automated deployment
- Easy rollbacks

---

## 📊 Admin Studio Tabs

```
┌─────────────────────────────────────────────────────────┐
│ 🤖 Intents │ 📖 Stories │ 🗂️ Domain │ 📏 Rules │ ⚙️ Actions │ 🚀 Training │ 💬 Chat Test │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                  [Active Tab Content]                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Tab Details

**🤖 Intents Tab**
- List of all intents with usage count
- [+] Create button
- Search/filter by name
- Edit/Test/Delete per intent
- Bulk import from file

**📖 Stories Tab**
- Visual story flowchart
- [+] Create button
- Story list with metadata
- Drag-drop editor
- Flow simulator
- Branch/condition editor

**🗂️ Domain Tab**
- Domain overview
- Entities management
- Slots management
- Forms/flows
- Validator status

**📏 Rules Tab**
- Rules list with status
- [+] Create rule
- Rule condition builder
- Rule tester
- Priority management
- Enable/disable toggle

**⚙️ Actions Tab**
- Custom actions library
- Code editor
- Action tester
- Parameter definition
- Version history

**🚀 Training Tab**
- Training control panel
- Progress indicator
- Training metrics
- Model comparison
- Deployment controls
- Rollback options

**💬 Chat Test Tab**
- Real-time chat testing
- Intent analyzer
- Entity extraction viewer
- Response preview
- Conversation history

---

## 🔗 Backend Integration Points

All backend endpoints are prefixed with `/admin/studio/`:

```
Intents:        GET/POST/PUT/DELETE /intents
Stories:        GET/POST/PUT/DELETE /stories
Domain:         GET/PUT /domain
Rules:          GET/POST/PUT/DELETE /rules
Actions:        GET/POST/PUT/DELETE /actions
Training:       POST /train, GET /train/status
Models:         GET /models, POST /models/<id>/deploy
```

---

## 💾 Data Persistence

```
nlu.yml       ← Intent & example management
stories.yml   ← Story definitions
domain.yml    ← Domain, entities, slots, forms
rules.yml     ← Rule definitions
actions/      ← Custom action Python files
```

All modifications are:
✅ Persisted to disk
✅ Backed up automatically
✅ Validated before saving
✅ Audit logged

---

## 🚀 Next Steps

To implement this feature:

1. **Review** [STUDIO_ENHANCEMENT_PLAN.md](STUDIO_ENHANCEMENT_PLAN.md)
2. **Start with Phase 1** - File I/O & Domain Manager
3. **Implement API endpoints** - All CRUD operations
4. **Build React components** - Tab by tab
5. **Add testing** - Unit + integration tests
6. **Deploy to production** - Gradual rollout

---

**Status:** 📋 Planned  
**Effort:** 130-175 hours  
**Timeline:** 3-4 weeks  
**Impact:** High value, high efficiency gain  
**Created:** January 26, 2026
