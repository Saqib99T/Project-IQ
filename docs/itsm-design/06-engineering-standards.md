# IQ-ITSM — Engineering Standards
## Security · Logging · Exception Handling

---

## 1. Security

### 1.1 Input Validation
- All request bodies validated by **Pydantic v2 strict mode** — unknown fields rejected, types coerced never guessed
- String fields: max length enforced, strip leading/trailing whitespace
- UUIDs validated at model level — invalid UUID → 422 before hitting service layer
- Enum fields: only declared values accepted — no fallback to raw string
- JSONB fields (custom_fields, settings): validated against JSON Schema before write

```python
class CreateTicketRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    title: str = Field(min_length=3, max_length=500)
    description: str = Field(min_length=10, max_length=50_000)
    priority: TicketPriority          # enum — invalid value → 422
    type: TicketType
    category_id: UUID | None = None
```

### 1.2 IDOR Prevention (Insecure Direct Object Reference)
- **Never trust a client-supplied tenant_id** — always extract from validated JWT
- Every repo query includes `WHERE tenant_id = :current_tenant_id` — not optional
- Cross-tenant access only via impersonation session or platform role, never by manipulating request body

```python
# WRONG — trusting client
ticket = await repo.get(ticket_id)

# CORRECT — always scope to current tenant
ticket = await repo.get(ticket_id, tenant_id=current_user.tenant_id)
# returns 404 if ticket exists but belongs to another tenant
```

### 1.3 SQL Injection Prevention
- 100% SQLAlchemy ORM — zero raw SQL strings anywhere in application code
- The one exception: Alembic migrations use `text()` — reviewed manually before every migration run
- pgvector queries use parameterised bindings — embedding vectors never interpolated into query strings

### 1.4 Authentication & Authorisation
- JWT validated on every request — signature, expiry, issuer, audience
- JWKS cache refreshed every 6h with background task; stale cache → re-fetch immediately on validation failure
- `require_role()` dependency applied at router level — no endpoint is accidentally public
- Impersonation tokens stored in DB with expiry — verified server-side on every call, not just decoded
- Platform tier access always requires `platform_admin` or `platform_support` role — no fallback

### 1.5 File Upload Security
```
Client uploads → S3 directly via presigned URL (ITSM API never receives binary)

ITSM API (before generating presigned URL):
  1. Validate MIME type is in allowlist (not client Content-Type header — actual magic bytes checked server-side after upload via S3 event or Lambda)
  2. Enforce max 25MB per file
  3. Reject executable extensions: .exe .sh .bat .ps1 .py .php .js .jar
  4. Virus scan hook: S3 event → ClamAV Lambda (async, flag infected files)
  5. Randomise stored filename: {uuid7}.{ext} — original name stored only in DB
```

### 1.6 Security Headers (FastAPI middleware)
```python
@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'none'"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    return response
```

### 1.7 Rate Limiting
- Redis sliding window: 1,000 req/min per user, 10,000 req/min per tenant
- Stricter limits on auth-sensitive endpoints: `/webhooks/iam` → 10 req/min per IP
- AI endpoints: 60 req/min per user (LLM calls are expensive)
- 429 response includes three headers:
  - `Retry-After`: seconds until the window resets
  - `X-RateLimit-Limit`: the limit for this endpoint tier
  - `X-RateLimit-Remaining`: how many requests remain in the current window
  - `X-RateLimit-Reset`: Unix timestamp when the window resets

### 1.8 Secrets Management
- All secrets in environment variables — never hardcoded, never in git
- `.env` files in `.gitignore` — `.env.example` has placeholder values only
- Production: secrets injected via Kubernetes Secrets or cloud secret manager (AWS Secrets Manager / Azure Key Vault)
- Rotate: JWKS public keys auto-rotate via IAM; DB passwords rotated via secret manager with zero-downtime reload
- Never log secrets — middleware strips `Authorization` header from request logs

### 1.9 CORS
```python
CORSMiddleware(
    allow_origins=settings.ALLOWED_ORIGINS,  # explicit list, never "*" in prod
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Tenant-ID"],
)
```

### 1.10 Dependency Scanning
- `trivy image itsm-service:latest` — runs in CI, fails build on CRITICAL/HIGH CVEs
- `syft itsm-service:latest -o cyclonedx-json` — SBOM generated on every build, stored as CI artifact
- `pip-audit` — checks Python packages against OSV/PyPI advisory database on every PR
- Dependabot enabled on repo — auto-PRs for dependency updates

### 1.11 File Upload — Virus Scan Quarantine Policy
```
Upload flow:
  1. Client gets presigned S3 URL from ITSM API
  2. Client uploads directly to S3 (ITSM never receives binary)
  3. S3 event → ClamAV Lambda runs asynchronously after upload

On scan CLEAN:
  → Move object from quarantine prefix (uploads/quarantine/) to live prefix (uploads/files/)
  → Update attachment.storage_url to live path
  → Notify uploader: file is available

On scan INFECTED:
  → S3 DeleteObject (quarantine prefix)
  → Set attachment.status = 'rejected_virus_scan' — record kept, file gone
  → WARNING log + system_logs entry: filename, tenant_id, uploader_id, threat_name
  → Notify tenant admin (NOT the uploader — avoid tipping off attacker)
  → Sentry alert with threat name

UI rule: attachments show as "Processing..." until storage_url is live path.
         Quarantined attachments show "Upload rejected — security check failed."
```

---

## 2. Structured Logging

### 2.1 Log Format — Every Line is Valid JSON
```json
{
  "timestamp":   "2026-06-05T10:23:45.123Z",
  "level":       "INFO",
  "request_id":  "01JXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
  "tenant_id":   "org_acme_01j2m",
  "user_id":     "usr_01j4k",
  "platform":    false,
  "method":      "POST",
  "path":        "/api/v1/tickets",
  "status":      201,
  "latency_ms":  47,
  "message":     "Ticket created",
  "ticket_id":   "01JXXXXX..."
}
```

### 2.2 Log Levels
| Level | When to use |
|---|---|
| `DEBUG` | Dev only — query params, cache hit/miss details |
| `INFO` | Normal operations — request in/out, ticket created, user synced |
| `WARNING` | Expected but notable — SLA nearly breached, AI confidence low, rate limit approaching |
| `ERROR` | Handled failures — IAM unreachable (using cached JWT), S3 upload failed, Celery task failed |
| `CRITICAL` | Service-threatening — DB connection lost, Redis unreachable, unhandled exception |

### 2.3 What to NEVER Log
```
❌ Authorization header or JWT token
❌ Passwords (should never exist, but just in case)
❌ API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
❌ Full request body if it could contain PII
❌ Full file contents
❌ Database connection strings
❌ User personal data (email, name) in anything above INFO level
```

### 2.4 Request Logging Middleware
```python
@app.middleware("http")
async def request_logger(request: Request, call_next):
    request_id = str(uuid7())
    request.state.request_id = request_id
    start = time.monotonic()

    # Log incoming (sanitized — no Authorization header value)
    logger.info("request_started", extra={
        "request_id": request_id,
        "method": request.method,
        "path": request.url.path,
        "client_ip": request.client.host,
    })

    response = await call_next(request)
    latency_ms = int((time.monotonic() - start) * 1000)

    logger.info("request_completed", extra={
        "request_id": request_id,
        "tenant_id": getattr(request.state, "tenant_id", None),
        "user_id": getattr(request.state, "user_id", None),
        "status": response.status_code,
        "latency_ms": latency_ms,
    })
    return response
```

### 2.5 system_logs DB Dual-Write Rule
```
Log level        → stdout/Loki only    → system_logs DB table
──────────────────────────────────────────────────────────────
DEBUG            ✓ (dev only)          ✗
INFO             ✓                     ✗
WARNING          ✓                     ✓  (visible to tenant admin in UI)
ERROR            ✓                     ✓  (visible to tenant admin in UI)
CRITICAL         ✓                     ✓  (triggers Sentry alert)
```

**Implementation** — custom Python logging handler:
```python
class SystemLogDBHandler(logging.Handler):
    def emit(self, record):
        if record.levelno < logging.WARNING:
            return  # DEBUG and INFO skip DB write
        async_to_sync(write_system_log)(
            level=record.levelname.lower(),
            event=record.getMessage(),
            tenant_id=getattr(record, "tenant_id", None),
            request_id=getattr(record, "request_id", None),
            exception_type=getattr(record, "exception_type", None),
            metadata=getattr(record, "extra_context", {}),
        )
```

**Purpose**: enables tenant admins and platform admins to query recent errors in the UI without needing Loki/CloudWatch access. Retention: 1 year.

### 2.6 Celery Task Logging
Every Celery task logs:
- Task name, task ID, tenant_id
- Start, success (with duration), failure (with exception class, NOT stack trace in prod)
- Retry attempt number when retrying

### 2.7 AI Call Logging
```json
{
  "level": "INFO",
  "event": "ai_call_completed",
  "tenant_id": "org_acme",
  "ai_feature": "ticket_classification",
  "model": "claude-sonnet-4-6",
  "input_tokens": 342,
  "output_tokens": 89,
  "latency_ms": 1240,
  "confidence": 0.87,
  "budget_remaining_tokens": 4_523_000
}
```
Token usage logged on every AI call — feeds the budget counter in Redis.

### 2.8 Audit Log (immutable, separate from application logs)
All writes to `platform_audit_log` (for cross-tenant and impersonation access) are also emitted as structured log events with `"event": "platform_audit"` — dual write to DB + log stream.

### 2.9 Log Aggregation
- **Dev**: stdout, readable via `docker-compose logs -f api`
- **Prod**: stdout → Fluent Bit → Loki (or CloudWatch/ELK depending on infra)
- **Retention**: INFO+ kept 90 days, WARNING+ kept 1 year, audit events kept 2 years

---

## 3. Exception Handling

### 3.1 Exception Hierarchy
```python
# app/exceptions.py

class ITSMError(Exception):
    """Base — all ITSM exceptions inherit from this"""
    status_code: int = 500
    error_code: str = "INTERNAL_ERROR"
    message: str = "An unexpected error occurred"

# 400 — Bad Request
class ValidationError(ITSMError):
    status_code = 400
    error_code = "VALIDATION_ERROR"

class InvalidStateTransitionError(ITSMError):
    status_code = 409
    error_code = "INVALID_STATE_TRANSITION"
    # carries: from_status, to_status, valid_transitions[]

class DuplicateIdempotencyKeyError(ITSMError):
    status_code = 200   # return original response, not an error
    error_code = "IDEMPOTENT_REPLAY"

# 401 / 403
class AuthenticationError(ITSMError):
    status_code = 401
    error_code = "AUTHENTICATION_REQUIRED"

class AuthorizationError(ITSMError):
    status_code = 403
    error_code = "INSUFFICIENT_PERMISSIONS"

class TenantSuspendedError(ITSMError):
    status_code = 403
    error_code = "TENANT_SUSPENDED"

class SubscriptionRequiredError(ITSMError):
    status_code = 403
    error_code = "SUBSCRIPTION_REQUIRED"

# 404
class ResourceNotFoundError(ITSMError):
    status_code = 404
    error_code = "NOT_FOUND"
    # carries: resource_type, resource_id

# 429
class RateLimitError(ITSMError):
    status_code = 429
    error_code = "RATE_LIMIT_EXCEEDED"

class AIBudgetExhaustedError(ITSMError):
    status_code = 429
    error_code = "AI_BUDGET_EXHAUSTED"

# 503
class ExternalServiceError(ITSMError):
    status_code = 503
    error_code = "EXTERNAL_SERVICE_UNAVAILABLE"
    # carries: service_name (iam, s3, anthropic, openai)
```

### 3.2 Global Exception Handler
```python
@app.exception_handler(ITSMError)
async def itsm_error_handler(request: Request, exc: ITSMError):
    # Log at appropriate level
    level = "error" if exc.status_code >= 500 else "warning"
    getattr(logger, level)("handled_exception", extra={
        "request_id": request.state.request_id,
        "tenant_id": getattr(request.state, "tenant_id", None),
        "error_code": exc.error_code,
        "status_code": exc.status_code,
        "exception_type": type(exc).__name__,
        # NO stack trace in response or logs at warning level
    })

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.error_code,
                "message": exc.message,
                "request_id": request.state.request_id,
                # extra context where safe (e.g. valid_transitions for 409)
                **exc.extra_context() if hasattr(exc, "extra_context") else {}
            }
        }
    )

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Log full stack trace for unhandled exceptions
    logger.critical("unhandled_exception", extra={
        "request_id": request.state.request_id,
        "tenant_id": getattr(request.state, "tenant_id", None),
        "exception_type": type(exc).__name__,
        "traceback": traceback.format_exc(),  # only in logs, never in response
    })
    # Report to Sentry
    sentry_sdk.capture_exception(exc)

    # Client gets no internal detail
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred",
                "request_id": request.state.request_id,
            }
        }
    )
```

### 3.3 Error Response Shape (consistent everywhere)
```json
{
  "error": {
    "code":       "INVALID_STATE_TRANSITION",
    "message":    "Cannot transition ticket from 'closed' to 'in_progress'",
    "request_id": "01JXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
    "details": {
      "from_status":       "closed",
      "to_status":         "in_progress",
      "valid_transitions": ["reopened"]
    }
  }
}
```

**Rules**:
- `code` — machine-readable, safe to match in client code
- `message` — human-readable, safe to show in UI
- `request_id` — always present — user pastes this when reporting an issue
- `details` — optional extra context for 4xx only. Never for 5xx (hides internals)
- Stack traces — **never in HTTP response, ever**

### 3.4 External Service Failures — Graceful Degradation
```
IAM down:
  → Cached JWT validation continues for 5 min (cached JWKS)
  → After 5 min: return 503 with Retry-After: 30
  → Celery user sync skipped silently, retried next cycle

AI (Claude/OpenAI) down:
  → Ticket creation SUCCEEDS — AI enrichment is async, not blocking
  → Celery task retries 3× with exponential backoff (15s, 60s, 240s)
  → After 3 failures: task moved to dead-letter queue, alert fired
  → Ticket remains without AI classification — no data loss

S3 down:
  → Presigned URL generation fails → 503 returned to client
  → Ticket/asset itself already created (attachments are optional)

Redis down:
  → Rate limiting disabled (fail-open — log warning, don't block requests)
  → Idempotency keys fall back to DB check (slower but correct)
  → Sessions still work (JWT is stateless)
  → AI token budget check skipped (log warning)
```

### 3.5 Celery Task Exception Handling
```python
@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=15,
    autoretry_for=(ExternalServiceError, ConnectionError),
    retry_backoff=True,          # 15s, 30s, 60s
    retry_backoff_max=300,
    retry_jitter=True,
)
def classify_ticket(self, ticket_id: str, tenant_id: str):
    try:
        ...
    except AIBudgetExhaustedError:
        # Don't retry — budget is exhausted, skip silently
        logger.warning("ai_budget_exhausted_skip", ...)
    except Exception as exc:
        logger.error("task_failed", extra={
            "task": self.name,
            "ticket_id": ticket_id,
            "tenant_id": tenant_id,
            "attempt": self.request.retries + 1,
            "exception": str(exc),
        })
        raise self.retry(exc=exc)
    # After max_retries: task goes to dead-letter queue
    # Alert fires via Flower + Sentry
```

### 3.6 Database Exception Handling
```
IntegrityError (unique violation)  → 409 Conflict with meaningful message
  e.g. idempotency_key collision   → return original cached response
  e.g. duplicate asset_tag         → "Asset tag AST-00123 already exists"

ForeignKeyViolationError           → 404 (referenced resource doesn't exist)
  e.g. invalid category_id         → "Category not found"

OperationalError (DB unreachable)  → 503, Sentry alert, circuit breaker opens
DataError (value out of range)     → 422 Unprocessable Entity

All DB errors:
  → Never expose raw psycopg/SQLAlchemy error message to client
  → Log full error internally with request_id
```

---

## 4. Database — Shared Server, Separate Databases

```
PostgreSQL Server (shared)
├── project_iq_db    (existing)
│   ├── user: piq_user
│   └── (no changes, untouched)
│
└── itsm_db          (new)
    ├── user: itsm_user
    ├── Extensions: uuid-ossp, pgvector, pg_trgm
    └── RLS enabled on all tenant-scoped tables
```

**Why separate databases (not schemas):**
- Full connection pool isolation — heavy ITSM query does not steal connections from chat service
- Separate `pg_dump` backups — restore ITSM without touching chat data
- Separate `GRANT` permissions — `itsm_user` cannot read `project_iq_db` even accidentally
- Clear migration paths — each service owns its own Alembic history

**Connection pool sizing:**
```env
# IQ-ITSM
DATABASE_URL=postgresql+asyncpg://itsm_user:xxx@shared-pg:5432/itsm_db
DB_POOL_SIZE=20           # API pods
DB_MAX_OVERFLOW=10
DB_POOL_TIMEOUT=30
# Celery workers use separate pool:
CELERY_DB_POOL_SIZE=5
```
