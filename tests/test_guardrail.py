"""Unit tests for utils/guardrail.py (Bedrock client mocked; no AWS calls)."""

from unittest.mock import MagicMock, patch

import pytest

import utils.guardrail as g

NAME = "guardrail-no-bitcoin-advice"


def _client(existing=None, list_error=None):
    client = MagicMock()
    if list_error:
        client.list_guardrails.side_effect = list_error
    else:
        client.list_guardrails.return_value = {"guardrails": existing or []}
    return client


def _patched(client):
    return patch.object(g, "_get_bedrock_client", return_value=client)


class TestCreateGuardrail:
    def test_returns_existing_without_creating(self):
        client = _client([{"name": NAME, "id": "gid", "arn": "garn"}])
        with _patched(client):
            assert g.create_guardrail() == ("gid", "garn")
        client.create_guardrail.assert_not_called()

    def test_creates_when_missing(self):
        client = _client([])
        client.create_guardrail.return_value = {"guardrailId": "new", "guardrailArn": "narn"}
        with _patched(client):
            assert g.create_guardrail() == ("new", "narn")
        kwargs = client.create_guardrail.call_args.kwargs
        filters = {f["type"] for f in kwargs["contentPolicyConfig"]["filtersConfig"]}
        assert "PROMPT_ATTACK" in filters
        assert kwargs["name"] == NAME

    def test_creates_when_listing_fails(self):
        client = _client(list_error=RuntimeError("boom"))
        client.create_guardrail.return_value = {"guardrailId": "new", "guardrailArn": "narn"}
        with _patched(client):
            assert g.create_guardrail() == ("new", "narn")


class TestDeleteGuardrail:
    def test_deletes_by_id(self):
        client = _client()
        with _patched(client):
            assert g.delete_guardrail("gid") is True
        client.delete_guardrail.assert_called_once_with(guardrailIdentifier="gid")

    def test_finds_by_name_then_deletes(self):
        client = _client([{"name": NAME, "id": "found"}])
        with _patched(client):
            assert g.delete_guardrail() is True
        client.delete_guardrail.assert_called_once_with(guardrailIdentifier="found")

    def test_returns_false_when_not_found(self):
        client = _client([])
        with _patched(client):
            assert g.delete_guardrail() is False
        client.delete_guardrail.assert_not_called()

    def test_returns_false_on_error(self):
        client = _client()
        client.delete_guardrail.side_effect = RuntimeError("denied")
        with _patched(client):
            assert g.delete_guardrail("gid") is False


class TestGetGuardrailId:
    def test_finds_known_name(self):
        client = _client([{"name": "finance-advisor-guardrail-staging", "id": "abc"}])
        with _patched(client):
            assert g.get_guardrail_id() == "abc"

    def test_returns_none_when_no_match(self):
        client = _client([{"name": "someone-elses", "id": "x"}])
        with _patched(client):
            assert g.get_guardrail_id() is None

    def test_returns_none_on_error(self):
        client = _client(list_error=RuntimeError("no access"))
        with _patched(client):
            assert g.get_guardrail_id() is None


class TestLazyClients:
    def test_bedrock_client_created_once(self, monkeypatch):
        monkeypatch.setattr(g, "_bedrock_client", None)
        with patch.object(g, "create_boto3_client", return_value=MagicMock()) as make:
            first = g._get_bedrock_client()
            second = g._get_bedrock_client()
        assert first is second
        make.assert_called_once_with("bedrock")

    def test_runtime_client_created_once(self, monkeypatch):
        monkeypatch.setattr(g, "_bedrock_runtime", None)
        with patch.object(g, "create_boto3_client", return_value=MagicMock()) as make:
            first = g._get_bedrock_runtime()
            second = g._get_bedrock_runtime()
        assert first is second
        make.assert_called_once_with("bedrock-runtime")
