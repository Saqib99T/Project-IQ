# 🎯 KB Response Specificity Enhancement - Design Plan

**Date:** January 27, 2026  
**Status:** Design Phase (No Implementation Yet)  
**Purpose:** Transform full-article KB responses into pinpoint, contextual answers

---

## 1. Current State Analysis

### 🔴 Current Behavior
```
User: "Laptop overheating"
↓
Bot searches KB → Finds: "Hardware Troubleshooting - Laptop Performance"
↓
Bot returns: [FULL 2000+ word article about all hardware issues]
↓
User reads through entire article to find relevant section
```

### ❌ Problems
- **Information Overload:** Full articles are overwhelming
- **Poor UX:** Users must skim content manually
- **Low Precision:** Matches topic but not specific problem
- **No Clarification:** Bot doesn't ask which aspect of the topic
- **Inefficient:** Returns unnecessary content

### ✅ Desired Behavior
```
User: "Laptop overheating"
↓
Bot asks: "Is it overheating during:
  1) Specific applications?
  2) Regular usage?
  3) Gaming/heavy tasks?"
↓
User selects: "Gaming"
↓
Bot returns: [Specific solution for GPU throttling in gaming]
↓
User gets exact answer in 2-3 sentences
```

---

## 2. Proposed Solutions (Pick Best Fit)

### 🔷 **Solution A: Article Chunking + Section Matching**

**Concept:** Break KB articles into logical sections/paragraphs, index them separately

```
Article: "Laptop Troubleshooting"
├── Section 1: Overheating Causes (Symptoms & Quick Check)
├── Section 2: Thermal Paste Replacement (Step-by-step)
├── Section 3: Fan Cleaning (Detailed Guide)
├── Section 4: BIOS Settings (Advanced)
└── Section 5: When to Contact Support

↓ Index & Search Each Section Separately

User: "Laptop overheating"
↓
Bot finds: Section 1 (Best Match - 95% relevance)
↓
Bot returns: Only Section 1 (~200 words instead of 2000)
```

**Advantages:**
- ✅ Simple to implement
- ✅ Uses existing semantic search
- ✅ Minimal code changes
- ✅ Fast retrieval
- ✅ Good for structured articles

**Disadvantages:**
- ❌ Still might return longer section
- ❌ Requires article pre-processing
- ❌ Doesn't ask clarifying questions
- ❌ May miss context if question spans sections

**Implementation Effort:** Low (2-3 days)

---

### 🔷 **Solution B: QA Pairs Extraction**

**Concept:** Extract Q&A pairs from each KB article, index Q&A separately

```
Article: "Laptop Troubleshooting"
↓
Extract Q&A Pairs:
Q1: "How to fix laptop overheating?"
A1: "Check if vents are blocked. Use compressed air to clean..."

Q2: "What causes thermal throttling?"
A2: "CPU/GPU runs hot and reduces speed. This is a safety feature..."

Q3: "Should I replace thermal paste?"
A3: "Yes, if older than 3 years or if temps are still high after cleaning..."

↓ Index Each Q&A Pair

User: "Laptop overheating"
↓
Bot finds: Q1 (Exact match) + Q2 (Related)
↓
Bot returns: A1 [200 words - focused answer]
    OR asks: "Do you want to know about: 
       1) How to fix it?
       2) What's causing it?"
```

**Advantages:**
- ✅ Very targeted answers
- ✅ Can ask clarifying questions
- ✅ Works like FAQ
- ✅ Highest relevance precision
- ✅ Great UX

**Disadvantages:**
- ❌ Requires manual Q&A extraction
- ❌ Doesn't scale with large KB
- ❌ Need AI to auto-generate Q&As
- ❌ Moderate setup time

**Implementation Effort:** Medium (1 week with manual extraction, 2 weeks with AI extraction)

---

### 🔷 **Solution C: Clarifying Questions + Multi-Turn**

**Concept:** Ask follow-up questions to understand user's exact problem

```
User: "Laptop overheating"
↓
Bot matches article but confidence is medium (70%)
↓
Bot asks multi-choice clarifying questions:
"Is it overheating:
  1) During normal use?
  2) During gaming/heavy apps?
  3) All the time?
  4) New problem or old?"

↓
User selects: "During gaming"

↓
Bot filters section + generates specific answer about GPU optimization
```

**Advantages:**
- ✅ Highly specific answers
- ✅ No manual extraction needed
- ✅ Handles ambiguous queries
- ✅ Conversational experience
- ✅ Good engagement

**Disadvantages:**
- ❌ Requires extra dialogue turn
- ❌ Complex dialogue flow management
- ❌ May frustrate users wanting quick answers
- ❌ Needs intent detection

**Implementation Effort:** Medium-High (1-2 weeks)

---

### 🔷 **Solution D: Section Relevance Scoring + Abstractive Answer**

**Concept:** Score which sections of article are most relevant, then generate summary

```
Article: "Laptop Troubleshooting" (2000 words total)
├── Section 1: [85% relevance to "overheating"]
├── Section 2: [45% relevance to "overheating"]
├── Section 3: [25% relevance to "overheating"]
└── Section 4: [5% relevance to "overheating"]

↓
Bot extracts Section 1 + identifies key subsections
↓
Bot generates abstractive summary (300 words):
"Your laptop is overheating because..."
↓
Bot offers: "Want detailed steps? → [Show full section]"
           "Have questions? → [Specific details]"
```

**Advantages:**
- ✅ Condensed answers
- ✅ Progressive disclosure (summary → details)
- ✅ Works with any KB structure
- ✅ Can use existing articles
- ✅ No manual extraction

**Disadvantages:**
- ❌ Requires LLM for summarization
- ❌ May lose some nuance
- ❌ Extra processing cost
- ❌ Quality depends on LLM

**Implementation Effort:** Medium (1-2 weeks with LLM integration)

---

### 🔷 **Solution E: Hybrid - Smart Routing**

**Concept:** Combine multiple approaches based on query type

```
Query Classification:
├─ Low Specificity ("Laptop issue")
│  └─ Use Solution C: Ask clarifying questions
│
├─ Medium Specificity ("Laptop overheating")
│  └─ Use Solution A: Return relevant section
│
└─ High Specificity ("How to clean laptop fans")
   └─ Use Solution B: Return matching Q&A pair

↓
Route to best solution for that query type
```

**Advantages:**
- ✅ Best of all approaches
- ✅ Contextual routing
- ✅ Flexible and scalable
- ✅ Handles all query types
- ✅ Progressive improvement

**Disadvantages:**
- ❌ Complex implementation
- ❌ Requires all sub-solutions
- ❌ Classification overhead
- ❌ Longer development time

**Implementation Effort:** High (3-4 weeks)

---

## 3. Recommended Approach: **Solution E (Hybrid)**

### Why Hybrid is Best:
1. **Flexible** - Adapts to different query types
2. **Scalable** - Can add/improve each component
3. **Progressive** - Start simple, improve over time
4. **User-Centric** - Matches user needs
5. **Future-Ready** - Supports LLM integration

### Phased Implementation:

**Phase 1 (Week 1-2):** Section Chunking (Solution A)
- Break articles into sections
- Index sections with semantic embeddings
- Return best matching section

**Phase 2 (Week 3-4):** Clarifying Questions (Solution C)
- Add multi-turn dialogue
- Implement intent detection
- Ask targeted questions

**Phase 3 (Week 5-6):** Q&A Extraction (Solution B)
- Extract/create Q&A pairs
- Index Q&A separately
- Match questions to queries

**Phase 4 (Week 7+):** Smart Routing (Solution E)
- Classify query specificity
- Route to best solution
- Implement feedback loop

---

## 3.1 Hybrid Implementation Plan (Detailed)

### A. Routing Logic (Decision Rules)
**Inputs:** specificity_score, match_confidence, top_qa_score, top_section_score

**Default thresholds (tunable):**
- **Low specificity:** specificity_score < 0.40 → ask clarifying questions
- **Medium specificity:** 0.40–0.75 → return best section + short summary + “Show more”
- **High specificity:** ≥ 0.75 → return top Q&A answer if top_qa_score ≥ 0.85; else fallback to section

**Fallbacks:**
- If no section score ≥ 0.60 → return top 2 article titles + ask user to choose
- If clarification unanswered → return top section summary + “Need more details?”

### B. Data & Index Updates
**New/updated stores:**
- **kb_sections** (per-article chunking) with embeddings
- **kb_qa_pairs** (extracted Q&A) with embeddings
- **clarifying_questions** (topic-based templates)
- **kb_metrics** (routing decisions, response length, satisfaction)

**Indexing cadence:**
- On KB sync: re-chunk, re-embed, update vector indexes
- Nightly job: refresh Q&A extraction (if enabled)

### C. API & Response Contracts
**New endpoints (minimum):**
- `POST /kb/query` → returns route, answer, and follow-ups
- `POST /kb/clarify` → accepts clarification choice, returns refined answer
- `POST /kb/feedback` → captures satisfaction, “show more” clicks
- `POST /kb/reindex` → rebuilds section/Q&A indexes

**Response payload shape:**
```
{
    "route": "clarify|section|qa",
    "confidence": 0.82,
    "answer": "...",
    "follow_ups": ["..."],
    "show_more": {"type": "section", "id": "sec-002"},
    "sources": [{"article_id": "...", "section_id": "..."}]
}
```

### D. UX Changes (Chat Widget)
- Show **short answer** (2–5 bullet points) by default
- “Show full section” button → expands section
- “Not what you wanted?” → triggers clarification flow
- Track **click-through** on full article

### E. Evaluation & Acceptance Criteria
**Acceptance targets:**
- Avg response length ≤ 300 words for routed answers
- First-turn satisfaction ≥ 75%
- Clarification rate between 30–50% for ambiguous queries
- Section MRR ≥ 0.85 and Q&A precision ≥ 90%

### F. Rollout Plan (Risk-Controlled)
- **Week 1–2:** internal testing + offline evaluation
- **Week 3:** 10% traffic (A/B vs baseline full-article)
- **Week 4:** 50% traffic with KPI gating
- **Week 5:** 100% if KPIs met; otherwise tune thresholds

---

## 4. Technical Architecture

### System Design (Hybrid Approach)

```
┌─────────────────────────────────────────────────────────┐
│                    User Query                            │
│              "Laptop overheating"                        │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
       ┌───────────────────────────────┐
       │   Query Analyzer              │
       │  - Extract intent             │
       │  - Measure specificity        │
       │  - Identify entities          │
       └──────┬────────────────────────┘
              │
              ▼
    ┌─────────────────────────────┐
    │  Smart Router               │
    │  (Confidence-based routing) │
    └┬───────────┬────────┬──────┬┘
     │           │        │      │
     ▼           ▼        ▼      ▼
  [Q<40%]  [40-70%]  [70-85%] [>85%]
     │           │        │      │
     ▼           ▼        ▼      ▼
   Ask      Mixed      Direct   Direct
   Questions Approach  Section  Q&A
   (C)       (B+C)     (A)      (B)
     │           │        │      │
     └───────────┴────────┴──────┘
              │
              ▼
    ┌──────────────────────────────┐
    │  Response Generator          │
    │  - Format answer             │
    │  - Add follow-ups            │
    │  - Include references        │
    └──────┬───────────────────────┘
           │
           ▼
    ┌──────────────────────────────┐
    │  User receives:              │
    │  • Pinpoint answer (2-3 min) │
    │  • Follow-up questions       │
    │  • "Want more?" option       │
    │  • Link to full article      │
    └──────────────────────────────┘
```

---

## 5. Data Structures Needed

### Article Metadata (Enhanced)

```python
{
    "article_id": "laptop-overheating-001",
    "title": "Laptop Overheating - Troubleshooting Guide",
    "url": "/kb/hardware/overheating",
    
    # New fields:
    "sections": [
        {
            "id": "sec-001",
            "title": "Quick Diagnosis",
            "content": "...",
            "keywords": ["overheating", "check", "symptoms"],
            "embedding": [...],  # Vector
            "relevance_tags": ["diagnosis", "quick-fix"]
        },
        {
            "id": "sec-002",
            "title": "Fan Cleaning",
            "content": "...",
            "keywords": ["fan", "clean", "dust"],
            "embedding": [...],
            "relevance_tags": ["solution", "hardware"]
        }
    ],
    
    # Q&A pairs extracted from article
    "qa_pairs": [
        {
            "id": "qa-001",
            "question": "Why is my laptop overheating?",
            "answer": "Common causes are...",
            "embedding": [...],
            "keywords": ["cause", "why"]
        },
        {
            "id": "qa-002",
            "question": "How to clean laptop fans?",
            "answer": "Step 1: Shut down... Step 2:...",
            "embedding": [...],
            "keywords": ["clean", "fan", "how"]
        }
    ],
    
    # Clarifying questions for ambiguous queries
    "clarifying_questions": [
        "Is it overheating during normal use?",
        "Is it a recent problem?",
        "Have you tried cleaning the vents?"
    ]
}
```

### Query Analysis Object

```python
{
    "user_query": "Laptop overheating",
    "intent": "get_solution",  # get_solution, diagnose, learn, report_problem
    "specificity_score": 0.65,  # 0-1 (higher = more specific)
    "confidence": 0.72,  # Search confidence
    "matched_articles": [
        {"article_id": "...", "score": 0.92},
        {"article_id": "...", "score": 0.78}
    ],
    "matched_sections": [
        {"section_id": "sec-001", "score": 0.95},
        {"section_id": "sec-002", "score": 0.68}
    ],
    "matched_qa_pairs": [
        {"qa_id": "qa-001", "score": 0.88}
    ],
    
    # Decision
    "routing_strategy": "mixed",  # direct, mixed, questions, qa
    "reason": "Medium specificity - ask clarifying questions"
}
```

---

## 6. Implementation Steps (Detailed for Phase 1)

### Phase 1: Section Chunking

**Step 1: Article Preprocessing**
```
For each KB article:
1. Parse HTML/Markdown structure
2. Identify sections (h2, h3 headers)
3. Group content under headers
4. Split large sections if >500 words
5. Add metadata (position, related sections)
```

**Step 2: Vector Embeddings**
```
For each section:
1. Use existing sentence-transformers
2. Create embedding for section
3. Create embedding for section title
4. Create combined embedding
5. Store in embedding database
```

**Step 3: Search & Retrieval**
```
On user query:
1. Embed user query
2. Search both articles AND sections
3. If section score > 0.85, return section
4. If section score 0.60-0.85, ask follow-up
5. If score < 0.60, suggest full articles
```

**Step 4: Response Formatting**
```
Return format:
{
    "response_type": "section",
    "section": {...},
    "follow_up": "Do you need details on [related topic]?",
    "show_more": "Want the full article?"
}
```

---

## 7. ML/NLP Components Needed

### 1. **Query Specificity Classifier**
- **Input:** User query
- **Output:** Score 0-1 (how specific)
- **Example Model:** Fine-tuned BERT or simple rule-based
- **Training Data:** ~200 labeled examples of specific/vague queries

### 2. **Intent Detector**
- **Input:** User query
- **Output:** Intent (get_solution, diagnose, learn, report_problem)
- **Model:** Pre-trained from Rasa NLU or custom
- **Classes:** ~5-10 intents

### 3. **Section Relevance Ranker**
- **Input:** Query + Sections
- **Output:** Ranking scores
- **Method:** Semantic similarity + BM25 fusion
- **Current Tech:** sentence-transformers (can enhance)

### 4. **Clarifying Question Generator**
- **Input:** Query + Matched articles
- **Output:** 2-3 disambiguating questions
- **Method:** Template-based OR LLM-based
- **Option A (Simple):** Pre-written question templates
- **Option B (Advanced):** Use LLM (GPT-3.5, Llama) to generate

### 5. **Answer Summarizer** (Optional, Phase 4)
- **Input:** Long section/article
- **Output:** 2-3 sentence summary
- **Method:** Extractive (select key sentences) OR Abstractive (LLM-based)
- **Tool Options:** Transformers library, LLaMA, GPT

---

## 8. Sample Flow Examples

### Example 1: Vague Query (Specificity: 35%)

```
User: "Laptop problem"
↓
System: Confidence too low (45%) → Ask clarifying questions
↓
Bot: "What issue are you facing?
      1) Performance/Slowness
      2) Overheating
      3) Screen/Display
      4) Battery
      5) Something else?"
↓
User: "Overheating"
↓
Bot: → Proceed to Example 2
```

### Example 2: Medium Query (Specificity: 65%)

```
User: "Laptop overheating"
↓
System: Medium confidence (70%) → Ask focused follow-up
↓
Bot: "Is it overheating:
      1) During normal tasks?
      2) During gaming?
      3) When laptop is idle?
      4) All the time?"
↓
User: "During gaming"
↓
System: Now highly specific → Direct section match
↓
Bot: Returns relevant section:
"GPU Overheating While Gaming
- The GPU is under high load during gaming
- Solutions:
  1) Update graphics drivers
  2) Reduce game graphics settings
  3) Clean cooling vents (details →)
  4) Check thermal paste (advanced)"
```

### Example 3: Specific Query (Specificity: 85%)

```
User: "How to clean laptop cooling fans?"
↓
System: High confidence (88%) → Direct Q&A match
↓
Bot: "Found exact match!
Q: How to clean laptop cooling fans?
A: 
1. Power off and unplug laptop
2. Use compressed air at 45° angle
3. Blow for 2-3 seconds per vent
4. Wait 5 minutes before powering on
5. Check if temps improved

Still hot? → Advanced guide (thermal paste replacement)"
```

---

## 9. Metrics & Success Criteria

### 📊 Key Metrics to Track

| Metric | Current | Target | Why? |
|--------|---------|--------|------|
| Avg Response Length | 1500+ words | 200-300 words | Reduce cognitive load |
| User Follow-up Clicks | 60% | 30% | Need full article less |
| Time to Find Answer | 3-5 min | 30-60 sec | Better experience |
| User Satisfaction (KB) | 65% | 85%+ | More helpful responses |
| Bot Clarifying Q Rate | 0% | 40%+ | Better specificity |
| Solution Found First Try | 45% | 75%+ | Reduce iterations |
| Click-through to Full Article | 40% | 20% | More self-service |

### 🎯 Success Definition

✅ **Phase 1 Success:**
- 80% of section matches score > 0.80
- Average response < 400 words
- User satisfaction +10%

✅ **Phase 2 Success:**
- Clarifying questions reduce ambiguity by 50%
- Solution found in 2nd response 70% of time
- User engagement increases 25%

✅ **Phase 3 Success:**
- Q&A pairs have 95%+ accuracy
- Direct Q&A matches occur 40% of time
- Response time < 2 seconds

✅ **Phase 4 Success:**
- Smart routing improves overall accuracy by 20%
- Solution finding first try reaches 80%
- System self-improves from feedback

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Breaking existing KB search | High | Keep old search as fallback |
| Q&A extraction quality | High | Start manual, use QA review process |
| Performance degradation | Medium | Cache embeddings, optimize queries |
| Clarifying questions feel intrusive | Medium | Make optional, show "Skip" button |
| Maintaining Q&A pairs | Medium | Automate extraction, use version control |
| User confusion with routing | Low | Clear response types, consistent UX |

---

## 11. Technology Stack Recommendations

### Backend Services

```
Option A: Lightweight (Recommended for Phase 1-2)
├─ Existing: sentence-transformers (embeddings)
├─ New: Chroma/Milvus (section embeddings DB)
├─ New: Simple rules engine (for routing)
└─ New: Template system (for clarifying Qs)

Option B: Advanced (For Phase 4+)
├─ Existing: sentence-transformers
├─ New: LLM (Llama 2, Mistral) for summarization
├─ New: Vector DB (Pinecone, Weaviate)
├─ New: FastAPI (separate microservice)
└─ New: ML pipeline (for continuous improvement)
```

### Database Schema

```sql
-- Enhanced KB schema
CREATE TABLE kb_articles (
    id UUID PRIMARY KEY,
    title VARCHAR,
    url VARCHAR,
    content TEXT,
    created_at TIMESTAMP
);

CREATE TABLE kb_sections (
    id UUID PRIMARY KEY,
    article_id UUID REFERENCES kb_articles,
    title VARCHAR,
    content TEXT,
    position INT,
    embedding VECTOR(384),  -- From sentence-transformers
    relevance_tags TEXT[],
    created_at TIMESTAMP
);

CREATE TABLE kb_qa_pairs (
    id UUID PRIMARY KEY,
    article_id UUID REFERENCES kb_articles,
    question VARCHAR,
    answer TEXT,
    embedding VECTOR(384),
    confidence FLOAT,
    created_at TIMESTAMP
);

CREATE TABLE clarifying_questions (
    id UUID PRIMARY KEY,
    article_id UUID,
    question VARCHAR,
    trigger_keywords TEXT[],
    follow_up_actions TEXT,
    created_at TIMESTAMP
);

-- Metrics tracking
CREATE TABLE kb_metrics (
    id UUID PRIMARY KEY,
    query_id UUID,
    article_id UUID,
    response_type VARCHAR,
    user_satisfied BOOLEAN,
    response_length INT,
    response_time_ms INT,
    created_at TIMESTAMP
);
```

---

## 12. Rollout Strategy

### 🚀 Phased Rollout

**Week 1-2 (Phase 1): Section Chunking**
- Internal testing only
- Compare old vs new search
- Refine section sizes

**Week 3 (Beta Release):**
- Roll out to 10% of users
- Collect feedback
- Monitor metrics

**Week 4 (Gradual Expansion):**
- 25% → 50% → 100% of users
- Fix issues as they arise
- Gather learnings

**Week 5+ (Phase 2+):**
- Start with clarifying questions
- Build Q&A extraction
- Implement smart routing

---

## Summary: Choose Your Path

| Solution | Effort | Impact | Timeline | Recommendation |
|----------|--------|--------|----------|-----------------|
| **A: Sections** | Low ⭐ | Medium ⭐⭐ | 1-2 weeks | Start here |
| **B: Q&A Pairs** | Medium ⭐⭐ | High ⭐⭐⭐ | 2-3 weeks | Phase 2 |
| **C: Questions** | Medium ⭐⭐ | High ⭐⭐⭐ | 2-3 weeks | Phase 2 |
| **D: Summarization** | Medium ⭐⭐ | Medium ⭐⭐ | 2-3 weeks | Phase 4 |
| **E: Hybrid** | High ⭐⭐⭐ | Very High ⭐⭐⭐⭐ | 4+ weeks | **Best long-term** |

---

**Next Step:** Review this design, provide feedback, and we can move to implementation phase.

Would you like me to:
1. ✅ Deep-dive into any solution?
2. ✅ Create implementation roadmap?
3. ✅ Design database schema in detail?
4. ✅ Build prototype for Phase 1?
5. ✅ Create training data for classifiers?
