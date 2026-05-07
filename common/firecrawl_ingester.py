"""
Firecrawl URL Ingester Module
Scrapes/crawls URLs using Firecrawl and ingests them into the KB pipeline.
"""

import os
import sys
import re
import json
import hashlib
import logging
from typing import List, Dict, Optional, Any
from datetime import datetime

# Add project root to path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

logger = logging.getLogger(__name__)


def _get_firecrawl_config():
    """Get Firecrawl API URL and key from config."""
    from common.config_manager import load_config
    config = load_config()
    api_key = config.get('FIRECRAWL', 'FIRECRAWL_API_KEY', fallback='fc-selfhosted')
    api_url = config.get('FIRECRAWL', 'FIRECRAWL_API_URL', fallback='http://localhost:3002')
    return api_url.rstrip('/'), api_key


def _firecrawl_post(endpoint: str, payload: dict) -> dict:
    """POST to Firecrawl REST API. Returns parsed JSON."""
    import requests
    api_url, api_key = _get_firecrawl_config()
    url = f"{api_url}{endpoint}"
    headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key}'}
    resp = requests.post(url, json=payload, headers=headers, timeout=60)
    resp.raise_for_status()
    return resp.json()


def _firecrawl_get(endpoint: str) -> dict:
    """GET from Firecrawl REST API. Returns parsed JSON."""
    import requests
    api_url, api_key = _get_firecrawl_config()
    url = f"{api_url}{endpoint}"
    headers = {'Authorization': f'Bearer {api_key}'}
    resp = requests.get(url, headers=headers, timeout=60)
    resp.raise_for_status()
    return resp.json()


def _generate_article_id(url: str, chunk_index: int = 0) -> str:
    """Generate a deterministic article ID from URL + chunk index."""
    raw = f"firecrawl:{url}:{chunk_index}"
    return hashlib.md5(raw.encode()).hexdigest()


def _clean_markdown(text: str) -> str:
    """Clean up markdown content for KB storage."""
    if not text:
        return ""
    
    # Remove excessive whitespace/newlines
    text = re.sub(r'\n{3,}', '\n\n', text)
    # Remove navigation/cookie banners (common patterns)
    text = re.sub(r'(?i)(skip to (?:main )?content|accept cookies|cookie policy).*?\n', '', text)
    
    return text.strip()


def _extract_title(metadata: dict, markdown: str) -> str:
    """Extract best title from metadata or content."""
    # Try metadata title first
    title = metadata.get('title') or metadata.get('ogTitle', '')
    if title:
        return title.strip()

    # Try first H1 from markdown
    h1_match = re.search(r'^#\s+(.+)$', markdown, re.MULTILINE)
    if h1_match:
        return h1_match.group(1).strip()

    # Fallback to URL
    source_url = metadata.get('sourceURL', '') or metadata.get('url', '')
    if source_url:
        return source_url.split('/')[-1].replace('-', ' ').replace('_', ' ').title()

    return "Untitled Article"


def _doc_to_dict(doc) -> dict:
    """Convert a Firecrawl v2 Document (or dict) to a plain dict."""
    if isinstance(doc, dict):
        return doc
    # Pydantic model — extract fields we need
    result = {}
    result['markdown'] = getattr(doc, 'markdown', None) or ''
    result['content'] = result['markdown']
    # metadata may be a DocumentMetadata pydantic model or a dict
    meta = getattr(doc, 'metadata', None)
    if meta is None:
        result['metadata'] = {}
    elif isinstance(meta, dict):
        result['metadata'] = meta
    else:
        # Pydantic model — convert to dict
        try:
            result['metadata'] = meta.model_dump(exclude_none=True)
            # Include extra fields
            extra = getattr(meta, '__pydantic_extra__', None)
            if isinstance(extra, dict):
                result['metadata'].update({k: v for k, v in extra.items() if v is not None})
        except Exception:
            result['metadata'] = {}
    return result


def _process_to_article(data, source_url: str, category: str = None) -> Dict:
    """Transform Firecrawl scrape result (dict or Document) into KB article format."""
    data = _doc_to_dict(data)
    markdown = data.get('markdown', '') or data.get('content', '')
    metadata = data.get('metadata', {})

    title = _extract_title(metadata, markdown)
    content = _clean_markdown(markdown)

    if not content or len(content) < 30:
        return None

    # Extract keywords from metadata
    keywords = []
    kw = metadata.get('keywords', '')
    if isinstance(kw, list):
        keywords = [k.strip() for k in kw if k]
    elif isinstance(kw, str) and kw:
        keywords = [k.strip() for k in kw.split(',')]
    desc = metadata.get('description', '')
    if desc:
        keywords.append(str(desc)[:100])

    article_id = _generate_article_id(source_url)
    effective_category = category or metadata.get('ogSiteName', '') or metadata.get('og_site_name', '') or 'Web'

    return {
        "id": article_id,
        "title": title,
        "content": content,
        "category": effective_category,
        "keywords": keywords,
        "source_url": source_url,
        "source_type": "firecrawl_scrape",
        "scraped_at": datetime.now().isoformat()
    }


def scrape_url(url: str, category: str = None) -> Dict:
    """
    Scrape a single URL and return it as a KB article.
    
    Args:
        url: The URL to scrape
        category: Optional category for the article
        
    Returns:
        Article dict ready for add_kb_article(), or None on failure
    """
    logger.info(f"Scraping URL: {url}")

    try:
        data = _firecrawl_post('/v1/scrape', {"url": url, "formats": ["markdown"], "blockAds": True})
    except Exception as e:
        try:
            data = _firecrawl_post('/v1/scrape', {"url": url, "formats": ["markdown"], "mobile": True})
        except Exception as e2:
            logger.error(f"Firecrawl scrape failed for {url}: {e2}")
            raise RuntimeError(f"Failed to scrape {url}: {e2}")

    # REST API returns {"success": true, "data": {...}}
    doc = data.get('data') or data
    if not doc:
        raise RuntimeError(f"Scrape returned no data for {url}")

    article = _process_to_article(doc, url, category)
    if not article:
        raise RuntimeError(f"Could not extract meaningful content from {url}")
    return article


def crawl_site(url: str, limit: int = 50, category: str = None) -> List[Dict]:
    """
    Crawl a website recursively and return all pages as KB articles.
    
    Args:
        url: Base URL to start crawling
        limit: Maximum number of pages to crawl
        category: Optional category for all articles
        
    Returns:
        List of article dicts
    """
    logger.info(f"Crawling site: {url} (limit={limit})")

    import time, requests as _req
    try:
        # Start crawl job
        job = _firecrawl_post('/v1/crawl', {
            "url": url,
            "limit": limit,
            "scrapeOptions": {"formats": ["markdown"], "blockAds": True}
        })
        job_id = job.get('id') or job.get('jobId')
        if not job_id:
            raise RuntimeError(f"No job ID returned from crawl: {job}")

        # Poll until complete (max 5 min)
        for _ in range(60):
            time.sleep(5)
            status = _firecrawl_get(f'/v1/crawl/{job_id}')
            if status.get('status') == 'completed':
                break
            if status.get('status') == 'failed':
                raise RuntimeError(f"Crawl job failed: {status.get('error')}")

        docs = status.get('data', [])
    except Exception as e:
        logger.error(f"Firecrawl crawl failed for {url}: {e}")
        raise RuntimeError(f"Failed to crawl {url}: {e}")

    articles = []
    for i, doc in enumerate(docs):
        doc_dict = _doc_to_dict(doc)
        meta = doc_dict.get('metadata', {})
        source_url = meta.get('sourceURL') or meta.get('url') or f"{url}#page-{i}"
        article = _process_to_article(doc_dict, source_url, category)
        if article:
            # Give unique IDs for each crawled page
            article['id'] = _generate_article_id(source_url)
            article['source_type'] = 'firecrawl_crawl'
            articles.append(article)

    logger.info(f"Crawl complete: {len(articles)} articles from {url}")
    return articles


def batch_scrape(urls: List[str], category: str = None) -> List[Dict]:
    """
    Scrape multiple URLs and return them as KB articles.
    
    Args:
        urls: List of URLs to scrape
        category: Optional category for all articles
        
    Returns:
        List of article dicts (skips failures)
    """
    logger.info(f"Batch scraping {len(urls)} URLs")
    
    articles = []
    errors = []
    
    for url in urls:
        try:
            article = scrape_url(url, category)
            if article:
                articles.append(article)
        except Exception as e:
            errors.append({"url": url, "error": str(e)})
            logger.warning(f"Skipping {url}: {e}")

    logger.info(f"Batch scrape complete: {len(articles)} success, {len(errors)} failed")
    return articles, errors


def ingest_url_to_kb(url: str, category: str = None) -> Dict:
    """
    Full pipeline: scrape URL → save to KB → rebuild embeddings.
    
    Returns:
        Result dict with status and article info
    """
    from common.conversation_db import add_kb_article
    
    article = scrape_url(url, category)
    
    success = add_kb_article(
        article_id=article['id'],
        title=article['title'],
        content=article['content'],
        category=article['category'],
        keywords=article['keywords']
    )
    
    if not success:
        raise RuntimeError(f"Failed to save article to database for {url}")

    _save_article_to_glpi(article['title'], article['content'], article.get('category', ''))
    log_data_source('firecrawl_url', {'url': url, 'category': category or ''}, 1)
    _rebuild_embeddings()

    return {
        "status": "success",
        "article_id": article['id'],
        "title": article['title'],
        "content_length": len(article['content']),
        "category": article['category'],
        "source_url": url
    }


def ingest_crawl_to_kb(url: str, limit: int = 50, category: str = None) -> Dict:
    """
    Full pipeline: crawl site → save all pages to KB → rebuild embeddings.
    
    Returns:
        Result dict with status and summary
    """
    from common.conversation_db import add_kb_article
    
    articles = crawl_site(url, limit, category)
    
    saved = 0
    for article in articles:
        success = add_kb_article(
            article_id=article['id'],
            title=article['title'],
            content=article['content'],
            category=article['category'],
            keywords=article['keywords']
        )
        if success:
            saved += 1

    if saved > 0:
        for article in articles:
            _save_article_to_glpi(article['title'], article['content'], article.get('category', ''))
        log_data_source('firecrawl_crawl', {'url': url, 'limit': limit, 'category': category or ''}, saved)
        _rebuild_embeddings()

    return {
        "status": "success",
        "total_pages": len(articles),
        "saved": saved,
        "source_url": url,
        "articles": [
            {"id": a['id'], "title": a['title'], "content_length": len(a['content'])}
            for a in articles
        ]
    }


def ingest_batch_to_kb(urls: List[str], category: str = None) -> Dict:
    """
    Full pipeline: batch scrape URLs → save to KB → rebuild embeddings.
    """
    from common.conversation_db import add_kb_article
    
    articles, errors = batch_scrape(urls, category)
    
    saved = 0
    for article in articles:
        success = add_kb_article(
            article_id=article['id'],
            title=article['title'],
            content=article['content'],
            category=article['category'],
            keywords=article['keywords']
        )
        if success:
            saved += 1

    if saved > 0:
        for article in articles:
            _save_article_to_glpi(article['title'], article['content'], article.get('category', ''))
        log_data_source('firecrawl_batch', {'urls': urls[:5], 'category': category or ''}, saved)
        _rebuild_embeddings()

    return {
        "status": "success",
        "total_urls": len(urls),
        "scraped": len(articles),
        "saved": saved,
        "errors": errors
    }


def _save_article_to_glpi(title: str, content: str, category: str = '') -> bool:
    """Save a scraped article to ITSM KB using synchronous requests (no asyncio)."""
    try:
        import requests as _req
        from common.config_manager import load_config
        config = load_config()
        api_uri   = config.get('GLPI', 'GLPI_API_URL',   fallback='').rstrip('/')
        app_token = config.get('GLPI', 'GLPI_APP_TOKEN',  fallback='')
        user_token = config.get('GLPI', 'GLPI_USER_TOKEN', fallback='')
        if not api_uri or not app_token or not user_token:
            return False
        headers_init = {'App-Token': app_token, 'Authorization': f'user_token {user_token}'}
        r = _req.get(f"{api_uri}/initSession", headers=headers_init, timeout=10)
        if r.status_code != 200:
            return False
        session_token = r.json().get('session_token')
        if not session_token:
            return False
        headers_exec = {'App-Token': app_token, 'Session-Token': session_token, 'Content-Type': 'application/json'}
        _req.post(f"{api_uri}/KnowbaseItem", json={"input": {"name": title, "answer": content}},
                  headers=headers_exec, timeout=15)
        _req.get(f"{api_uri}/killSession", headers=headers_exec, timeout=5)
        return True
    except Exception as e:
        logger.warning(f"Could not save article to ITSM KB: {e}")
        return False


def _rebuild_embeddings():
    """Rebuild the vector search embeddings cache."""
    try:
        from common.vector_search import load_and_process_articles
        load_and_process_articles()
        logger.info("Embeddings cache rebuilt successfully")
    except Exception as e:
        logger.warning(f"Could not rebuild embeddings (non-critical): {e}")


# =====================
# DATA SOURCE TRACKING
# =====================

def log_data_source(source_type: str, source_config: dict, articles_count: int):
    """Log a data source ingestion to the kb_data_sources table."""
    from common.conversation_db import _get_connection, _release_connection

    conn = _get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO kb_data_sources (source_type, source_config, articles_count, last_sync, status)
            VALUES (%s, %s, %s, %s, 'active')
        ''', (source_type, json.dumps(source_config), articles_count, datetime.now()))
        conn.commit()
    except Exception as e:
        logger.warning(f"Could not log data source: {e}")
        conn.rollback()
    finally:
        _release_connection(conn)


def get_data_sources() -> List[Dict]:
    """Get all tracked data sources."""
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('SELECT * FROM kb_data_sources ORDER BY created_at DESC')
        results = []
        for row in cursor.fetchall():
            item = dict(row)
            if item.get('last_sync'):
                item['last_sync'] = item['last_sync'].isoformat()
            if item.get('created_at'):
                item['created_at'] = item['created_at'].isoformat()
            results.append(item)
        return results
    except Exception as e:
        logger.warning(f"Could not fetch data sources: {e}")
        return []
    finally:
        _release_connection(conn)
