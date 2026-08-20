# KB Wiki Curation + Federated RAG — How It Works

Status: **implemented** (all 5 phases of `docs/plans/KB_WIKI_CURATION_RAG_PLAN.md` shipped 2026-08-18).
Spans two repos: **itsm-service** (curation/authoring) and **Project-IQ-V2** (bot query path).

This doc explains the current, real flow — not the original plan (several phases diverged
from the original plan once real code was checked; see `docs/plans/KB_WIKI_CURATION_RAG_PLAN.md`
§9 and the phase notes for what changed and why).

---

## 1. Content curation (itsm-service) — how an article gets written

Three independent triggers feed one shared synthesis pipeline. A human always reviews
before anything goes live.

```mermaid
flowchart TD
    subgraph Triggers
        A1["Manual trigger\nPOST /api/v1/kb/curation/run\n(agent pastes raw text)"]
        A2["Ticket resolved\n(nightly beat: auto_draft_kb_from_tickets)"]
        A3["KB gap feedback\n(nightly beat: cluster_kb_gaps_and_draft\ncluster >= 5 similar misses / 7 days)"]
    end

    A1 --> B["Create pending KBArticle\nstatus = ai_curated_pending_review"]
    A2 --> B
    A3 --> B

    B --> C["run_kb_curation (Celery task, queue=low)"]

    subgraph KBCurator ["KBCurator — LangGraph StateGraph"]
        D1[discover_perspectives] --> D2[interview]
        D2 --> D3[generate_outline]
        D3 --> D4[write_sections]
        D4 --> D5[polish]
        D5 --> D6[lint_check]
        D6 --> D7["human_review\n(interrupt() — pauses here)"]
    end

    C --> D1

    D7 -. "checkpointed to Postgres\n(AsyncPostgresSaver)\nsurvives restarts" .-> CP[(Checkpoint store)]

    D7 --> E{"Reviewer decision\nGET /pending\nPOST /{id}/approve or /reject"}

    E -->|approve| F["resume_kb_curation\nKBService.publish_article()"]
    F --> G["Article LIVE\nnightly refresh_kb_embeddings\nchunks it into kb_chunks\n(text-embedding-3-small)"]

    E -->|"reject (resynthesize=false)"| H["Archive draft"]
    E -->|"reject (resynthesize=true,\nreviewer notes)"| D4
```

**Notes on the triggers:**
- **Manual** — an agent has raw content (a doc, meeting notes) and wants it turned into a proper KB article.
- **Ticket resolved** — replaces the old single-LLM-call `KBDrafter` outright; every resolved ticket now goes through the same full STORM pipeline as everything else, one synthesis mechanism instead of two.
- **Gap feedback** — closes the loop with section 2 below. itsm-service reads Project-IQ-V2's Postgres **directly** (same cross-repo direct-DB-read pattern `kb_sync.py` already uses in the other direction) to find query clusters the bot couldn't answer, and turns a real, recurring gap into a draft article automatically.

---

## 2. Bot query path (Project-IQ-V2) — how a question gets answered

```mermaid
flowchart TD
    U["User asks a question\n(Rasa NLU routes to ask_knowledge intent)"] --> A["ActionSearchKnowledgeBase.run()"]

    A --> B{"Mid-clarification?\n(kb_clarify_options slot set)"}
    B -->|yes, match found| Z1["Answer with matched candidate"]
    B -->|yes, no match / retry| B2["Re-prompt with buttons\n(max 2 attempts, then answer\nwith best guess anyway)"]
    B -->|no| C

    C["Primary search:\nitsm_service.search_kb_chunks(token, message)\nGET /kb/chunks/search"]
    C --> D{"Any results?"}

    D -->|yes| E{"Top result score\n>= match threshold?"}
    E -->|yes| Z2["Answer directly with top chunk\n(kb_search_missed = False)"]
    E -->|no, multiple close candidates| F["Show up to 4 candidates\nas clarification buttons"]
    E -->|no, only one weak candidate| Z3["Answer anyway\n(better than a dead end)"]

    D -->|no results| G["Fallback: local vector_search.py\n(catches Firecrawl scrapes +\nsource extensions written\ndirectly into local kb_articles,\nwhich never reach itsm-service)"]
    G --> H{"Local match\n>= threshold?"}
    H -->|yes| Z4["Answer with local result"]
    H -->|no| I["Log knowledge gap\n(log_kb_gap: org_id, product_id)\n-> feeds section 1's gap-clustering job"]
    I --> J["kb_search_missed = True\nFollowupAction(action_track_confidence)"]
    J --> K["Offer: create ticket / my tickets / help\n(no dead end)"]

    style Z2 fill:#2d5,stroke:#141,color:#000
    style Z3 fill:#2d5,stroke:#141,color:#000
    style Z4 fill:#2d5,stroke:#141,color:#000
    style Z1 fill:#2d5,stroke:#141,color:#000
    style K fill:#d55,stroke:#411,color:#000
```

**Auth scoping on the primary search:**
- Logged-in user → their own IAM JWT is forwarded → itsm-service scopes results to that tenant's private + public content.
- Anonymous user (no token) → itsm-service scopes to **global public only** (`tenant_id IS NULL AND visibility = public`) — no special auth mechanism needed, this is just a query-scoping rule.

**Why two search paths instead of one:** itsm-service's chunked index (`kb_chunks`, heading-aware chunks + `text-embedding-3-small` embeddings) is the system of record and does real RAG-grade search — it's primary. The local `vector_search.py` index is a deliberate fallback, kept alive because Firecrawl scraping and source extensions (Google Sheets / Website / MS Teams via `extensions/_kb_adapter.py`) write content straight into Project-IQ-V2's own DB and never reach itsm-service — without the fallback, that content would be permanently unsearchable.

---

## 3. The full loop, end to end

```mermaid
flowchart LR
    Q["Bot query"] -->|answered| A["User gets help"]
    Q -->|"KB miss (logged as gap)"| G[("kb_search_gaps\ntable, Project-IQ-V2")]
    G -->|"nightly: cluster_kb_gaps_and_draft\nreads PIQ's DB directly"| C["itsm-service curation pipeline\n(same KBCurator graph as §1)"]
    C -->|human approves| P["New published article\n+ chunked + embedded"]
    P -->|next similar query| Q
```

A question the bot couldn't answer today becomes, after enough repeats, a candidate KB article
the bot *can* answer tomorrow — without anyone manually noticing the pattern.

---

## Where the code lives

| Concern | Repo | File(s) |
|---|---|---|
| Curation orchestration | itsm-service | `app/services/ai/kb_curator.py` |
| Curation triggers (Celery tasks + beat schedule) | itsm-service | `app/workers/tasks_kb.py`, `app/workers/celery_app.py` |
| Human review checkpoint store | itsm-service | `app/services/ai/kb_curation_checkpointer.py` |
| Curation review API | itsm-service | `app/api/v1/kb_curation.py` |
| Chunking + chunk search API | itsm-service | `app/services/ai/kb_chunker.py`, `app/api/v1/kb_chunk_search.py` |
| Gap clustering | itsm-service | `app/services/ai/kb_gap_clusterer.py` |
| Bot query action | Project-IQ-V2 | `action_server/actions/actions_kb.py` |
| Local fallback index | Project-IQ-V2 | `common/vector_search.py` |
| Gap logging | Project-IQ-V2 | `common/db/_kb_gaps.py` |
| Confidence/frustration signal unification | Project-IQ-V2 | `action_server/actions/actions_general.py` (`ActionTrackConfidence`) |

For the decision history and what changed vs. the original plan during implementation, see
`docs/plans/KB_WIKI_CURATION_RAG_PLAN.md`.
