"""
One-time export: GLPI Knowledge Base -> JSON file.

Fetches every KnowbaseItem from GLPI, converts HTML answers to Markdown
(reusing KBCacheManager._html_to_markdown), and writes a flat JSON array
to data/glpi_kb_export.json. That file is the input to itsm-service's
scripts/import_glpi_kb.py, which loads the articles into kb_articles.

Run from the project root:
    python scripts/export_glpi_kb.py
"""
import asyncio
import json
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("export_glpi_kb")

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "glpi_kb_export.json"


def _html_to_markdown(html_content: str) -> str:
    from web.api.kb_cache_manager import KBCacheManager
    return KBCacheManager._html_to_markdown(KBCacheManager.__new__(KBCacheManager), html_content)


async def main():
    from common.config_manager import get_glpi_config
    from action_server.actions.glpi_service import GlpiService

    glpi_config = get_glpi_config()
    glpi_service = GlpiService(
        api_uri=glpi_config["api_url"],
        app_token=glpi_config["app_token"],
        user_token=glpi_config["user_token"],
    )

    session_token = await glpi_service.init_session()
    if not session_token:
        logger.error("Failed to initialize GLPI session")
        return

    try:
        logger.info("Fetching all GLPI KnowbaseItems...")
        raw_items = await glpi_service.get_all_knowbase_items(session_token)
        logger.info("Fetched %d raw items from GLPI", len(raw_items))

        articles = []
        for item in raw_items:
            try:
                articles.append({
                    "glpi_id": item["id"],
                    "title": (item.get("name") or "Untitled").strip(),
                    "question": (item.get("question") or "").strip(),
                    "body_markdown": _html_to_markdown(item.get("answer") or ""),
                    "is_faq": item.get("is_faq", 0) == 1,
                    "date_mod": item.get("date_mod") or "",
                })
            except Exception as exc:
                logger.error("Skipping GLPI item %s: %r", item.get("id"), exc)

        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
            json.dump({"source": "glpi", "articles": articles}, f, ensure_ascii=False, indent=2)

        logger.info("Wrote %d articles to %s", len(articles), OUTPUT_PATH)

    finally:
        await glpi_service.kill_session(session_token)


if __name__ == "__main__":
    asyncio.run(main())
