# Production-hardened AgentCore entrypoint with thread-safe request handling,
# input sanitization, and startup validation.
#
# Requirements: 1.1, 1.4, 9.1, 9.2, 9.3, 9.4, 9.6, 10.5

from strands import tool

from budget_agent import FinancialReport, budget_agent
from financial_analysis_agent import financial_analysis_agent
from bedrock_agentcore import BedrockAgentCoreApp

from config import validate_startup
from request_factory import create_request_context, register_tools, GUARDRAIL_REFUSAL_MESSAGE
from input_sanitizer import InputSanitizer

import uuid
import os
import logging

# Configure logging for error tracking and debugging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize AgentCore app
app = BedrockAgentCoreApp()


@tool
def budget_agent_tool(query: str) -> FinancialReport:
    """Generate structured financial reports with budget analysis and recommendations."""
    logger.info(f"budget_agent_tool called with query: {query[:100]}...")
    try:
        structured_response = budget_agent.structured_output(
            output_model=FinancialReport, prompt=query
        )
        logger.info("budget_agent_tool completed successfully")
        return structured_response
    except Exception as e:
        logger.error(f"Error in budget_agent_tool: {e}", exc_info=True)
        return FinancialReport(
            monthly_income=0.0,
            budget_categories=[],
            recommendations=[f"Error generating report: {str(e)}"],
            financial_health_score=1,
        )


@tool
def financial_analysis_agent_tool(query: str) -> str:
    """Handle investment analysis queries including stock research, portfolio creation, and performance comparisons."""
    logger.info(f"financial_analysis_agent_tool called with query: {query[:100]}...")
    try:
        response = financial_analysis_agent(query)
        logger.info("financial_analysis_agent_tool completed successfully")
        return str(response)
    except Exception as e:
        logger.error(f"Error in financial_analysis_agent_tool: {e}", exc_info=True)
        return f"❌ Financial analysis error: {str(e)}"


# Register tools with the request factory (breaks circular import)
register_tools([budget_agent_tool, financial_analysis_agent_tool])
logger.info("Application tools registered with request factory")


@app.entrypoint
async def invoke(payload):
    """AI agent entrypoint with input sanitization and thread-safe request handling.

    Flow:
    1. Extract request parameters from payload
    2. Validate input via InputSanitizer (before guardrails) - Req 9.3, 9.6
    3. Return error with sanitized message on validation failure - Req 9.1, 9.2
    4. Stream response via request factory (per-request isolation) - Req 1.1, 1.4
    5. Handle Bedrock Guardrails PROMPT_ATTACK with generic refusal - Req 9.4
    """
    user_message = payload["prompt"]
    actor_id = payload.get("actor_id", "default_user")
    session_id = payload.get("session_id", str(uuid.uuid4()))

    # Input sanitization (before guardrails) - Requirements 9.3, 9.6
    # This layered defense applies pattern-based filtering prior to model-level guardrails
    sanitizer = InputSanitizer()
    result = sanitizer.validate(user_message)
    if not result.is_valid:
        # Return HTTP 400 equivalent with appropriate error message
        # Req 9.1: injection patterns -> "Your message could not be processed due to policy violation"
        # Req 9.2: length exceeded -> "Message exceeds maximum length of 4000 characters"
        yield f"Error: {result.error_message}"
        return

    # Stream response via request factory - Requirements 1.1, 1.4, 9.4
    # The request factory handles Bedrock Guardrail PROMPT_ATTACK responses internally,
    # returning a generic refusal message without leaking guardrail configuration.
    memory_id = os.environ.get('AGENTCORE_MEMORY_ID')
    try:
        async for chunk in create_request_context(user_message, actor_id, session_id, memory_id):
            yield chunk
    except Exception as exc:
        # Catch any unhandled exceptions from the request pipeline.
        # Check for guardrail-related exceptions that may have propagated.
        exc_str = str(exc).lower()
        if "guardrail" in exc_str or "prompt_attack" in exc_str:
            logger.warning(
                "Guardrail intervention caught at entrypoint for actor_id=%s",
                actor_id,
            )
            yield GUARDRAIL_REFUSAL_MESSAGE
        else:
            logger.error(
                "Unhandled exception in invoke for actor_id=%s: %s",
                actor_id,
                str(exc),
                exc_info=True,
            )
            # Include error details in response for debugging during staging
            yield f"Error: {type(exc).__name__}: {str(exc)[:200]}"


if __name__ == "__main__":
    import asyncio
    # Validate startup (region + guardrail accessibility) before accepting requests
    # Requirement 10.5
    asyncio.run(validate_startup())
    app.run()
