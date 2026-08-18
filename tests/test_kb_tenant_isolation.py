"""
KB org_id (tenant) isolation — regression test for the fix to a dead-parameter
bug where `search_articles(query, app_id=None)` never actually filtered by
identity, so any tenant's bot could retrieve any other tenant's KB articles.

Covers both retrieval mechanisms that read the local KB mirror:
  • web/api/kb_cache_manager.py  search_articles()  (keyword/whole-article path)
  • common/vector_search.py      _mem_search()       (in-memory chunk path)

Run:  python -m pytest tests/test_kb_tenant_isolation.py -v
"""
import numpy as np

from web.api.kb_cache_manager import KBCacheManager
from common import vector_search


def _bare_cache_manager(cache):
    """Construct a KBCacheManager without running its heavy __init__ (config
    load, background refresh thread, itsm sync) — only the attributes
    search_articles() actually reads are needed here."""
    mgr = object.__new__(KBCacheManager)
    mgr._cache = cache
    mgr.semantic_enabled = False  # keyword-only path — deterministic, no model load
    mgr._embeddings = None
    mgr._model = None
    mgr.semantic_weight = 0.6
    mgr.keyword_weight = 0.4
    mgr.min_score_threshold = 0.0  # any keyword overlap counts, for a deterministic test
    mgr.max_results = 10
    return mgr


ARTICLES = [
    {"id": "a1", "title": "billing invoice help", "keywords": [], "question": "", "org_id": "org-a"},
    {"id": "b1", "title": "billing invoice help", "keywords": [], "question": "", "org_id": "org-b"},
    {"id": "s1", "title": "billing invoice help", "keywords": [], "question": "", "org_id": None},
]


def test_search_articles_scopes_to_org():
    mgr = _bare_cache_manager(ARTICLES)
    ids = {r["article"]["id"] for r in mgr.search_articles("billing invoice", org_id="org-a")}
    assert ids == {"a1", "s1"}  # own org + shared, never org-b


def test_search_articles_excludes_other_org():
    mgr = _bare_cache_manager(ARTICLES)
    ids = {r["article"]["id"] for r in mgr.search_articles("billing invoice", org_id="org-b")}
    assert "a1" not in ids
    assert ids == {"b1", "s1"}


def test_search_articles_unscoped_call_is_unfiltered():
    """org_id=None (e.g. admin console) keeps today's behavior — all articles visible."""
    mgr = _bare_cache_manager(ARTICLES)
    ids = {r["article"]["id"] for r in mgr.search_articles("billing invoice")}
    assert ids == {"a1", "b1", "s1"}


class _FakeModel:
    def encode(self, query):
        return np.array([1.0, 0.0])


def test_vector_mem_search_scopes_to_org(monkeypatch):
    chunks = [
        {"article_id": "a1", "title": "a", "content": "a", "chunk_index": 0, "org_id": "org-a"},
        {"article_id": "b1", "title": "b", "content": "b", "chunk_index": 0, "org_id": "org-b"},
        {"article_id": "s1", "title": "s", "content": "s", "chunk_index": 0, "org_id": None},
    ]
    embeddings = np.array([[1.0, 0.0], [1.0, 0.0], [1.0, 0.0]])  # all equally similar
    monkeypatch.setattr(vector_search, "_chunks", chunks)
    monkeypatch.setattr(vector_search, "_embeddings", embeddings)
    monkeypatch.setattr(vector_search, "get_model", lambda: _FakeModel())

    results = vector_search._mem_search("query", top_k=10, org_id="org-a")
    ids = {r["article_id"] for r in results}
    assert ids == {"a1", "s1"}


def test_vector_mem_search_unscoped_is_unfiltered(monkeypatch):
    chunks = [
        {"article_id": "a1", "title": "a", "content": "a", "chunk_index": 0, "org_id": "org-a"},
        {"article_id": "b1", "title": "b", "content": "b", "chunk_index": 0, "org_id": "org-b"},
    ]
    embeddings = np.array([[1.0, 0.0], [1.0, 0.0]])
    monkeypatch.setattr(vector_search, "_chunks", chunks)
    monkeypatch.setattr(vector_search, "_embeddings", embeddings)
    monkeypatch.setattr(vector_search, "get_model", lambda: _FakeModel())

    results = vector_search._mem_search("query", top_k=10, org_id=None)
    ids = {r["article_id"] for r in results}
    assert ids == {"a1", "b1"}
