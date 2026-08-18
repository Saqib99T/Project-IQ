"""
Tests for extensions/amazon/notifications.py — the SQS Notifications
consumer scaffolding (docs/AMAZON_INTEGRATION_PLAN.md Phase 4).

*** These tests only exercise the message-parsing/logging/poll-loop
plumbing against a mocked boto3 client — nothing here talks to real AWS or
SP-API. See the module's own docstring: register_destination()/subscribe()
and the consumer itself are UNVALIDATED against live SP-API and must be
confirmed in the sandbox before notifications_enabled is ever set true. ***
"""
import json
from unittest.mock import MagicMock, patch

from extensions.amazon.notifications import _decode_message, _log_event, poll_once, run_consumer_forever


def test_decode_message_valid_json():
    event = _decode_message(json.dumps({"notificationType": "ORDER_STATUS_CHANGE", "payload": {}}))
    assert event["notificationType"] == "ORDER_STATUS_CHANGE"


def test_decode_message_invalid_json_returns_none():
    assert _decode_message("not json") is None


def test_decode_message_none_body_returns_none():
    assert _decode_message(None) is None


def test_log_event_inserts_row_and_commits():
    mock_conn = MagicMock()
    mock_cursor = mock_conn.cursor.return_value

    with patch("common.db._connection._get_connection", return_value=mock_conn), \
         patch("common.db._connection._release_connection") as mock_release:
        _log_event({"notificationType": "ORDER_STATUS_CHANGE", "payload": {"orderId": "1"}})

    args, _ = mock_cursor.execute.call_args
    sql, params = args
    assert "amazon_order_events" in sql
    assert params[0] == "ORDER_STATUS_CHANGE"
    assert json.loads(params[1]) == {"notificationType": "ORDER_STATUS_CHANGE", "payload": {"orderId": "1"}}
    mock_conn.commit.assert_called_once()
    mock_release.assert_called_once_with(mock_conn)


def test_log_event_swallows_db_errors():
    """Consumer plumbing must not crash the poll loop over one bad DB write."""
    mock_conn = MagicMock()
    mock_conn.cursor.side_effect = Exception("db down")

    with patch("common.db._connection._get_connection", return_value=mock_conn), \
         patch("common.db._connection._release_connection") as mock_release:
        _log_event({"notificationType": "X"})  # must not raise

    mock_release.assert_called_once_with(mock_conn)


def _cfg(**overrides):
    cfg = {
        "enabled": False, "aws_region": "us-east-1", "sqs_queue_arn": "arn:aws:sqs:us-east-1:1:q",
        "aws_access_key_id": "", "aws_secret_access_key": "", "poll_interval_seconds": 20,
    }
    cfg.update(overrides)
    return cfg


def test_poll_once_processes_and_deletes_messages():
    sqs_client = MagicMock()
    sqs_client.receive_message.return_value = {
        "Messages": [
            {"Body": json.dumps({"notificationType": "ORDER_STATUS_CHANGE"}), "ReceiptHandle": "rh-1"},
            {"Body": json.dumps({"notificationType": "ORDER_STATUS_CHANGE"}), "ReceiptHandle": "rh-2"},
        ]
    }

    with patch("extensions.amazon.notifications.get_amazon_notifications_config", return_value=_cfg()), \
         patch("extensions.amazon.notifications._log_event") as mock_log:
        processed = poll_once(sqs_client)

    assert processed == 2
    assert mock_log.call_count == 2
    assert sqs_client.delete_message.call_count == 2
    sqs_client.delete_message.assert_any_call(QueueUrl=_cfg()["sqs_queue_arn"], ReceiptHandle="rh-1")
    sqs_client.delete_message.assert_any_call(QueueUrl=_cfg()["sqs_queue_arn"], ReceiptHandle="rh-2")


def test_poll_once_deletes_undecodable_message_without_logging():
    sqs_client = MagicMock()
    sqs_client.receive_message.return_value = {
        "Messages": [{"Body": "not json", "ReceiptHandle": "rh-1"}]
    }

    with patch("extensions.amazon.notifications.get_amazon_notifications_config", return_value=_cfg()), \
         patch("extensions.amazon.notifications._log_event") as mock_log:
        processed = poll_once(sqs_client)

    assert processed == 1
    mock_log.assert_not_called()
    sqs_client.delete_message.assert_called_once_with(QueueUrl=_cfg()["sqs_queue_arn"], ReceiptHandle="rh-1")


def test_poll_once_empty_queue():
    sqs_client = MagicMock()
    sqs_client.receive_message.return_value = {"Messages": []}

    with patch("extensions.amazon.notifications.get_amazon_notifications_config", return_value=_cfg()):
        processed = poll_once(sqs_client)

    assert processed == 0
    sqs_client.delete_message.assert_not_called()


def test_run_consumer_forever_is_noop_when_disabled():
    """notifications_enabled=false (this repo's default) must never touch boto3."""
    with patch("extensions.amazon.notifications.get_amazon_notifications_config",
               return_value=_cfg(enabled=False)):
        run_consumer_forever()  # must return immediately, no boto3.client call, no infinite loop
