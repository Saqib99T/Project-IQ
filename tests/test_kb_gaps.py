"""
Tests for common/db/_kb_gaps.py's log_kb_gap (KB_WIKI_CURATION_RAG_PLAN
Phase 5 — org_id/product_id columns so itsm-service's gap-clustering job can
scope drafts to the right tenant without a cross-repo join).
"""
from unittest.mock import MagicMock, patch

from common.db._kb_gaps import log_kb_gap


def test_log_kb_gap_writes_org_and_product_id():
    mock_conn = MagicMock()
    mock_cursor = mock_conn.cursor.return_value

    with patch("common.conversation_db._get_connection", return_value=mock_conn), \
         patch("common.conversation_db._release_connection"):
        log_kb_gap(query="how do refunds work", app_id="IT", sender_id="iam-abc",
                   org_id="org-1", product_id="greenloop")

    args, _ = mock_cursor.execute.call_args
    sql, params = args
    assert "org_id" in sql and "product_id" in sql
    assert params == ("how do refunds work", "IT", "iam-abc", "org-1", "greenloop")
    mock_conn.commit.assert_called_once()


def test_log_kb_gap_defaults_org_and_product_to_none():
    mock_conn = MagicMock()
    mock_cursor = mock_conn.cursor.return_value

    with patch("common.conversation_db._get_connection", return_value=mock_conn), \
         patch("common.conversation_db._release_connection"):
        log_kb_gap(query="some question", app_id="IT", sender_id="iam-abc")

    args, _ = mock_cursor.execute.call_args
    _, params = args
    assert params[3] is None and params[4] is None
