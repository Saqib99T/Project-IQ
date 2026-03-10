"""
Airbyte Connector Module
Integrates PyAirbyte for pulling data from 600+ sources into the KB pipeline.
"""

import os
import sys
import hashlib
import logging
import json
from typing import List, Dict, Optional, Any
from datetime import datetime

# Add project root to path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

logger = logging.getLogger(__name__)


# =====================
# SUPPORTED SOURCES
# =====================

SUPPORTED_SOURCES = {
    "confluence": {
        "name": "Confluence",
        "description": "Atlassian Confluence wiki pages",
        "connector_name": "source-confluence",
        "required_config": ["url", "username", "api_token"],
        "icon": "📄"
    },
    "notion": {
        "name": "Notion",
        "description": "Notion workspace pages and databases",
        "connector_name": "source-notion",
        "required_config": ["token"],
        "icon": "📝"
    },
    "github": {
        "name": "GitHub",
        "description": "GitHub repositories (README, wiki, issues)",
        "connector_name": "source-github",
        "required_config": ["access_token", "repository"],
        "icon": "🐙"
    },
    "google_sheets": {
        "name": "Google Sheets",
        "description": "Google Sheets spreadsheet data",
        "connector_name": "source-google-sheets",
        "required_config": ["spreadsheet_id", "credentials_json"],
        "icon": "📊"
    },
    "zendesk": {
        "name": "Zendesk",
        "description": "Zendesk support articles and tickets",
        "connector_name": "source-zendesk-support",
        "required_config": ["subdomain", "email", "api_token"],
        "icon": "🎫"
    },
    "freshdesk": {
        "name": "Freshdesk",
        "description": "Freshdesk support knowledge base",
        "connector_name": "source-freshdesk",
        "required_config": ["domain", "api_key"],
        "icon": "🎯"
    },
    "jira": {
        "name": "Jira",
        "description": "Jira project issues and comments",
        "connector_name": "source-jira",
        "required_config": ["domain", "email", "api_token"],
        "icon": "🔧"
    },
    "slack": {
        "name": "Slack",
        "description": "Slack channel messages and threads",
        "connector_name": "source-slack",
        "required_config": ["api_token", "channel_ids"],
        "icon": "💬"
    }
}


def list_available_sources() -> List[Dict]:
    """Return list of supported connector types with their config requirements."""
    sources = []
    for key, info in SUPPORTED_SOURCES.items():
        sources.append({
            "id": key,
            "name": info["name"],
            "description": info["description"],
            "required_config": info["required_config"],
            "icon": info["icon"]
        })
    return sources


def _get_pyairbyte():
    """Import and return PyAirbyte module."""
    try:
        import airbyte as ab
        return ab
    except ImportError:
        raise ImportError(
            "PyAirbyte is not installed. Run: pip install airbyte"
        )


def _generate_article_id(source_type: str, record_id: str) -> str:
    """Generate a deterministic article ID for an Airbyte record."""
    raw = f"airbyte:{source_type}:{record_id}"
    return hashlib.md5(raw.encode()).hexdigest()


# =====================
# CONTENT TRANSFORMERS
# =====================

def _transform_confluence(records: List[Dict]) -> List[Dict]:
    """Transform Confluence page records into KB articles."""
    articles = []
    for record in records:
        title = record.get('title', 'Untitled')
        body = record.get('body', {})
        
        # Confluence body can be in different formats
        content = ''
        if isinstance(body, dict):
            content = body.get('storage', {}).get('value', '') or body.get('view', {}).get('value', '')
        elif isinstance(body, str):
            content = body

        if not content or len(content) < 30:
            continue

        page_id = record.get('id', str(hash(title)))
        articles.append({
            "id": _generate_article_id("confluence", str(page_id)),
            "title": title,
            "content": content,
            "category": "Confluence",
            "keywords": [record.get('space', {}).get('name', '')] if record.get('space') else [],
            "source_type": "airbyte_confluence"
        })
    return articles


def _transform_notion(records: List[Dict]) -> List[Dict]:
    """Transform Notion page records into KB articles."""
    articles = []
    for record in records:
        # Notion page properties
        properties = record.get('properties', {})
        title_prop = properties.get('Name', properties.get('title', {}))
        
        title = 'Untitled'
        if isinstance(title_prop, dict):
            title_array = title_prop.get('title', [])
            if title_array and isinstance(title_array, list):
                title = ''.join(t.get('plain_text', '') for t in title_array)
        elif isinstance(title_prop, str):
            title = title_prop

        content = record.get('content', '') or record.get('markdown', '') or str(record)
        
        if not content or len(content) < 30:
            continue

        page_id = record.get('id', str(hash(title)))
        articles.append({
            "id": _generate_article_id("notion", str(page_id)),
            "title": title,
            "content": content,
            "category": "Notion",
            "keywords": [],
            "source_type": "airbyte_notion"
        })
    return articles


def _transform_github(records: List[Dict]) -> List[Dict]:
    """Transform GitHub records into KB articles."""
    articles = []
    for record in records:
        # Handle different GitHub streams (readme, issues, etc.)
        title = record.get('title', '') or record.get('name', '') or record.get('path', 'Untitled')
        content = record.get('body', '') or record.get('content', '') or record.get('description', '')
        
        if not content or len(content) < 30:
            continue

        record_id = record.get('id', '') or record.get('sha', str(hash(title)))
        articles.append({
            "id": _generate_article_id("github", str(record_id)),
            "title": title,
            "content": content,
            "category": "GitHub",
            "keywords": [record.get('full_name', '')] if record.get('full_name') else [],
            "source_type": "airbyte_github"
        })
    return articles


def _transform_zendesk(records: List[Dict]) -> List[Dict]:
    """Transform Zendesk article records into KB articles."""
    articles = []
    for record in records:
        title = record.get('title', '') or record.get('name', 'Untitled')
        content = record.get('body', '') or record.get('description', '')
        
        if not content or len(content) < 30:
            continue

        record_id = record.get('id', str(hash(title)))
        articles.append({
            "id": _generate_article_id("zendesk", str(record_id)),
            "title": title,
            "content": content,
            "category": "Zendesk",
            "keywords": record.get('label_names', []) if record.get('label_names') else [],
            "source_type": "airbyte_zendesk"
        })
    return articles


def _transform_generic(records: List[Dict], source_type: str) -> List[Dict]:
    """
    Generic transformer for any Airbyte source.
    Tries common field names to extract title and content.
    """
    articles = []
    title_fields = ['title', 'name', 'subject', 'summary', 'heading', 'label']
    content_fields = ['body', 'content', 'description', 'text', 'message', 'html', 'markdown']

    for i, record in enumerate(records):
        # Find title
        title = 'Untitled'
        for field in title_fields:
            if record.get(field) and isinstance(record[field], str):
                title = record[field]
                break

        # Find content
        content = ''
        for field in content_fields:
            if record.get(field) and isinstance(record[field], str):
                content = record[field]
                break

        # If no content field found, serialize the whole record
        if not content:
            content = json.dumps(record, indent=2, default=str)

        if len(content) < 30:
            continue

        record_id = record.get('id', str(i))
        articles.append({
            "id": _generate_article_id(source_type, str(record_id)),
            "title": title,
            "content": content,
            "category": source_type.replace('_', ' ').title(),
            "keywords": [],
            "source_type": f"airbyte_{source_type}"
        })
    return articles


# Transformer registry
_transformers = {
    "confluence": _transform_confluence,
    "notion": _transform_notion,
    "github": _transform_github,
    "zendesk": _transform_zendesk,
}


# =====================
# SYNC FUNCTIONS
# =====================

def sync_source(source_type: str, config: Dict, streams: List[str] = None) -> Dict:
    """
    Sync data from an Airbyte source and ingest into KB.
    
    Args:
        source_type: Key from SUPPORTED_SOURCES (e.g., 'confluence')
        config: Source-specific configuration dict
        streams: Optional list of specific streams to sync
        
    Returns:
        Result dict with sync status and article count
    """
    from common.conversation_db import add_kb_article

    if source_type not in SUPPORTED_SOURCES:
        raise ValueError(
            f"Unsupported source: {source_type}. "
            f"Available: {list(SUPPORTED_SOURCES.keys())}"
        )

    source_info = SUPPORTED_SOURCES[source_type]
    connector_name = source_info["connector_name"]

    # Validate required config
    missing = [k for k in source_info["required_config"] if k not in config]
    if missing:
        raise ValueError(f"Missing required config keys: {missing}")

    logger.info(f"Starting sync from {source_info['name']}...")

    ab = _get_pyairbyte()

    try:
        # Create source connector
        source = ab.get_source(connector_name, config=config)

        # Select streams
        if streams:
            source.select_streams(streams)
        else:
            source.select_all_streams()

        # Read data
        result = source.read()

        # Collect all records from all streams
        all_records = []
        for stream_name, stream_data in result.streams.items():
            records = list(stream_data)
            logger.info(f"  Stream '{stream_name}': {len(records)} records")
            all_records.extend(records)

    except Exception as e:
        logger.error(f"Airbyte sync failed for {source_type}: {e}")
        raise RuntimeError(f"Failed to sync from {source_info['name']}: {e}")

    # Transform records to articles
    transformer = _transformers.get(source_type, lambda r: _transform_generic(r, source_type))
    articles = transformer(all_records)

    # Save to KB
    saved = 0
    for article in articles:
        success = add_kb_article(
            article_id=article['id'],
            title=article['title'],
            content=article['content'],
            category=article['category'],
            keywords=article.get('keywords', [])
        )
        if success:
            saved += 1

    # Rebuild embeddings
    if saved > 0:
        _rebuild_embeddings()

    # Log data source
    _log_sync(source_type, config, saved)

    return {
        "status": "success",
        "source": source_info['name'],
        "total_records": len(all_records),
        "articles_created": len(articles),
        "saved": saved,
        "streams_synced": list(result.streams.keys()) if hasattr(result, 'streams') else []
    }


def _rebuild_embeddings():
    """Rebuild the vector search embeddings cache."""
    try:
        from common.vector_search import load_and_process_articles
        load_and_process_articles()
        logger.info("Embeddings cache rebuilt successfully")
    except Exception as e:
        logger.warning(f"Could not rebuild embeddings (non-critical): {e}")


def _log_sync(source_type: str, config: dict, articles_count: int):
    """Log sync to data sources table."""
    try:
        from common.firecrawl_ingester import log_data_source
        # Mask sensitive config values before logging
        safe_config = {}
        for k, v in config.items():
            if any(secret in k.lower() for secret in ['token', 'password', 'key', 'secret', 'credentials']):
                safe_config[k] = '***'
            else:
                safe_config[k] = v
        log_data_source(f"airbyte_{source_type}", safe_config, articles_count)
    except Exception as e:
        logger.warning(f"Could not log sync: {e}")


def get_source_config_schema(source_type: str) -> Dict:
    """Get the configuration schema for a specific source type."""
    if source_type not in SUPPORTED_SOURCES:
        return None
    
    source = SUPPORTED_SOURCES[source_type]
    return {
        "source_type": source_type,
        "name": source["name"],
        "description": source["description"],
        "required_fields": source["required_config"],
        "field_descriptions": _get_field_descriptions(source_type)
    }


def _get_field_descriptions(source_type: str) -> Dict:
    """Human-readable descriptions for config fields."""
    descriptions = {
        "confluence": {
            "url": "Confluence base URL (e.g., https://yoursite.atlassian.net/wiki)",
            "username": "Atlassian account email",
            "api_token": "Atlassian API token (from id.atlassian.com)"
        },
        "notion": {
            "token": "Notion integration token (from notion.so/my-integrations)"
        },
        "github": {
            "access_token": "GitHub personal access token",
            "repository": "Repository in owner/repo format"
        },
        "google_sheets": {
            "spreadsheet_id": "Google Sheets spreadsheet ID (from the URL)",
            "credentials_json": "Google service account credentials JSON"
        },
        "zendesk": {
            "subdomain": "Zendesk subdomain (e.g., 'mycompany')",
            "email": "Admin email address",
            "api_token": "Zendesk API token"
        },
        "freshdesk": {
            "domain": "Freshdesk domain (e.g., 'mycompany.freshdesk.com')",
            "api_key": "Freshdesk API key"
        },
        "jira": {
            "domain": "Jira domain (e.g., 'mycompany.atlassian.net')",
            "email": "Atlassian account email",
            "api_token": "Atlassian API token"
        },
        "slack": {
            "api_token": "Slack Bot User OAuth Token (xoxb-...)",
            "channel_ids": "Comma-separated channel IDs to sync"
        }
    }
    return descriptions.get(source_type, {})
