"""Root conftest.py - mocks runtime-only packages not available locally.

The `bedrock_agentcore` package is only available inside the AgentCore runtime.
This file creates mock modules so tests can import and run locally.
"""

import sys
from unittest.mock import MagicMock

# Mock the bedrock_agentcore package hierarchy before any test imports it
_bedrock_agentcore = MagicMock()
_bedrock_agentcore.memory = MagicMock()
_bedrock_agentcore.memory.MemoryClient = MagicMock

sys.modules.setdefault("bedrock_agentcore", _bedrock_agentcore)
sys.modules.setdefault("bedrock_agentcore.memory", _bedrock_agentcore.memory)

# Mock BedrockAgentCoreApp if not available
_bedrock_agentcore.BedrockAgentCoreApp = MagicMock
sys.modules.setdefault("bedrock_agentcore", _bedrock_agentcore)

# Mock the Strands Agents SDK hierarchy so request_factory / agents import locally
# when the real SDK is not installed. Tests that exercise agent behavior patch
# request_factory.Agent directly, so these mocks only need to satisfy imports.
if "strands" not in sys.modules:
    _strands = MagicMock()

    # @tool decorator: return the function unchanged so decorated tools stay callable
    def _tool(func=None, **_kwargs):
        if func is None:
            return lambda f: f
        return func

    _strands.tool = _tool
    _strands.Agent = MagicMock

    _strands_models = MagicMock()
    _strands_models.BedrockModel = MagicMock

    _strands_cm = MagicMock()
    _strands_cm.SummarizingConversationManager = MagicMock

    sys.modules["strands"] = _strands
    sys.modules["strands.models"] = _strands_models
    sys.modules["strands.agent"] = MagicMock()
    sys.modules["strands.agent.conversation_manager"] = _strands_cm
