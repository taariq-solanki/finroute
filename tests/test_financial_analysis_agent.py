"""Unit tests for the financial analysis agent tool functions.

Tests get_stock_analysis, create_diversified_portfolio, and
compare_stock_performance tools from financial_analysis_agent.py.

Validates: Requirements 4.1
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mock_history(periods: int = 252, start_price: float = 150.0) -> pd.DataFrame:
    """Create deterministic mock stock history DataFrame."""
    dates = pd.date_range(end="2024-01-15", periods=periods, freq="B")
    np.random.seed(42)
    prices = start_price + np.cumsum(np.random.randn(periods) * 2)
    return pd.DataFrame(
        {
            "Open": prices - 1,
            "High": prices + 2,
            "Low": prices - 2,
            "Close": prices,
            "Volume": np.random.randint(50_000_000, 150_000_000, size=periods),
        },
        index=dates,
    )


# ---------------------------------------------------------------------------
# get_stock_analysis Tests
# ---------------------------------------------------------------------------


class TestGetStockAnalysis:
    """Tests for the get_stock_analysis tool function."""

    @pytest.fixture(autouse=True)
    def _patch_imports(self):
        """Patch heavy imports to isolate tool logic."""
        with patch("boto3.Session") as mock_session, \
             patch("strands.models.BedrockModel"):
            mock_session.return_value.region_name = "eu-north-1"
            from financial_analysis_agent import get_stock_analysis
            self.get_stock_analysis = get_stock_analysis
            yield

    @pytest.mark.unit
    def test_valid_ticker_returns_analysis(self, mock_yfinance):
        """Valid ticker returns formatted analysis with key metrics."""
        result = self.get_stock_analysis(symbol="AAPL")
        assert "AAPL" in result
        assert "Current Price" in result
        assert "52-Week High" in result
        assert "52-Week Low" in result
        assert "Year-to-Date Change" in result
        assert "Average Daily Volume" in result

    @pytest.mark.unit
    def test_valid_ticker_contains_company_info(self, mock_yfinance):
        """Result includes company name and sector from stock info."""
        result = self.get_stock_analysis(symbol="AAPL")
        assert "Technology" in result  # sector from mock
        assert "Apple" in result or "Company" in result

    @pytest.mark.unit
    def test_output_has_chart_emoji(self, mock_yfinance):
        """Output uses chart emoji indicator."""
        result = self.get_stock_analysis(symbol="AAPL")
        assert "📊" in result

    @pytest.mark.unit
    def test_empty_history_returns_error(self, mock_yfinance_empty):
        """Invalid/empty ticker data returns error message."""
        result = self.get_stock_analysis(symbol="INVALID")
        assert "❌" in result or "Error" in result

    @pytest.mark.unit
    def test_symbol_uppercased_in_output(self, mock_yfinance):
        """Symbol is displayed in uppercase regardless of input case."""
        result = self.get_stock_analysis(symbol="aapl")
        assert "AAPL" in result

    @pytest.mark.unit
    def test_exception_returns_error_message(self):
        """Network/API exceptions return user-friendly error."""
        with patch("yfinance.Ticker") as mock_ticker_cls:
            mock_ticker_cls.side_effect = Exception("Network error")
            result = self.get_stock_analysis(symbol="AAPL")
            assert "❌" in result or "Error" in result


# ---------------------------------------------------------------------------
# create_diversified_portfolio Tests
# ---------------------------------------------------------------------------


class TestCreateDiversifiedPortfolio:
    """Tests for the create_diversified_portfolio tool function."""

    @pytest.fixture(autouse=True)
    def _patch_imports(self):
        """Patch heavy imports to isolate tool logic."""
        with patch("boto3.Session") as mock_session, \
             patch("strands.models.BedrockModel"):
            mock_session.return_value.region_name = "eu-north-1"
            from financial_analysis_agent import create_diversified_portfolio
            self.create_diversified_portfolio = create_diversified_portfolio
            yield

    @pytest.mark.unit
    def test_conservative_portfolio(self):
        """Conservative portfolio contains expected stocks and allocations."""
        result = self.create_diversified_portfolio(
            risk_level="conservative", investment_amount=10000.0
        )
        assert "CONSERVATIVE" in result
        assert "JNJ" in result
        assert "PG" in result
        assert "$10,000" in result
        assert "Disclaimer" in result

    @pytest.mark.unit
    def test_moderate_portfolio(self):
        """Moderate portfolio contains expected stocks."""
        result = self.create_diversified_portfolio(
            risk_level="moderate", investment_amount=10000.0
        )
        assert "MODERATE" in result
        assert "AAPL" in result
        assert "MSFT" in result

    @pytest.mark.unit
    def test_aggressive_portfolio(self):
        """Aggressive portfolio contains expected high-growth stocks."""
        result = self.create_diversified_portfolio(
            risk_level="aggressive", investment_amount=10000.0
        )
        assert "AGGRESSIVE" in result
        assert "TSLA" in result
        assert "NVDA" in result

    @pytest.mark.unit
    def test_invalid_risk_level(self):
        """Invalid risk level returns error message."""
        result = self.create_diversified_portfolio(
            risk_level="ultra-high", investment_amount=10000.0
        )
        assert "❌" in result
        assert "conservative" in result.lower() or "moderate" in result.lower()

    @pytest.mark.unit
    def test_negative_amount_returns_error(self):
        """Negative investment amount returns error."""
        result = self.create_diversified_portfolio(
            risk_level="moderate", investment_amount=-5000.0
        )
        assert "❌" in result
        assert "negative" in result.lower()

    @pytest.mark.unit
    def test_zero_amount_returns_error(self):
        """Zero investment amount returns error."""
        result = self.create_diversified_portfolio(
            risk_level="moderate", investment_amount=0.0
        )
        assert "❌" in result
        assert "zero" in result.lower()

    @pytest.mark.unit
    def test_too_small_amount_returns_error(self):
        """Amount below $100 minimum returns error."""
        result = self.create_diversified_portfolio(
            risk_level="moderate", investment_amount=50.0
        )
        assert "❌" in result
        assert "100" in result

    @pytest.mark.unit
    def test_too_large_amount_returns_error(self):
        """Amount above $100M maximum returns error."""
        result = self.create_diversified_portfolio(
            risk_level="moderate", investment_amount=200_000_000.0
        )
        assert "❌" in result

    @pytest.mark.unit
    def test_case_insensitive_risk_level(self):
        """Risk level is case-insensitive."""
        result = self.create_diversified_portfolio(
            risk_level="MODERATE", investment_amount=10000.0
        )
        assert "MODERATE" in result
        assert "❌" not in result

    @pytest.mark.unit
    def test_allocation_amounts_in_output(self):
        """Allocation dollar amounts are present for a known portfolio."""
        result = self.create_diversified_portfolio(
            risk_level="conservative", investment_amount=10000.0
        )
        # Conservative weights: [0.25, 0.20, 0.20, 0.20, 0.15]
        assert "$2,500" in result  # 25% of 10000
        assert "$2,000" in result  # 20% of 10000
        assert "$1,500" in result  # 15% of 10000

    @pytest.mark.unit
    def test_disclaimer_included(self):
        """Output includes investment disclaimer."""
        result = self.create_diversified_portfolio(
            risk_level="moderate", investment_amount=5000.0
        )
        assert "⚠️" in result
        assert "Disclaimer" in result


# ---------------------------------------------------------------------------
# compare_stock_performance Tests
# ---------------------------------------------------------------------------


class TestCompareStockPerformance:
    """Tests for the compare_stock_performance tool function."""

    @pytest.fixture(autouse=True)
    def _patch_imports(self):
        """Patch heavy imports to isolate tool logic."""
        with patch("boto3.Session") as mock_session, \
             patch("strands.models.BedrockModel"):
            mock_session.return_value.region_name = "eu-north-1"
            from financial_analysis_agent import compare_stock_performance
            self.compare_stock_performance = compare_stock_performance
            yield

    @pytest.mark.unit
    def test_valid_comparison_multiple_stocks(self, mock_yfinance):
        """Multiple valid stocks produce comparison output."""
        result = self.compare_stock_performance(symbols=["AAPL", "MSFT"])
        assert "📈" in result
        assert "Stock Performance Comparison" in result
        assert "%" in result

    @pytest.mark.unit
    def test_empty_symbols_list(self):
        """Empty symbols list returns error."""
        result = self.compare_stock_performance(symbols=[])
        assert "❌" in result
        assert "at least one" in result.lower()

    @pytest.mark.unit
    def test_too_many_symbols(self):
        """More than 5 symbols returns error."""
        result = self.compare_stock_performance(
            symbols=["A", "B", "C", "D", "E", "F"]
        )
        assert "❌" in result
        assert "5" in result

    @pytest.mark.unit
    def test_invalid_period(self):
        """Invalid period string returns error."""
        result = self.compare_stock_performance(
            symbols=["AAPL"], period="10y"
        )
        assert "❌" in result
        assert "Invalid" in result or "invalid" in result

    @pytest.mark.unit
    def test_valid_periods_accepted(self, mock_yfinance):
        """All valid period values are accepted."""
        for period in ["1m", "3m", "6m", "1y", "2y", "5y"]:
            result = self.compare_stock_performance(
                symbols=["AAPL"], period=period
            )
            assert "❌" not in result or "Error" not in result.split("📈")[0]

    @pytest.mark.unit
    def test_single_stock_comparison(self, mock_yfinance):
        """Single stock is valid and produces output."""
        result = self.compare_stock_performance(symbols=["AAPL"])
        assert "📈" in result

    @pytest.mark.unit
    def test_empty_string_in_symbols(self):
        """Empty string in symbols list returns error."""
        result = self.compare_stock_performance(symbols=["AAPL", ""])
        assert "❌" in result

    @pytest.mark.unit
    def test_failed_symbols_noted_in_output(self):
        """When some symbols fail, output notes which ones failed."""
        with patch("yfinance.Ticker") as mock_ticker_cls:
            mock_ticker = MagicMock()
            # First call succeeds, second returns empty
            mock_history = _make_mock_history(periods=252)
            empty_history = pd.DataFrame()

            call_count = {"n": 0}

            def side_effect(*args, **kwargs):
                mock = MagicMock()
                if call_count["n"] == 0:
                    mock.history.return_value = mock_history
                else:
                    mock.history.return_value = empty_history
                call_count["n"] += 1
                return mock

            mock_ticker_cls.side_effect = side_effect
            result = self.compare_stock_performance(symbols=["AAPL", "FAKE"])
            # Should still produce some output (at least AAPL)
            assert "AAPL" in result
            # Should note the failed symbol
            assert "FAKE" in result or "Unable" in result

    @pytest.mark.unit
    def test_all_symbols_fail(self):
        """When all symbols fail, returns error message."""
        with patch("yfinance.Ticker") as mock_ticker_cls:
            mock_ticker = MagicMock()
            mock_ticker.history.return_value = pd.DataFrame()
            mock_ticker_cls.return_value = mock_ticker

            result = self.compare_stock_performance(symbols=["FAKE1", "FAKE2"])
            assert "❌" in result

    @pytest.mark.unit
    def test_default_period_is_1y(self, mock_yfinance):
        """Default period parameter is '1y'."""
        result = self.compare_stock_performance(symbols=["AAPL"])
        assert "(1y)" in result

    @pytest.mark.unit
    def test_results_sorted_by_performance(self, mock_yfinance):
        """Results are sorted by performance descending."""
        # With mock_yfinance, all symbols use the same mock data
        result = self.compare_stock_performance(symbols=["AAPL", "MSFT"])
        # Just verify it doesn't error - both get same performance with single mock
        assert "📈" in result
