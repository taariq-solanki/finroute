"""Request Factory module - thread-safe per-request agent context creation.

This module replaces the unsafe pattern of mutating orchestrator_agent.system_prompt
on every request. Instead, it:
1. Keeps ORCHESTRATOR_PROMPT as an immutable module constant
2. Creates per-request Agent instances with isolated conversation history
3. Builds enhanced prompts in local variables only
4. Accepts tools via register_tools() to avoid circular imports with main.py
5. Handles Bedrock Guardrail PROMPT_ATTACK responses with generic refusal

Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 9.4
"""

import asyncio
import logging
from typing import AsyncGenerator, Optional

from strands import Agent
from strands.models import BedrockModel
from strands.agent.conversation_manager import SummarizingConversationManager
from bedrock_agentcore.memory import MemoryClient
from botocore.exceptions import ClientError

from config import REQUIRED_REGION
from utils import get_guardrail_id

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Generic refusal message for guardrail PROMPT_ATTACK interventions.
# This message intentionally reveals nothing about guardrail IDs, config, or
# detection methodology - Requirement 9.4
# ---------------------------------------------------------------------------
GUARDRAIL_REFUSAL_MESSAGE: str = (
    "I'm unable to process this request. Please rephrase your question."
)

# ---------------------------------------------------------------------------
# Immutable module constant - the base orchestrator system prompt.
# This value is NEVER modified after module initialization.
# ---------------------------------------------------------------------------
ORCHESTRATOR_PROMPT: str = (
    "You are a comprehensive financial advisor orchestrator that coordinates "
    "between specialized financial agents to provide complete financial guidance. \n\n"
    "Your specialized agents are:\n"
    "1. **budget_agent**: Handles budgeting, spending analysis, savings "
    "recommendations, and expense tracking\n"
    "2. **financial_analysis_agent_tool**: Handles investment analysis, stock "
    "research, portfolio creation, and performance comparisons\n\n"
    "Guidelines for using your agents:\n"
    "- Use **budget_agent** for questions about: budgets, spending habits, "
    "expense tracking, savings goals, debt management\n"
    "- Use **financial_analysis_agent_tool** for questions about: stocks, "
    "investments, portfolios, market analysis, investment recommendations\n"
    "- You can use both agents together for comprehensive financial planning\n"
    "- Always provide a cohesive summary that combines insights from multiple "
    "agents when applicable\n"
    "- Maintain a helpful, professional tone and include appropriate disclaimers "
    "about financial advice\n\n"
    "When a user asks a question:\n"
    "1. Determine which agent(s) are most appropriate\n"
    "2. Call the relevant agent(s) with focused queries\n"
    "3. Synthesize the responses into a coherent, comprehensive answer\n"
    "4. Provide actionable next steps when possible"
)

# ---------------------------------------------------------------------------
# Model configuration - lazily initialized to avoid import-time AWS calls
# that can fail in AgentCore containers before IAM permissions propagate.
# ---------------------------------------------------------------------------
_bedrock_model = None


def _get_bedrock_model() -> BedrockModel:
    """Get or lazily initialize the BedrockModel singleton."""
    global _bedrock_model
    if _bedrock_model is None:
        _bedrock_model = BedrockModel(
            model_id="eu.amazon.nova-pro-v1:0",
            region_name=REQUIRED_REGION,
            temperature=0.0,
            guardrail_id=get_guardrail_id(),
            guardrail_version="DRAFT",
            guardrail_trace="enabled",
        )
    return _bedrock_model

# ---------------------------------------------------------------------------
# Tool registry - populated via register_tools() from main.py at startup.
# This avoids circular imports since main.py imports from request_factory,
# and request_factory no longer imports from main.py.
# ---------------------------------------------------------------------------
_AGENT_TOOLS: list = []


def register_tools(tools: list) -> None:
    """Register agent tools for use in per-request agent instances.

    This function must be called once at application startup (from main.py)
    to provide the tool functions that the orchestrator agent uses.
    This breaks the circular import between main.py and request_factory.py.

    Args:
        tools: List of @tool decorated callable functions.
    """
    global _AGENT_TOOLS
    _AGENT_TOOLS = list(tools)
    logger.info("Request factory tools registered: %d tool(s)", len(_AGENT_TOOLS))


# Memory query timeout in seconds
_MEMORY_TIMEOUT_SECONDS: float = 5.0


async def _query_memory(
    memory_id: str,
    user_message: str,
    actor_id: str,
) -> Optional[str]:
    """Query MemoryClient for relevant context with a 5-second timeout.

    Args:
        memory_id: The AgentCore memory identifier.
        user_message: The user's query to find relevant memories for.
        actor_id: The user identifier for namespace scoping.

    Returns:
        A formatted memory context string, or None if query fails or times out.
    """
    try:
        memory_context = await asyncio.wait_for(
            asyncio.to_thread(
                _fetch_memory_records, memory_id, user_message, actor_id
            ),
            timeout=_MEMORY_TIMEOUT_SECONDS,
        )
        return memory_context
    except asyncio.TimeoutError:
        logger.warning(
            "MemoryClient query timed out after %.1f seconds for actor_id=%s",
            _MEMORY_TIMEOUT_SECONDS,
            actor_id,
        )
        return None
    except Exception as exc:
        logger.warning(
            "MemoryClient query failed for actor_id=%s: %s",
            actor_id,
            str(exc),
        )
        return None


def _fetch_memory_records(
    memory_id: str,
    user_message: str,
    actor_id: str,
) -> Optional[str]:
    """Synchronous helper to fetch memory records from MemoryClient.

    Returns:
        Formatted memory context string, or None if no records found.
    """
    memory_client = MemoryClient()
    relevant_memories = memory_client.query_records(
        memory_id=memory_id,
        query=user_message,
        namespace=f"finance/user/{actor_id}/facts",
        max_results=5,
    )

    if not relevant_memories:
        return None

    memory_context = "\n\nRelevant user information from previous conversations:\n"
    for record in relevant_memories:
        memory_context += f"- {record.get('content', '')}\n"

    return memory_context


def _create_per_request_agent(enhanced_prompt: str) -> Agent:
    """Create a fresh Agent instance for an individual request.

    This ensures complete isolation - each request gets its own conversation
    history and system prompt. No module-level agent state is ever mutated.

    Args:
        enhanced_prompt: The system prompt to use (base + optional memory context).

    Returns:
        A new Agent instance with isolated state.
    """
    return Agent(
        model=_get_bedrock_model(),
        system_prompt=enhanced_prompt,
        tools=_AGENT_TOOLS,
        conversation_manager=SummarizingConversationManager(
            summary_ratio=0.3,
            preserve_recent_messages=5,
        ),
    )


def _is_guardrail_intervention(error_code: str, error_message: str) -> bool:
    """Determine if a ClientError represents a Bedrock Guardrail intervention.

    Checks for known error codes and message patterns that indicate the
    guardrail blocked the request due to PROMPT_ATTACK or content policy.

    Args:
        error_code: The AWS error code from the ClientError response.
        error_message: The full error message string.

    Returns:
        True if the error is a guardrail intervention, False otherwise.
    """
    # Known error codes for guardrail interventions
    guardrail_error_codes = {
        "ValidationException",
        "AccessDeniedException",
    }

    error_message_lower = error_message.lower()

    # Check for explicit guardrail-related keywords in the message
    guardrail_indicators = [
        "guardrail",
        "prompt_attack",
        "content policy",
        "content filtered",
        "guardrails_intervened",
    ]

    if error_code in guardrail_error_codes:
        if any(indicator in error_message_lower for indicator in guardrail_indicators):
            return True

    return False


async def create_request_context(
    user_message: str,
    actor_id: str,
    session_id: str,
    memory_id: Optional[str],
) -> AsyncGenerator[str, None]:
    """Create an isolated request context and stream the response.

    This function:
    1. Queries MemoryClient for relevant context (with 5s timeout)
    2. Constructs an enhanced prompt in a LOCAL variable (never mutates module state)
    3. Creates a per-request Agent instance with isolated conversation history
    4. Streams the response as an AsyncGenerator yielding SSE chunks
    5. Handles Bedrock Guardrail PROMPT_ATTACK with generic refusal (Req 9.4)
    6. Stores conversation in memory after response completes

    The module-level state is NEVER mutated.

    Args:
        user_message: The user's input message.
        actor_id: Identifier for the user (for memory namespacing).
        session_id: Session identifier for memory event correlation.
        memory_id: Optional AgentCore memory ID. If None, skips memory lookup.

    Yields:
        String chunks from the agent's streaming response.

    Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 9.4
    """
    # Step 1: Query memory context (local variable only)
    memory_context: Optional[str] = None
    if memory_id:
        memory_context = await _query_memory(memory_id, user_message, actor_id)

    # Step 2: Build enhanced prompt in a LOCAL variable - never mutate module state
    if memory_context:
        enhanced_prompt: str = ORCHESTRATOR_PROMPT + memory_context
    else:
        enhanced_prompt = ORCHESTRATOR_PROMPT

    # Step 3: Create a per-request agent with isolated conversation history
    request_agent = _create_per_request_agent(enhanced_prompt)

    # Step 4: Stream response with guardrail intervention handling
    full_response = ""
    try:
        async for event in request_agent.stream_async(user_message):
            if "data" in event:
                chunk = event["data"]
                full_response += chunk
                yield chunk
    except ClientError as exc:
        # Handle Bedrock Guardrails PROMPT_ATTACK or AccessDenied from guardrail
        # Return generic refusal without leaking guardrail config - Req 9.4
        error_code = exc.response.get("Error", {}).get("Code", "")
        error_message = str(exc)

        if _is_guardrail_intervention(error_code, error_message):
            logger.warning(
                "Guardrail intervention detected for actor_id=%s: code=%s",
                actor_id,
                error_code,
            )
            yield GUARDRAIL_REFUSAL_MESSAGE
            return
        else:
            # Re-raise non-guardrail ClientErrors
            logger.error(
                "Bedrock ClientError for actor_id=%s: %s",
                actor_id,
                error_message,
            )
            raise
    except Exception as exc:
        # Check if the exception message indicates a guardrail intervention
        exc_str = str(exc).lower()
        if "guardrail" in exc_str or "prompt_attack" in exc_str:
            logger.warning(
                "Guardrail exception detected for actor_id=%s: %s",
                actor_id,
                type(exc).__name__,
            )
            yield GUARDRAIL_REFUSAL_MESSAGE
            return
        raise

    # Step 5: Store conversation in memory (post-response, non-blocking)
    if memory_id:
        try:
            await asyncio.to_thread(
                _store_memory_event,
                memory_id,
                actor_id,
                session_id,
                user_message,
                full_response,
            )
        except Exception as exc:
            logger.warning(
                "Failed to store memory event for actor_id=%s: %s",
                actor_id,
                str(exc),
            )


def _store_memory_event(
    memory_id: str,
    actor_id: str,
    session_id: str,
    user_message: str,
    full_response: str,
) -> None:
    """Synchronous helper to store a conversation event in memory.

    Args:
        memory_id: The AgentCore memory identifier.
        actor_id: The user identifier.
        session_id: The session identifier.
        user_message: The original user message.
        full_response: The complete agent response.
    """
    memory_client = MemoryClient()
    memory_client.create_event(
        memory_id=memory_id,
        actor_id=actor_id,
        session_id=session_id,
        content=f"User: {user_message}\nAssistant: {full_response}",
    )
