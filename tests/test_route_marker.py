"""The backend streams a [[ROUTE:<choice>:<confidence>:<act|escalate>]] control
marker so the UI can show which specialist Decider picked and how sure it was.
"""

from unittest.mock import MagicMock, patch

from decider_router import RouteDecision


def _agent_factory(**kwargs):
    async def stream(message):
        yield {"data": "ok"}

    agent = MagicMock()
    agent.stream_async = stream
    return agent


async def _chunks(decision):
    import request_factory

    out = []
    with patch("request_factory.Agent", side_effect=_agent_factory), patch(
        "request_factory._bedrock_model"
    ), patch("request_factory.get_guardrail_id", return_value="g"), patch(
        "request_factory.route_query", return_value=decision
    ):
        async for chunk in request_factory.create_request_context(
            user_message="q", actor_id="a", session_id="s", memory_id=None
        ):
            out.append(chunk)
    return out


async def test_confident_decision_emits_act_marker_first():
    chunks = await _chunks(
        RouteDecision(choice="investment", confidence=0.97, should_act=True, source="decider")
    )
    assert chunks[0] == "[[ROUTE:investment:0.97:act]]"
    assert "ok" in chunks


async def test_low_confidence_emits_escalate_marker():
    chunks = await _chunks(
        RouteDecision(choice="both", confidence=0.27, should_act=False, source="decider")
    )
    assert chunks[0] == "[[ROUTE:both:0.27:escalate]]"


async def test_unreachable_decider_emits_no_marker():
    chunks = await _chunks(RouteDecision(choice=None, should_act=False, source="fallback"))
    assert not any(c.startswith("[[ROUTE:") for c in chunks)
    assert "ok" in chunks
