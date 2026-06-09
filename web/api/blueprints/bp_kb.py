"""
Knowledge Base, Firecrawl, and Airbyte connectors blueprint.
Routes: /admin/kb/*, /admin/firecrawl/*, /admin/connectors/*
"""
import requests as _requests
from flask import Blueprint, request, jsonify
from common.config_manager import get_all_config as get_file_config, set_all_config as save_file_config

bp = Blueprint('kb', __name__)


def _kb_cache():
    """Deferred accessor — avoids circular import with web_api.py."""
    import web.api.web_api as _m
    return _m.admin_kb_cache


# ── KB status / articles ──────────────────────────────────────────────────────

@bp.route('/admin/kb/status', methods=['GET'])
def get_kb_status():
    try:
        status = dict(_kb_cache().get_status())
        # Merge in semantic-search/model stats from the live search cache
        # (KBCacheManager) — the admin browse cache doesn't track those.
        try:
            from web.api.kb_cache_manager import kb_cache as _search_cache
            info = _search_cache.get_cache_info()
            status['refresh_interval'] = info.get('refresh_interval')
            status['model_info'] = {
                'model_name': info.get('model_name'),
                'embedding_dimension': info.get('embedding_dimension'),
            }
            status['cache_size_mb'] = info.get('cache_size_mb')
            status['semantic_enabled'] = info.get('semantic_enabled')
        except Exception:
            pass
        return jsonify({"success": True, "status": status})
    except Exception as e:
        return jsonify({"success": False, "error": str(e),
                        "status": {"article_count": 0, "last_refresh": None}}), 500


@bp.route('/admin/kb/refresh', methods=['POST'])
def refresh_kb_cache():
    try:
        cache   = _kb_cache()
        success = cache.load_articles()
        status  = cache.get_status()
        if success:
            return jsonify({"success": True,
                            "message": f"Refreshed {status['article_count']} articles.", "status": status})
        return jsonify({"success": False, "message": "Refresh failed — check logs.", "status": status}), 500
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/kb/articles', methods=['GET'])
def get_kb_articles():
    try:
        cache  = _kb_cache()
        result = cache.get_articles(
            page=int(request.args.get('page', 1)),
            limit=int(request.args.get('limit', 50)),
            search_filter=request.args.get('filter', '')
        )
        return jsonify({"success": True, **result, "source": getattr(cache, 'source', 'glpi')})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "articles": []}), 500


@bp.route('/admin/kb/gaps', methods=['GET'])
def get_kb_gaps():
    """Return top unanswered queries — Knowledge Gap report."""
    try:
        from common.db._kb_gaps import get_kb_gaps
        days   = int(request.args.get('days', 7))
        limit  = int(request.args.get('limit', 20))
        app_id = request.args.get('app_id') or None
        gaps   = get_kb_gaps(days=days, limit=limit, app_id=app_id)
        return jsonify({'success': True, 'data': gaps, 'days': days})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/admin/kb/search', methods=['POST'])
def test_kb_search():
    try:
        from web.api.kb_cache_manager import kb_cache
        data  = request.get_json() or {}
        query = data.get('query', '')
        if not query:
            return jsonify({"success": False, "error": "query required"}), 400
        results = kb_cache.search_articles(query)
        formatted = [{
            "article": {k: r['article'].get(k) for k in
                        ('id', 'title', 'category', 'source', 'glpi_id', 'itsm_id', 'is_faq', 'date_modified')},
            "scores": {
                "final_score":    round(r.get('score', 0), 3),
                "semantic_score": round(r.get('semantic_score', 0), 3),
                "keyword_score":  round(r.get('keyword_score', 0), 3),
            },
            "source": r.get('source', 'unknown'),
        } for r in results]
        return jsonify({"success": True, "query": query,
                        "result_count": len(formatted), "results": formatted})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"success": False, "error": str(e), "results": []}), 500


# ── Firecrawl ingestion ────────────────────────────────────────────────────────

@bp.route('/admin/kb/ingest-url', methods=['POST'])
def ingest_url():
    try:
        data     = request.get_json() or {}
        url      = data.get('url', '')
        category = data.get('category')
        if not url:
            return jsonify({"success": False, "error": "url required"}), 400
        from common.firecrawl_ingester import ingest_url_to_kb
        return jsonify({"success": True, **ingest_url_to_kb(url, category)})
    except (ImportError, ValueError) as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/kb/crawl-site', methods=['POST'])
def crawl_site_endpoint():
    try:
        data = request.get_json() or {}
        url  = data.get('url', '')
        if not url:
            return jsonify({"success": False, "error": "url required"}), 400
        from common.firecrawl_ingester import ingest_crawl_to_kb
        return jsonify({"success": True, **ingest_crawl_to_kb(url, data.get('limit', 50), data.get('category'))})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/kb/ingest-urls', methods=['POST'])
def ingest_urls():
    try:
        data = request.get_json() or {}
        urls = data.get('urls', [])
        if not urls or not isinstance(urls, list):
            return jsonify({"success": False, "error": "urls (list) required"}), 400
        from common.firecrawl_ingester import ingest_batch_to_kb
        return jsonify({"success": True, **ingest_batch_to_kb(urls, data.get('category'))})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/kb/data-sources', methods=['GET'])
def get_data_sources():
    try:
        from common.firecrawl_ingester import get_data_sources as _gs
        return jsonify({"success": True, "data": _gs()})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "data": []}), 500


# ── Firecrawl config / test ────────────────────────────────────────────────────

@bp.route('/admin/firecrawl/config', methods=['GET'])
def get_firecrawl_config():
    try:
        cfg = get_file_config()
        return jsonify({"success": True,
                        "api_key": cfg.get('FIRECRAWL_API_KEY', ''),
                        "api_url": cfg.get('FIRECRAWL_API_URL', 'http://localhost:3002')})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/firecrawl/config', methods=['POST'])
def save_firecrawl_config():
    try:
        data = request.get_json() or {}
        save_file_config({'FIRECRAWL_API_KEY': data.get('api_key', 'fc-selfhosted'),
                          'FIRECRAWL_API_URL': data.get('api_url', 'http://localhost:3002')})
        return jsonify({"success": True, "message": "Firecrawl config saved"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/firecrawl/test', methods=['POST'])
def test_firecrawl_connection():
    try:
        data    = request.get_json() or {}
        cfg     = get_file_config()
        api_url = (data.get('api_url') or cfg.get('FIRECRAWL_API_URL', 'http://localhost:3002')).rstrip('/')
        resp    = _requests.get(api_url + '/', timeout=5)
        ok      = resp.status_code == 200
        msg     = "Firecrawl is running" if (ok and 'firecrawl' in resp.text.lower()) else \
                  ("Server reachable" if ok else f"Unexpected status {resp.status_code}")
        return jsonify({"success": ok, "message": msg, "status_code": resp.status_code})
    except Exception as e:
        return jsonify({"success": False, "error": str(e),
                        "message": "Could not reach Firecrawl"}), 200


@bp.route('/admin/firecrawl/crawl-jobs', methods=['GET'])
def get_firecrawl_crawl_jobs():
    try:
        from common.firecrawl_ingester import get_data_sources as _gs
        return jsonify({"success": True,
                        "data": [s for s in _gs() if 'firecrawl' in s.get('source_type', '').lower()]})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "data": []}), 500


# ── Airbyte connectors ────────────────────────────────────────────────────────

@bp.route('/admin/connectors/sources', methods=['GET'])
def list_connector_sources():
    try:
        from common.airbyte_connector import list_available_sources
        return jsonify({"success": True, "sources": list_available_sources()})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/connectors/sources/<source_type>/schema', methods=['GET'])
def get_connector_schema(source_type):
    try:
        from common.airbyte_connector import get_source_config_schema
        schema = get_source_config_schema(source_type)
        if schema:
            return jsonify({"success": True, "schema": schema})
        return jsonify({"success": False, "error": f"Unknown source type: {source_type}"}), 404
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/connectors/sync', methods=['POST'])
def sync_connector():
    try:
        data        = request.get_json() or {}
        source_type = data.get('source_type', '')
        config      = data.get('config', {})
        if not source_type or not config:
            return jsonify({"success": False, "error": "source_type and config required"}), 400
        from common.airbyte_connector import sync_source
        return jsonify({"success": True, **sync_source(source_type, config, data.get('streams'))})
    except (ImportError, ValueError) as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500
