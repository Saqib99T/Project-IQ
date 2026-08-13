"""Website crawl extension — thin wrapper around the existing, already-working
crawl-and-ingest pipeline (`common.firecrawl_ingester.ingest_crawl_to_kb`).
Same delegation pattern as the KB-source extensions in this package: no
fetch/parse logic is duplicated here.
"""
from extensions.base import ConfigField, Extension, ExtensionKind, ExtensionManifest, RunResult


class WebsiteExtension(Extension):
    manifest = ExtensionManifest(
        id="website",
        name="Website crawl",
        kind=ExtensionKind.SOURCE,
        category="Knowledge base",
        description="Crawl a website and ingest its pages into the knowledge base",
        icon="\U0001F577",
        config_schema=[
            ConfigField(name="url", label="Start URL", type="url"),
            ConfigField(name="limit", label="Max pages to crawl", type="number", required=False, placeholder="50"),
            ConfigField(name="category", label="Knowledge base category", required=False),
        ],
        capabilities=["scheduled_run"],
    )

    def run(self, config: dict, streams=None) -> RunResult:
        from common.firecrawl_ingester import ingest_crawl_to_kb
        limit = int(config.get("limit") or 50)
        result = ingest_crawl_to_kb(config["url"], limit=limit, category=config.get("category"))
        return RunResult(status=result.get("status", "success"), detail=result)


EXTENSION = WebsiteExtension()
