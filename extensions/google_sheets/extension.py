"""Google Sheets source extension — native, no OAuth/service-account flow.
Reads a sheet via Google's public CSV-export endpoint, which works for any
sheet shared as "Anyone with the link can view" — the common case for a
tenant-maintained FAQ/reference sheet. Private-sheet access (service-account
credentials) is not implemented; `run()` fails clearly if the sheet isn't
publicly readable rather than pretending to support it.
"""
import csv
import io
import logging

import requests

from extensions._kb_adapter import make_article_id, save_articles
from extensions.base import ConfigField, Extension, ExtensionKind, ExtensionManifest, RunResult

logger = logging.getLogger(__name__)

_TITLE_FIELDS = ("title", "question", "name", "subject", "topic")
_CONTENT_FIELDS = ("content", "answer", "body", "description", "text")


def _csv_url(spreadsheet_id: str, sheet_name: str = None) -> str:
    url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/gviz/tq?tqx=out:csv"
    if sheet_name:
        url += f"&sheet={requests.utils.quote(sheet_name)}"
    return url


def _row_to_article(row: dict, row_index: int) -> dict:
    keys_lower = {k.lower(): k for k in row.keys() if k}

    title_key = next((keys_lower[f] for f in _TITLE_FIELDS if f in keys_lower and row[keys_lower[f]]), None)
    title = row[title_key] if title_key else None
    content = next((row[keys_lower[f]] for f in _CONTENT_FIELDS if f in keys_lower and row[keys_lower[f]]), None)

    if content is None:
        # No recognizable content column — fall back to every other column
        # concatenated, so an arbitrarily-shaped sheet still produces
        # searchable text instead of being silently skipped.
        parts = [f"{k}: {v}" for k, v in row.items() if v and k != title_key]
        content = "\n".join(parts)

    return {
        "id": make_article_id("google_sheets", str(row_index)),
        "title": (title or f"Row {row_index}").strip(),
        "content": (content or "").strip(),
        "category": "Google Sheets",
        "keywords": [],
    }


class GoogleSheetsExtension(Extension):
    manifest = ExtensionManifest(
        id="google_sheets",
        name="Google Sheets",
        kind=ExtensionKind.SOURCE,
        category="Knowledge base",
        description="Pull rows from a publicly-shared Google Sheet ('Anyone with the link can view') into the knowledge base",
        icon="\U0001F4CA",
        config_schema=[
            ConfigField(name="spreadsheet_id", label="Spreadsheet ID (from the sheet's URL)"),
            ConfigField(name="sheet_name", label="Sheet/tab name (defaults to the first sheet)", required=False),
        ],
        capabilities=["scheduled_run"],
    )

    def test(self, config: dict) -> RunResult:
        try:
            resp = requests.get(_csv_url(config["spreadsheet_id"], config.get("sheet_name")), timeout=10)
        except requests.RequestException as e:
            return RunResult(status="error", detail={"error": str(e)})
        if resp.status_code == 200 and resp.text.strip():
            return RunResult(status="success", detail={})
        return RunResult(status="error", detail={
            "error": "Could not read the sheet — confirm the spreadsheet ID and that it's shared "
                     "as 'Anyone with the link can view' (private-sheet access isn't supported yet).",
        })

    def run(self, config: dict, streams=None) -> RunResult:
        resp = requests.get(_csv_url(config["spreadsheet_id"], config.get("sheet_name")), timeout=30)
        if resp.status_code != 200:
            return RunResult(status="error", detail={
                "error": f"Google Sheets returned HTTP {resp.status_code} — is the sheet shared publicly?",
            })

        reader = csv.DictReader(io.StringIO(resp.content.decode("utf-8-sig")))
        articles = [
            _row_to_article(row, i) for i, row in enumerate(reader, start=1)
            if any((v or "").strip() for v in row.values())
        ]
        articles = [a for a in articles if len(a["content"]) >= 10]

        saved = save_articles("google_sheets", articles, config)
        return RunResult(status="success", detail={"total_rows": len(articles), "saved": saved})


EXTENSION = GoogleSheetsExtension()
