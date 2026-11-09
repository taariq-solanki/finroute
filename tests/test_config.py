"""Unit tests for the region configuration module."""

import asyncio
import sys
from unittest.mock import MagicMock, patch

import pytest

from config import (
    REQUIRED_REGION,
    _REGION_PATTERN,
    create_boto3_client,
    get_validated_region,
    validate_startup,
)


class TestRequiredRegion:
    """Tests for the REQUIRED_REGION constant."""

    def test_required_region_is_eu_north_1(self):
        assert REQUIRED_REGION == "eu-north-1"

    def test_required_region_is_string(self):
        assert isinstance(REQUIRED_REGION, str)


class TestRegionPattern:
    """Tests for the region format regex."""

    @pytest.mark.parametrize(
        "region",
        ["eu-north-1", "us-east-1", "ap-southeast-2", "eu-central-1", "us-west-2"],
    )
    def test_valid_regions_match(self, region: str):
        assert _REGION_PATTERN.match(region) is not None

    @pytest.mark.parametrize(
        "region",
        ["invalid", "EU-NORTH-1", "", "us-east-1a", "12-north-1", "us-east-"],
    )
    def test_invalid_regions_do_not_match(self, region: str):
        assert _REGION_PATTERN.match(region) is None


class TestGetValidatedRegion:
    """Tests for get_validated_region()."""

    @patch("config.boto3.client")
    def test_returns_region_on_success(self, mock_client):
        mock_sts = MagicMock()
        mock_sts.get_caller_identity.return_value = {"Account": "123456789012"}
        mock_client.return_value = mock_sts

        result = get_validated_region()
        assert result == "eu-north-1"
        mock_client.assert_called_once_with("sts", region_name="eu-north-1")

    @patch("config.boto3.client")
    def test_exits_on_connection_failure(self, mock_client):
        from botocore.exceptions import EndpointConnectionError

        mock_sts = MagicMock()
        mock_sts.get_caller_identity.side_effect = EndpointConnectionError(
            endpoint_url="https://sts.eu-north-1.amazonaws.com"
        )
        mock_client.return_value = mock_sts

        with pytest.raises(SystemExit) as exc_info:
            get_validated_region()
        assert exc_info.value.code == 1

    @patch("config.boto3.client")
    def test_exits_on_no_credentials(self, mock_client):
        from botocore.exceptions import NoCredentialsError

        mock_sts = MagicMock()
        mock_sts.get_caller_identity.side_effect = NoCredentialsError()
        mock_client.return_value = mock_sts

        with pytest.raises(SystemExit) as exc_info:
            get_validated_region()
        assert exc_info.value.code == 1

    @patch("config.REQUIRED_REGION", "INVALID-REGION!")
    def test_exits_on_invalid_region_format(self):
        with pytest.raises(SystemExit) as exc_info:
            get_validated_region()
        assert exc_info.value.code == 1


class TestCreateBoto3Client:
    """Tests for create_boto3_client()."""

    @patch("config.boto3.client")
    def test_injects_region_name(self, mock_client):
        create_boto3_client("bedrock")
        mock_client.assert_called_once_with("bedrock", region_name="eu-north-1")

    @patch("config.boto3.client")
    def test_passes_additional_kwargs(self, mock_client):
        create_boto3_client("s3", endpoint_url="http://localhost:4566")
        mock_client.assert_called_once_with(
            "s3", region_name="eu-north-1", endpoint_url="http://localhost:4566"
        )

    @patch("config.boto3.client")
    def test_does_not_override_explicit_region(self, mock_client):
        create_boto3_client("sts", region_name="us-east-1")
        mock_client.assert_called_once_with("sts", region_name="us-east-1")


class TestValidateStartup:
    """Tests for validate_startup() async function."""

    @patch("config._check_guardrail_accessible")
    @patch("config.get_validated_region")
    def test_succeeds_when_checks_pass(self, mock_region, mock_guardrail):
        mock_region.return_value = "eu-north-1"
        asyncio.run(validate_startup())
        mock_region.assert_called_once()
        mock_guardrail.assert_called_once()

    @patch("config._check_guardrail_accessible")
    @patch("config.get_validated_region")
    def test_exits_on_region_validation_failure(self, mock_region, mock_guardrail):
        mock_region.side_effect = SystemExit(1)

        with pytest.raises(SystemExit) as exc_info:
            asyncio.run(validate_startup())
        assert exc_info.value.code == 1

    @patch("config._run_startup_checks")
    def test_exits_on_timeout(self, mock_checks):
        async def slow_check():
            await asyncio.sleep(20)

        mock_checks.side_effect = slow_check

        with pytest.raises(SystemExit) as exc_info:
            asyncio.run(validate_startup())
        assert exc_info.value.code == 1
