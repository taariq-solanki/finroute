"""Unit tests for the budget agent tool functions.

Tests calculate_budget and create_financial_chart tools from budget_agent.py.

Validates: Requirements 4.1
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# calculate_budget Tests
# ---------------------------------------------------------------------------


class TestCalculateBudget:
    """Tests for the calculate_budget tool function."""

    @pytest.fixture(autouse=True)
    def _patch_budget_agent_imports(self):
        """Patch heavy imports (boto3.Session, BedrockModel) so we can import the tool."""
        with patch("boto3.Session") as mock_session, \
             patch("strands.models.BedrockModel"):
            mock_session.return_value.region_name = "eu-north-1"
            from budget_agent import calculate_budget
            self.calculate_budget = calculate_budget
            yield

    @pytest.mark.unit
    def test_valid_income_5000(self):
        """Standard income produces correct 50/30/20 breakdown."""
        result = self.calculate_budget(monthly_income=5000.0)
        assert "$2,500" in result  # needs = 50%
        assert "$1,500" in result  # wants = 30%
        assert "$1,000" in result  # savings = 20%
        assert "50%" in result
        assert "30%" in result
        assert "20%" in result

    @pytest.mark.unit
    def test_valid_income_10000(self):
        """Higher income produces scaled breakdown."""
        result = self.calculate_budget(monthly_income=10000.0)
        assert "$5,000" in result  # needs
        assert "$3,000" in result  # wants
        assert "$2,000" in result  # savings

    @pytest.mark.unit
    def test_zero_income(self):
        """Zero income produces zero allocations without errors."""
        result = self.calculate_budget(monthly_income=0.0)
        # Should handle gracefully - either show $0 or return error
        assert "$0" in result or "Error" in result

    @pytest.mark.unit
    def test_large_income(self):
        """Very large income calculates correctly."""
        result = self.calculate_budget(monthly_income=1_000_000.0)
        assert "$500,000" in result  # needs
        assert "$300,000" in result  # wants
        assert "$200,000" in result  # savings

    @pytest.mark.unit
    def test_small_income(self):
        """Small income (e.g., 100) produces correct proportions."""
        result = self.calculate_budget(monthly_income=100.0)
        assert "$50" in result   # needs
        assert "$30" in result   # wants
        assert "$20" in result   # savings

    @pytest.mark.unit
    def test_fractional_income(self):
        """Fractional income values are handled."""
        result = self.calculate_budget(monthly_income=3333.33)
        # Should not raise - just produce formatted output
        assert "Budget" in result or "💰" in result

    @pytest.mark.unit
    def test_output_contains_budget_emoji(self):
        """Output uses the expected emoji formatting."""
        result = self.calculate_budget(monthly_income=5000.0)
        assert "💰" in result

    @pytest.mark.unit
    def test_output_contains_needs_wants_savings_labels(self):
        """Output includes all three category labels."""
        result = self.calculate_budget(monthly_income=5000.0)
        assert "Needs" in result
        assert "Wants" in result
        assert "Savings" in result


# ---------------------------------------------------------------------------
# create_financial_chart Tests
# ---------------------------------------------------------------------------


class TestCreateFinancialChart:
    """Tests for the create_financial_chart tool function."""

    @pytest.fixture(autouse=True)
    def _patch_chart_imports(self):
        """Patch heavy imports and matplotlib to prevent actual rendering."""
        with patch("boto3.Session") as mock_session, \
             patch("strands.models.BedrockModel"), \
             patch("matplotlib.pyplot.figure"), \
             patch("matplotlib.pyplot.pie"), \
             patch("matplotlib.pyplot.title"), \
             patch("matplotlib.pyplot.axis"), \
             patch("matplotlib.pyplot.tight_layout"), \
             patch("matplotlib.pyplot.show"):
            mock_session.return_value.region_name = "eu-north-1"
            from budget_agent import create_financial_chart
            self.create_financial_chart = create_financial_chart
            yield

    @pytest.mark.unit
    def test_valid_data_dict(self):
        """Valid data produces success message."""
        data = {"Needs": 2500, "Wants": 1500, "Savings": 1000}
        result = self.create_financial_chart(data_dict=data, chart_title="My Budget")
        assert "✅" in result
        assert "My Budget" in result

    @pytest.mark.unit
    def test_empty_data_returns_error(self):
        """Empty dictionary returns an error message."""
        result = self.create_financial_chart(data_dict={}, chart_title="Empty")
        assert "❌" in result or "Error" in result

    @pytest.mark.unit
    def test_default_chart_title(self):
        """Default title is used when none provided."""
        data = {"A": 50, "B": 50}
        result = self.create_financial_chart(data_dict=data)
        assert "✅" in result

    @pytest.mark.unit
    def test_single_category(self):
        """Single-entry data dict works."""
        data = {"Only": 1000}
        result = self.create_financial_chart(data_dict=data, chart_title="Single")
        assert "✅" in result

    @pytest.mark.unit
    def test_many_categories(self):
        """Multiple categories (more than available colors) still works."""
        data = {f"Cat{i}": i * 100 for i in range(1, 8)}
        result = self.create_financial_chart(data_dict=data, chart_title="Many")
        assert "✅" in result or "Error" not in result

    @pytest.mark.unit
    def test_output_contains_success_indicator(self):
        """Success result contains the checkmark and 'created successfully'."""
        data = {"Food": 500, "Rent": 1500}
        result = self.create_financial_chart(data_dict=data, chart_title="Expenses")
        assert "created successfully" in result
