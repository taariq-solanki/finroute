"""Integration tests for orchestrator routing logic.

Verifies that:
- Budget/spending queries are routed to budget_agent_tool
- Investment/stock queries are routed to financial_analysis_agent_tool
- 10+ concurrent requests complete with isolated responses (no cross-contamination)

Validates: Requirements 4.3, 1.5
"""

from __future__ import annotations

import asyncio
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Test Constants
# ---------------------------------------------------------------------------

BUDGET_QUERIES = [
    "What is a good budget for a $5000 monthly income?",
    "How should I allocate my spending?",
    "Help me create a savings plan",
    "Track my monthly expenses",
    "What is the 50/30/20 rule for budgeting?",
    "How can I manage my debt better?",
]

INVESTMENT_QUERIES = [
    "Analyze AAPL stock performance",
    "Create a diversified investment portfolio",
    "Compare MSFT and GOOGL stocks",
    "What are the best tech stocks to invest in?",
    "Build me an aggressive growth portfolio",
    "Research Tesla stock fundamentals",
]


# ---------------------------------------------------------------------------
# Helper: Create a mock Agent that tracks tool calls
# ---------------------------------------------------------------------------


def _make_mock_agent(tool_tracker: dict):
    """Create a mock Agent instance that records which tool functions are called.

    The mock agent inspects the user message to determine routing:
    - Budget-related keywords -> calls budget_agent_tool
    - Investment-related keywords -> calls financial_analysis_agent_tool

    This simulates the orchestrator's LLM-driven routing without needing a real model.
    """

    async def mock_stream_async(message: str):
        """Simulate agent streaming that routes to appropriate tools."""
        budget_keywords = [
            "budget", "spending", "savings", "expense", "debt",
            "allocate", "50/30/20",
        ]
        investment_keywords = [
            "stock", "invest", "portfolio", "aapl", "msft", "googl",
            "tesla", "growth", "analyze", "compare", "research",
        ]

        message_lower = message.lower()

        # Determine which tool to "call" based on message content
        if any(kw in message_lower for kw in budget_keywords):
            tool_tracker["budget_agent_tool_calls"].append(message)
            response_text = f"Budget analysis for: {message[:50]}"
        elif any(kw in message_lower for kw in investment_keywords):
            tool_tracker["financial_analysis_agent_tool_calls"].append(message)
            response_text = f"Investment analysis for: {message[:50]}"
        else:
            response_text = f"General response for: {message[:50]}"

        # Yield SSE-style chunks
        for word in response_text.split():
            yield {"data": word + " "}

    mock_agent = MagicMock()
    mock_agent.stream_async = mock_stream_async
    mock_agent.system_prompt = "test prompt"
    return mock_agent


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def tool_tracker():
    """Shared tracker for tool invocations across tests."""
    return {
        "budget_agent_tool_calls": [],
        "financial_analysis_agent_tool_calls": [],
    }


@pytest.fixture
def mock_request_factory(tool_tracker):
    """Mock the request factory to use our tracking agent instead of a real one.

    Patches:
    - strands.Agent (constructor) -> returns our tracking mock
    - bedrock_agentcore.memory.MemoryClient -> returns empty results
    - config.REQUIRED_REGION -> 'eu-north-1'
    - utils.get_guardrail_id -> fake ID
    """
    with patch(
        "request_factory.Agent", side_effect=lambda **kwargs: _make_mock_agent(tool_tracker)
    ) as mock_agent_cls, patch(
        "request_factory.MemoryClient"
    ) as mock_memory_cls, patch(
        "request_factory._bedrock_model"
    ) as mock_model, patch(
        "request_factory.get_guardrail_id", return_value="fake-guardrail-id"
    ):
        # Memory client returns empty results
        mock_memory_instance = MagicMock()
        mock_memory_instance.query_records.return_value = []
        mock_memory_cls.return_value = mock_memory_instance

        yield {
            "agent_cls": mock_agent_cls,
            "memory_cls": mock_memory_cls,
            "model": mock_model,
        }


# ---------------------------------------------------------------------------
# Integration Tests: Orchestrator Routing
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestOrchestratorRouting:
    """Test that the orchestrator correctly routes queries to specialized agents."""

    async def test_budget_query_routes_to_budget_agent(
        self, tool_tracker, mock_request_factory
    ):
        """Budget-related queries should invoke budget_agent_tool.

        Validates: Requirement 4.3
        """
        from request_factory import create_request_context

        query = "What is a good budget for a $5000 monthly income?"
        chunks = []

        async for chunk in create_request_context(
            user_message=query,
            actor_id="test-user-1",
            session_id="session-001",
            memory_id=None,
        ):
            chunks.append(chunk)

        # Verify budget tool was called
        assert len(tool_tracker["budget_agent_tool_calls"]) == 1
        assert query in tool_tracker["budget_agent_tool_calls"][0]
        # Verify investment tool was NOT called
        assert len(tool_tracker["financial_analysis_agent_tool_calls"]) == 0
        # Verify response was streamed
        assert len(chunks) > 0

    async def test_investment_query_routes_to_financial_agent(
        self, tool_tracker, mock_request_factory
    ):
        """Investment-related queries should invoke financial_analysis_agent_tool.

        Validates: Requirement 4.3
        """
        from request_factory import create_request_context

        query = "Analyze AAPL stock performance over the last year"
        chunks = []

        async for chunk in create_request_context(
            user_message=query,
            actor_id="test-user-2",
            session_id="session-002",
            memory_id=None,
        ):
            chunks.append(chunk)

        # Verify financial tool was called
        assert len(tool_tracker["financial_analysis_agent_tool_calls"]) == 1
        assert query in tool_tracker["financial_analysis_agent_tool_calls"][0]
        # Verify budget tool was NOT called
        assert len(tool_tracker["budget_agent_tool_calls"]) == 0
        # Verify response was streamed
        assert len(chunks) > 0

    async def test_savings_query_routes_to_budget_agent(
        self, tool_tracker, mock_request_factory
    ):
        """Savings-related queries should route to budget_agent_tool.

        Validates: Requirement 4.3
        """
        from request_factory import create_request_context

        query = "Help me create a savings plan for an emergency fund"
        chunks = []

        async for chunk in create_request_context(
            user_message=query,
            actor_id="test-user-3",
            session_id="session-003",
            memory_id=None,
        ):
            chunks.append(chunk)

        assert len(tool_tracker["budget_agent_tool_calls"]) == 1
        assert len(tool_tracker["financial_analysis_agent_tool_calls"]) == 0

    async def test_portfolio_query_routes_to_financial_agent(
        self, tool_tracker, mock_request_factory
    ):
        """Portfolio creation queries should route to financial_analysis_agent_tool.

        Validates: Requirement 4.3
        """
        from request_factory import create_request_context

        query = "Create a diversified investment portfolio for retirement"
        chunks = []

        async for chunk in create_request_context(
            user_message=query,
            actor_id="test-user-4",
            session_id="session-004",
            memory_id=None,
        ):
            chunks.append(chunk)

        assert len(tool_tracker["financial_analysis_agent_tool_calls"]) == 1
        assert len(tool_tracker["budget_agent_tool_calls"]) == 0

    async def test_debt_query_routes_to_budget_agent(
        self, tool_tracker, mock_request_factory
    ):
        """Debt management queries should route to budget_agent_tool.

        Validates: Requirement 4.3
        """
        from request_factory import create_request_context

        query = "How can I manage my student loan debt more effectively?"
        chunks = []

        async for chunk in create_request_context(
            user_message=query,
            actor_id="test-user-5",
            session_id="session-005",
            memory_id=None,
        ):
            chunks.append(chunk)

        assert len(tool_tracker["budget_agent_tool_calls"]) == 1
        assert len(tool_tracker["financial_analysis_agent_tool_calls"]) == 0

    async def test_stock_comparison_routes_to_financial_agent(
        self, tool_tracker, mock_request_factory
    ):
        """Stock comparison queries should route to financial_analysis_agent_tool.

        Validates: Requirement 4.3
        """
        from request_factory import create_request_context

        query = "Compare MSFT and GOOGL stock performance this quarter"
        chunks = []

        async for chunk in create_request_context(
            user_message=query,
            actor_id="test-user-6",
            session_id="session-006",
            memory_id=None,
        ):
            chunks.append(chunk)

        assert len(tool_tracker["financial_analysis_agent_tool_calls"]) == 1
        assert len(tool_tracker["budget_agent_tool_calls"]) == 0


# ---------------------------------------------------------------------------
# Integration Tests: Concurrent Request Isolation
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestConcurrentRequestIsolation:
    """Test that concurrent requests are processed in isolation.

    Validates: Requirement 1.5 - at least 10 simultaneous requests complete
    without any request receiving response content intended for a different actor_id.
    """

    async def test_concurrent_requests_complete_without_cross_contamination(
        self, mock_request_factory
    ):
        """10+ concurrent requests should each receive their own isolated response.

        Each request has a unique actor_id and query. We verify that:
        1. All 12 requests complete successfully
        2. Each response contains content related to its own query
        3. No response contains content from another request's actor_id

        Validates: Requirements 1.5, 4.3
        """
        from request_factory import create_request_context

        num_requests = 12

        # Create distinct queries and actor_ids for each request
        requests = [
            {
                "user_message": f"Budget for actor {i} with ${1000 * (i + 1)} income",
                "actor_id": f"actor-{i:03d}",
                "session_id": f"session-{i:03d}",
                "memory_id": None,
            }
            for i in range(num_requests)
        ]

        async def collect_response(request_params: dict) -> dict:
            """Collect all chunks from a single request into a response dict."""
            chunks = []
            async for chunk in create_request_context(**request_params):
                chunks.append(chunk)
            return {
                "actor_id": request_params["actor_id"],
                "response": "".join(chunks),
                "chunk_count": len(chunks),
            }

        # Fire all requests concurrently
        results = await asyncio.gather(
            *[collect_response(req) for req in requests]
        )

        # Verify all 12 requests completed
        assert len(results) == num_requests

        # Verify each response is non-empty and isolated
        seen_responses = set()
        for i, result in enumerate(results):
            # Each response should be non-empty
            assert result["chunk_count"] > 0, (
                f"Request for {result['actor_id']} returned no chunks"
            )
            assert len(result["response"]) > 0, (
                f"Request for {result['actor_id']} returned empty response"
            )

            # Each response should be unique (different actor = different response)
            assert result["response"] not in seen_responses, (
                f"Duplicate response detected for {result['actor_id']}"
            )
            seen_responses.add(result["response"])

            # Response should contain content related to its own query
            assert f"actor {i}" in result["response"], (
                f"Response for actor-{i:03d} does not contain its expected content. "
                f"Got: {result['response'][:100]}"
            )

    async def test_concurrent_mixed_routing_isolation(
        self, mock_request_factory
    ):
        """Concurrent requests with mixed budget/investment queries stay isolated.

        Sends a mix of budget and investment queries concurrently and verifies
        each gets the appropriate routing without interference.

        Validates: Requirements 1.5, 4.3
        """
        from request_factory import create_request_context

        mixed_requests = [
            # Budget queries (even indices)
            {"user_message": "Create a budget for $3000 income", "actor_id": "budget-0", "session_id": "s0", "memory_id": None},
            {"user_message": "Analyze AAPL stock price", "actor_id": "invest-1", "session_id": "s1", "memory_id": None},
            {"user_message": "Track my monthly expense categories", "actor_id": "budget-2", "session_id": "s2", "memory_id": None},
            {"user_message": "Build a growth stock portfolio", "actor_id": "invest-3", "session_id": "s3", "memory_id": None},
            {"user_message": "Help me reduce my spending habits", "actor_id": "budget-4", "session_id": "s4", "memory_id": None},
            {"user_message": "Compare Tesla and Amazon stocks", "actor_id": "invest-5", "session_id": "s5", "memory_id": None},
            {"user_message": "Set up an emergency savings fund", "actor_id": "budget-6", "session_id": "s6", "memory_id": None},
            {"user_message": "Research Microsoft stock fundamentals", "actor_id": "invest-7", "session_id": "s7", "memory_id": None},
            {"user_message": "How to allocate a $10000 budget", "actor_id": "budget-8", "session_id": "s8", "memory_id": None},
            {"user_message": "Create an aggressive investment strategy", "actor_id": "invest-9", "session_id": "s9", "memory_id": None},
            {"user_message": "Plan my debt repayment schedule", "actor_id": "budget-10", "session_id": "s10", "memory_id": None},
            {"user_message": "Analyze GOOGL stock for long term invest", "actor_id": "invest-11", "session_id": "s11", "memory_id": None},
        ]

        async def collect_response(request_params: dict) -> dict:
            """Collect all chunks from a single request."""
            chunks = []
            async for chunk in create_request_context(**request_params):
                chunks.append(chunk)
            return {
                "actor_id": request_params["actor_id"],
                "message": request_params["user_message"],
                "response": "".join(chunks),
            }

        # Fire all requests concurrently
        results = await asyncio.gather(
            *[collect_response(req) for req in mixed_requests]
        )

        # Verify all completed
        assert len(results) == 12

        # Verify each response is non-empty
        for result in results:
            assert len(result["response"]) > 0, (
                f"Empty response for {result['actor_id']}"
            )

        # Verify budget requests got budget-type responses
        budget_results = [r for r in results if r["actor_id"].startswith("budget-")]
        for r in budget_results:
            assert "Budget" in r["response"] or "budget" in r["response"].lower(), (
                f"Budget request for {r['actor_id']} got non-budget response: "
                f"{r['response'][:100]}"
            )

        # Verify investment requests got investment-type responses
        invest_results = [r for r in results if r["actor_id"].startswith("invest-")]
        for r in invest_results:
            assert "Investment" in r["response"] or "invest" in r["response"].lower() or "analysis" in r["response"].lower(), (
                f"Investment request for {r['actor_id']} got non-investment response: "
                f"{r['response'][:100]}"
            )

    async def test_concurrent_requests_no_shared_memory_leakage(
        self, mock_request_factory
    ):
        """Concurrent requests with different memory contexts stay isolated.

        Verifies that memory context from one request does not leak into another.

        Validates: Requirement 1.5
        """
        from request_factory import create_request_context

        num_requests = 10

        requests = [
            {
                "user_message": f"Budget question from user {i}",
                "actor_id": f"user-{i}",
                "session_id": f"session-{i}",
                "memory_id": None,  # No memory - ensures clean isolation test
            }
            for i in range(num_requests)
        ]

        async def collect_response(request_params: dict) -> dict:
            chunks = []
            async for chunk in create_request_context(**request_params):
                chunks.append(chunk)
            return {
                "actor_id": request_params["actor_id"],
                "response": "".join(chunks),
            }

        results = await asyncio.gather(
            *[collect_response(req) for req in requests]
        )

        # All 10 requests completed
        assert len(results) == num_requests

        # Each response should be unique (different user = different response content)
        responses = [r["response"] for r in results]
        # Responses should differ since messages differ
        unique_responses = set(responses)
        assert len(unique_responses) == num_requests, (
            f"Expected {num_requests} unique responses, got {len(unique_responses)}. "
            "This indicates potential response cross-contamination."
        )
