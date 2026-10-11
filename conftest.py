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
