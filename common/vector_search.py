"""
Vector Search Module for KB
Primary backend: pgvector (PostgreSQL) — persisted, indexed, survives restarts.
Fallback: in-memory numpy — used automatically if pgvector extension is not available.
"""
import os
import sys
import json
import logging
import numpy as np
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from sentence_transformers import SentenceTransformer

# Default embedder. paraphrase-multilingual-MiniLM-L12-v2 is multilingual
# (~50 languages, incl. de/fr/es/ar) AND 384-dim — identical to the legacy
# English all-MiniLM-L6-v2 — so the kb_chunks.embedding vector(384) column is
# unchanged; switching models only requires a re-embed (rebuild index).
# Overridable via [KNOWLEDGE_BASE] KB_SEMANTIC_MODEL.
DEFAULT_MODEL = "paraphrase-multilingual-MiniLM-L12-v2"
EMBEDDING_DIM = 384
CHUNK_SIZE   = 150  # words per chunk


def _resolve_model_name() -> str:
    try:
        from common.config_manager import get_kb_config
        return get_kb_config().get('semantic_model') or DEFAULT_MODEL
    except Exception:
        return DEFAULT_MODEL


# Resolved lazily in get_model(); kept module-level for back-compat references.
MODEL_NAME = _resolve_model_name()

# ── Globals (in-memory fallback only) ────────────────────────────────────────
_model: Optional[SentenceTransformer] = None
_chunks: List[Dict] = []
_embeddings = None
_use_pgvector: Optional[bool] = None   # None = not yet detected
_pg_model_verified = False             # True once kb_chunks confirmed built with the active model

# Legacy cache file (only used by fallback path)
CACHE_FILE = os.path.join(os.path.dirname(__file__), "kb_embeddings_cache.json")


def get_model() -> SentenceTransformer:
    global _model, MODEL_NAME
    if _model is None:
        MODEL_NAME = _resolve_model_name()
        logger.info("Loading embedding model: %s", MODEL_NAME)
        _model = SentenceTransformer(MODEL_NAME)
    return _model


_PG_MODEL_KEY = 'kb_embedding_model'


def _persisted_pg_model() -> Optional[str]:
    """Model name that the current kb_chunks vectors were built with (None if unknown)."""
    try:
        from common.db._config import get_config
        return (get_config(_PG_MODEL_KEY) or {}).get(_PG_MODEL_KEY)
    except Exception:
        return None


def _record_pg_model(name: str):
    try:
        from common.db._config import set_config
        set_config(_PG_MODEL_KEY, name)
    except Exception as e:
        logger.warning("Could not record KB embedding model: %s", e)


def _pgvector_available() -> bool:
    """Detect once whether pgvector extension is present."""
    global _use_pgvector
    if _use_pgvector is not None:
        return _use_pgvector
    try:
        from common.conversation_db import _get_connection, _release_connection
        conn = _get_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
            _use_pgvector = cur.fetchone() is not None
        finally:
            _release_connection(conn)
    except Exception:
        _use_pgvector = False
    logger.info("pgvector available: %s", _use_pgvector)
    return _use_pgvector


def backend_mode() -> str:
    """Which KB search backend is actually active — surfaces silent fallbacks.

    'pgvector'     : persisted vector index (best).
    'memory'       : in-memory vectors (sentence-transformers importable, no pgvector).
    'keyword-only' : sentence-transformers unavailable → keyword search only.
    """
    try:
        if _pgvector_available():
            return 'pgvector'
    except Exception:
        pass
    try:
        import sentence_transformers  # noqa: F401
        return 'memory'
    except Exception:
        return 'keyword-only'


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE) -> List[str]:
    if not text:
        return []
    words = text.split()
    return [
        ' '.join(words[i:i + chunk_size])
        for i in range(0, len(words), chunk_size)
        if len(' '.join(words[i:i + chunk_size])) > 30
    ]


# ── pgvector path ─────────────────────────────────────────────────────────────

def _pg_search(query: str, top_k: int) -> List[Dict]:
    """Run cosine-similarity search via pgvector <=> operator."""
    from common.conversation_db import _get_connection, _release_connection
    model = get_model()
    q_vec = model.encode(query).tolist()

    conn = _get_connection()
    try:
        from psycopg2.extras import RealDictCursor
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT article_id,
                   title,
                   content,
                   category,
                   chunk_index,
                   1 - (embedding <=> %s::vector) AS similarity
            FROM   kb_chunks
            ORDER  BY embedding <=> %s::vector
            LIMIT  %s
            """,
            (q_vec, q_vec, top_k)
        )
        rows = cur.fetchall()
    finally:
        _release_connection(conn)

    return [dict(r) for r in rows]


def _pg_load_and_process() -> int:
    """Re-embed all kb_articles and store in kb_chunks (pgvector path)."""
    from common.conversation_db import _get_connection, _release_connection
    model = get_model()

    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id, title, content, category FROM kb_articles")
        articles = cur.fetchall()
    finally:
        _release_connection(conn)

    logger.info("Processing %d articles...", len(articles))
    all_chunks, all_texts = [], []
    for article_id, title, content, category in articles:
        if not content:
            continue
        for idx, chunk in enumerate(chunk_text(content)):
            all_chunks.append((article_id, idx, title, chunk, category or 'General'))
            all_texts.append(chunk)

    if not all_texts:
        return 0

    embeddings = model.encode(all_texts, show_progress_bar=True, batch_size=64)

    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM kb_chunks")
        for (article_id, idx, title, chunk, category), emb in zip(all_chunks, embeddings):
            cur.execute(
                """
                INSERT INTO kb_chunks (article_id, chunk_index, title, content, category, embedding)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (article_id, idx, title, chunk, category, emb.tolist())
            )
        # Rebuild ivfflat index (safe to run even if index doesn't exist yet)
        try:
            cur.execute("DROP INDEX IF EXISTS kb_chunks_embedding_idx")
            cur.execute(
                """
                CREATE INDEX kb_chunks_embedding_idx
                ON kb_chunks USING ivfflat (embedding vector_cosine_ops)
                WITH (lists = 100)
                """
            )
        except Exception as idx_err:
            logger.warning("Index rebuild note: %s", idx_err)
        conn.commit()
    finally:
        _release_connection(conn)

    global _pg_model_verified
    _record_pg_model(_resolve_model_name())
    _pg_model_verified = True
    logger.info("Stored %d chunks in pgvector.", len(all_chunks))
    return len(all_chunks)


# ── In-memory fallback path ───────────────────────────────────────────────────

def _mem_load_and_process() -> int:
    global _chunks, _embeddings
    from common.conversation_db import _get_connection, _release_connection

    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id, title, content, category FROM kb_articles")
        articles = cur.fetchall()
    finally:
        _release_connection(conn)

    model = get_model()
    all_chunks, all_texts = [], []
    for article_id, title, content, category in articles:
        if not content:
            continue
        for idx, chunk in enumerate(chunk_text(content)):
            all_chunks.append({
                "article_id": article_id, "title": title,
                "content": chunk, "category": category or "General",
                "chunk_index": idx,
            })
            all_texts.append(chunk)

    if not all_texts:
        return 0

    embeddings = model.encode(all_texts, show_progress_bar=True, batch_size=64)
    _chunks = all_chunks
    _embeddings = embeddings
    _mem_save_cache()
    logger.info("In-memory: %d chunks ready.", len(_chunks))
    return len(_chunks)


def _mem_save_cache():
    global _chunks, _embeddings
    try:
        with open(CACHE_FILE, 'w') as f:
            json.dump({"model": _resolve_model_name(),
                       "chunks": _chunks,
                       "embeddings": _embeddings.tolist() if _embeddings is not None else []}, f)
    except Exception as e:
        logger.warning("Cache save error: %s", e)


def _mem_load_cache() -> bool:
    global _chunks, _embeddings
    if not os.path.exists(CACHE_FILE):
        return False
    try:
        with open(CACHE_FILE) as f:
            data = json.load(f)
        if data.get("model") and data.get("model") != _resolve_model_name():
            logger.info("KB cache built with a different embedder; ignoring stale cache")
            return False
        _chunks = data.get("chunks", [])
        raw = data.get("embeddings", [])
        _embeddings = np.array(raw) if raw else None
        return bool(_chunks)
    except Exception as e:
        logger.warning("Cache load error: %s", e)
        return False


def _mem_ensure_loaded():
    if not _chunks or _embeddings is None:
        if not _mem_load_cache():
            _mem_load_and_process()


def _mem_search(query: str, top_k: int) -> List[Dict]:
    _mem_ensure_loaded()
    if not _chunks or _embeddings is None:
        return []
    model = get_model()
    q_vec = model.encode(query)
    sims = np.dot(_embeddings, q_vec) / (
        np.linalg.norm(_embeddings, axis=1) * np.linalg.norm(q_vec) + 1e-10
    )
    top_idx = np.argsort(sims)[-top_k:][::-1]
    results = []
    for i in top_idx:
        chunk = _chunks[i].copy()
        chunk["similarity"] = float(sims[i])
        results.append(chunk)
    return results


# ── Public API (unchanged from previous version) ─────────────────────────────

def load_and_process_articles() -> int:
    """Re-embed all articles. Uses pgvector if available, falls back to in-memory."""
    if _pgvector_available():
        return _pg_load_and_process()
    return _mem_load_and_process()


def ensure_loaded():
    """Ensure search is ready. For pgvector, also guards against a stale index:
    if kb_chunks was built with a different embedding model than the active one
    (e.g. after the multilingual swap), querying new vectors against old ones
    yields garbage — so re-embed once. The check is cached per process."""
    global _pg_model_verified
    if _pgvector_available():
        if _pg_model_verified:
            return
        try:
            active = _resolve_model_name()
            if _persisted_pg_model() == active:
                _pg_model_verified = True
            else:
                logger.warning("KB embedder changed -> '%s'; re-embedding kb_chunks", active)
                _pg_load_and_process()   # sets _pg_model_verified
        except Exception as e:
            logger.warning("KB embedder verify/rebuild skipped: %s", e)
            _pg_model_verified = True     # don't thrash on every query
        return
    _mem_ensure_loaded()


def search(query: str, top_k: int = 1) -> List[Dict]:
    """Return top_k chunks most similar to query."""
    if _pgvector_available():
        return _pg_search(query, top_k)
    return _mem_search(query, top_k)


def search_single(query: str) -> Optional[Dict]:
    """Return the single best matching chunk."""
    results = search(query, top_k=1)
    return results[0] if results else None


# ── CLI ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="KB Vector Search")
    parser.add_argument("--rebuild", action="store_true", help="Rebuild embeddings")
    parser.add_argument("--query",   type=str,            help="Search query")
    args = parser.parse_args()

    if args.rebuild:
        n = load_and_process_articles()
        print(f"Done — {n} chunks indexed.")

    if args.query:
        results = search(args.query, top_k=3)
        print(f"\nResults for: '{args.query}'")
        for r in results:
            print(f"  [{r.get('similarity', 0):.3f}] {r['title']}")
            print(f"  {r['content'][:200]}...\n")

    if not args.rebuild and not args.query:
        ensure_loaded()
        print(f"Backend: {'pgvector' if _pgvector_available() else 'in-memory'}")
        print(f"Chunks ready: {len(_chunks) if not _pgvector_available() else 'stored in DB'}")
