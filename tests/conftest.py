"""Shared test fixtures for the FinRoute test suite.

Provides mocked versions of external dependencies:
- Bedrock model (Strands BedrockModel)
- Memory client (bedrock_agentcore.memory.MemoryClient)
- yfinance (yf.Ticker)
- AWS environment (credentials, region)

Validates: Requirements 4.1, 4.6
"""

from __future__ import annotations

import os
from typing import Any, Generator
from unittest.mock import MagicMock, patch

import pytest
from hypothesis import settings, HealthCheck

# ---------------------------------------------------------------------------
# Hypothesis Profiles
# ---------------------------------------------------------------------------

# CI profile: thorough testing with 100 examples per property
settings.register_profile(
    "ci",
    max_examples=100,
    suppress_health_check=[HealthCheck.too_slow],
)

# Development profile: faster iteration with fewer examples
settings.register_profile(
    "dev",
    max_examples=10,
    suppress_health_check=[HealthCheck.too_slow],
)

# Default profile uses CI settings
settings.load_profile(os.getenv("HYPOTHESIS_PROFILE", "ci"))


# ---------------------------------------------------------------------------
# AWS Environment Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def aws_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set AWS environment variables for all tests to prevent real AWS calls."""
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-north-1")
    monkeypatch.setenv("AWS_REGION", "eu-north-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SECURITY_TOKEN", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")


# ---------------------------------------------------------------------------
# Bedrock Model Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_bedrock_model() -> Generator[MagicMock, None, None]:
    """Mock the Strands BedrockModel to return canned responses.

    Usage:
        def test_something(mock_bedrock_model):
            mock_bedrock_model.converse.return_value = {"output": "test response"}
    """
    with patch("strands.models.BedrockModel") as mock_cls:
        mock_instance = MagicMock()
        mock_instance.model_id = "eu.amazon.nova-pro-v1:0"
        mock_instance.region_name = "eu-north-1"
        mock_instance.temperature = 0.0

        # Default canned response structure
        mock_instance.converse.return_value = {
            "output": {
                "message": {
                    "role": "assistant",
                    "content": [{"text": "This is a mocked response."}],
                }
            },
            "stopReason": "end_turn",
            "usage": {"inputTokens": 100, "outputTokens": 50},
        }
        mock_instance.converse_stream.return_value = iter(
            [
                {"contentBlockDelta": {"delta": {"text": "Mocked "}}},
                {"contentBlockDelta": {"delta": {"text": "streaming "}}},
                {"contentBlockDelta": {"delta": {"text": "response."}}},
            ]
        )

        mock_cls.return_value = mock_instance
        yield mock_instance


# ---------------------------------------------------------------------------
# Memory Client Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_memory_client() -> Generator[MagicMock, None, None]:
    """Mock bedrock_agentcore.memory.MemoryClient with configurable latency/errors.

    Usage:
        def test_memory_timeout(mock_memory_client):
            mock_memory_client.search_memory.side_effect = TimeoutError("5s exceeded")

        def test_memory_success(mock_memory_client):
            mock_memory_client.search_memory.return_value = [
                {"content": "Previous conversation context"}
            ]
    """
    with patch("bedrock_agentcore.memory.MemoryClient") as mock_cls:
        mock_instance = MagicMock()

        # Default: successful memory retrieval with empty results
        mock_instance.search_memory.return_value = []
        mock_instance.create_memory.return_value = {"memoryId": "test-memory-id"}
        mock_instance.delete_memory.return_value = None

        mock_cls.return_value = mock_instance
        yield mock_instance


@pytest.fixture
def mock_memory_client_with_context(mock_memory_client: MagicMock) -> MagicMock:
    """Memory client pre-configured with sample conversation context."""
    mock_memory_client.search_memory.return_value = [
        {
            "content": "User previously asked about budget allocation for $5000 income.",
            "score": 0.92,
        },
        {
            "content": "User prefers conservative investment strategies.",
            "score": 0.87,
        },
    ]
    return mock_memory_client


@pytest.fixture
def mock_memory_client_timeout(mock_memory_client: MagicMock) -> MagicMock:
    """Memory client that simulates a timeout (>5s)."""
    mock_memory_client.search_memory.side_effect = TimeoutError(
        "MemoryClient timeout: exceeded 5 second threshold"
    )
    return mock_memory_client


@pytest.fixture
def mock_memory_client_error(mock_memory_client: MagicMock) -> MagicMock:
    """Memory client that raises a generic exception."""
    mock_memory_client.search_memory.side_effect = RuntimeError(
        "MemoryClient unavailable: service error"
    )
    return mock_memory_client


# ---------------------------------------------------------------------------
# yfinance Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_yfinance() -> Generator[MagicMock, None, None]:
    """Mock yf.Ticker with deterministic stock data.

    Usage:
        def test_stock_analysis(mock_yfinance):
            result = get_stock_analysis("AAPL")
            assert "Apple" in result
    """
    with patch("yfinance.Ticker") as mock_ticker_cls:
        mock_ticker = MagicMock()

        # Deterministic stock info
        mock_ticker.info = {
            "shortName": "Apple Inc.",
            "symbol": "AAPL",
            "currentPrice": 178.72,
            "marketCap": 2_800_000_000_000,
            "trailingPE": 28.5,
            "forwardPE": 26.1,
            "dividendYield": 0.0055,
            "fiftyTwoWeekHigh": 199.62,
            "fiftyTwoWeekLow": 124.17,
            "sector": "Technology",
            "industry": "Consumer Electronics",
            "recommendationKey": "buy",
            "targetMeanPrice": 195.0,
        }

        # Deterministic historical data (pandas DataFrame mock)
        import pandas as pd
        import numpy as np

        dates = pd.date_range(end="2024-01-15", periods=252, freq="B")
        np.random.seed(42)
        prices = 150 + np.cumsum(np.random.randn(252) * 2)

        mock_history = pd.DataFrame(
            {
                "Open": prices - 1,
                "High": prices + 2,
                "Low": prices - 2,
                "Close": prices,
                "Volume": np.random.randint(50_000_000, 150_000_000, size=252),
            },
            index=dates,
        )
        mock_ticker.history.return_value = mock_history

        mock_ticker_cls.return_value = mock_ticker
        yield mock_ticker


@pytest.fixture
def mock_yfinance_empty() -> Generator[MagicMock, None, None]:
    """Mock yf.Ticker that returns empty data (invalid symbol scenario)."""
    with patch("yfinance.Ticker") as mock_ticker_cls:
        import pandas as pd

        mock_ticker = MagicMock()
        mock_ticker.info = {}
        mock_ticker.history.return_value = pd.DataFrame()

        mock_ticker_cls.return_value = mock_ticker
        yield mock_ticker


# ---------------------------------------------------------------------------
# Moto AWS Service Mocks
# ---------------------------------------------------------------------------


@pytest.fixture
def moto_aws_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set up fake AWS credentials for moto mocks."""
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SECURITY_TOKEN", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-north-1")


@pytest.fixture
def mock_sts(moto_aws_credentials: None) -> Generator[Any, None, None]:
    """Provide a mocked STS client via moto."""
    try:
        from moto import mock_aws

        with mock_aws():
            import boto3

            client = boto3.client("sts", region_name="eu-north-1")
            yield client
    except ImportError:
        # Fallback if moto is not installed
        with patch("boto3.client") as mock_client:
            mock_instance = MagicMock()
            mock_instance.get_caller_identity.return_value = {
                "UserId": "AIDAEXAMPLE",
                "Account": "123456789012",
                "Arn": "arn:aws:iam::123456789012:user/test",
            }
            mock_client.return_value = mock_instance
            yield mock_instance


@pytest.fixture
def mock_cloudwatch(moto_aws_credentials: None) -> Generator[Any, None, None]:
    """Provide a mocked CloudWatch Logs client via moto."""
    try:
        from moto import mock_aws

        with mock_aws():
            import boto3

            client = boto3.client("logs", region_name="eu-north-1")
            yield client
    except ImportError:
        with patch("boto3.client") as mock_client:
            mock_instance = MagicMock()
            mock_client.return_value = mock_instance
            yield mock_instance


# ---------------------------------------------------------------------------
# Pytest Configuration Hooks
# ---------------------------------------------------------------------------


def pytest_configure(config: pytest.Config) -> None:
    """Register custom markers."""
    config.addinivalue_line("markers", "unit: mark test as a unit test")
    config.addinivalue_line("markers", "integration: mark test as an integration test")
    config.addinivalue_line("markers", "property: mark test as a property-based test")
    config.addinivalue_line("markers", "slow: mark test as slow-running")
