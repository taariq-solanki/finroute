"""decider_router.py — Reusable tool-selection with Strands Decider 2B.

This module is FinRoute's "reusable decision pattern" for the Strands Decider
hackathon (pattern: #tool-selection). It hands a single, meaningful decision —
"which specialist agent should handle this request?" — to Strands Decider 2B,
a fast, calibrated decision model, instead of spending a full LLM call on routing.

Why a decision model and not the LLM?
---------------------------------------
A general LLM can route, but it cannot give you an honest, calibrated confidence
number for its choice. Decider 2B returns a probability per option plus a
calibrated confidence. That lets an agent apply an explicit policy:

    confidence >= ACT_THRESHOLD   -> ACT: route directly to the chosen agent
    confidence <  ACT_THRESHOLD   -> ESCALATE: let the full LLM orchestrator decide

So the fast, cheap path handles the clear cases, and the LLM is reserved for the
genuinely ambiguous ones. This is the "hybrid agent" idea from the Decider docs.

How to reuse this in your own agent
-----------------------------------
1. Run a Decider server:  strands-decider serve <model> --port 8010
2. Point DECIDER_ENDPOINT at it (default: http://127.0.0.1:8010/v1/systemone).
3. Define your options as a dict of {name: description} and call `decide()`.
4. Use `RouteDecision.should_act` to branch between the fast path and your LLM.

The module is dependency-light (standard library + urllib) and never raises on a
network/Decider failure — it degrades to should_act=False so the caller can fall
back to the LLM. That keeps the decision model strictly additive and safe.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Where the Decider server is listening. Override with the DECIDER_ENDPOINT env
# var in deployment. The default matches `strands-decider serve ... --port 8010`.
DECIDER_ENDPOINT: str = os.environ.get(
    "DECIDER_ENDPOINT", "http://127.0.0.1:8010/v1/systemone"
)

# Request timeout (seconds). Decider on CPU answers in ~2s; give headroom but
# never block the whole request pipeline waiting on it.
DECIDER_TIMEOUT_SECONDS: float = float(os.environ.get("DECIDER_TIMEOUT_SECONDS", "8"))

# Confidence at/above which we trust Decider's choice and act on it directly.
# The Decider docs note that answers at confidence >= 0.9 are right ~95% of the
# time on unseen short tasks; below that, confirm or escalate. We expose it so
# callers can tune the act/escalate boundary for their own risk tolerance.
ACT_THRESHOLD: float = float(os.environ.get("DECIDER_ACT_THRESHOLD", "0.75"))


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


@dataclass
class RouteDecision:
    """The outcome of a routing decision.

    Attributes:
        choice: The option Decider selected (e.g. "budget"), or None on failure.
        confidence: Decider's calibrated confidence in that choice (0..1).
        probabilities: Full probability distribution over all options.
        should_act: True if confidence >= ACT_THRESHOLD and the decision is usable.
                    When False, the caller should fall back to the LLM.
        latency_ms: How long the Decider call took, for cost/latency reporting.
        source: "decider" when the model answered, "fallback" when it could not
                be reached (so logs/metrics can tell them apart).
    """

    choice: Optional[str]
    confidence: float = 0.0
    probabilities: Dict[str, float] = field(default_factory=dict)
    should_act: bool = False
    latency_ms: float = 0.0
    source: str = "decider"

    def __str__(self) -> str:  # pragma: no cover - cosmetic
        if self.choice is None:
            return f"RouteDecision(unavailable, source={self.source})"
        return (
            f"RouteDecision(choice={self.choice!r}, "
            f"confidence={self.confidence:.3f}, should_act={self.should_act}, "
            f"source={self.source}, latency_ms={self.latency_ms:.0f})"
        )


# ---------------------------------------------------------------------------
# Core, domain-agnostic decision call
# ---------------------------------------------------------------------------


def decide(
    state: str,
    options: Dict[str, str],
    instructions: str,
    *,
    act_threshold: float = ACT_THRESHOLD,
    endpoint: str = DECIDER_ENDPOINT,
    timeout: float = DECIDER_TIMEOUT_SECONDS,
) -> RouteDecision:
    """Ask Strands Decider 2B to pick one option, with calibrated confidence.

    This is fully generic: use it for any tool-selection / classification /
    routing decision by passing your own options and instructions.

    Args:
        state: The raw input to decide over (e.g. the user's message).
        options: Map of {option_name: human-readable description}. Descriptions
                 matter — richer criteria give Decider far better accuracy and
                 confidence (observed 0.80 -> 0.97 just by describing options).
        instructions: The typed question to ask about the state.
        act_threshold: Confidence boundary for should_act.
        endpoint: Decider /v1/systemone URL.
        timeout: Per-call timeout in seconds.

    Returns:
        A RouteDecision. On any failure it returns an "unavailable" decision
        (choice=None, should_act=False) rather than raising, so routing stays safe.
    """
    payload = {
        "state": state,
        "questions": {
            "route": {
                "type": "choice",
                "instructions": instructions,
                "criteria": options,
            }
        },
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        endpoint, data=data, headers={"content-type": "application/json"}
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
        logger.warning("Decider unreachable (%s); falling back to LLM routing.", exc)
        return RouteDecision(choice=None, should_act=False, source="fallback")
    except Exception as exc:  # defensive: never let routing crash the request
        logger.warning("Decider call failed (%s); falling back to LLM routing.", exc)
        return RouteDecision(choice=None, should_act=False, source="fallback")

    try:
        answer = body["answers"]["route"]
        choice = answer["choice"]
        confidence = float(answer.get("confidence", 0.0))
        probabilities = {k: float(v) for k, v in answer.get("probabilities", {}).items()}
        latency_ms = float(body.get("latency_ms", 0.0))
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning("Decider response malformed (%s); falling back.", exc)
        return RouteDecision(choice=None, should_act=False, source="fallback")

    decision = RouteDecision(
        choice=choice,
        confidence=confidence,
        probabilities=probabilities,
        should_act=confidence >= act_threshold,
        latency_ms=latency_ms,
        source="decider",
    )
    logger.info("Decider routing decision: %s", decision)
    return decision


# ---------------------------------------------------------------------------
# FinRoute-specific convenience wrapper
# ---------------------------------------------------------------------------

# The specialist agents FinRoute routes between, with descriptions that act as
# the Decider criteria. Keep these aligned with the orchestrator's agents.
FINROUTE_OPTIONS: Dict[str, str] = {
    "budget": (
        "Budgeting, the 50/30/20 rule, spending analysis, savings goals, "
        "expense tracking, debt management, and financial health scoring."
    ),
    "investment": (
        "Stock research and analysis, diversified portfolio creation by risk "
        "level, market/sector analysis, and comparing stock performance."
    ),
    "both": (
        "The request needs BOTH budgeting help AND investment/portfolio help, "
        "e.g. 'budget my salary and invest the savings'."
    ),
}

FINROUTE_INSTRUCTIONS: str = (
    "Which financial specialist should handle this user request?"
)


def route_query(user_message: str, **kwargs) -> RouteDecision:
    """Route a FinRoute user message to budget / investment / both via Decider.

    Thin wrapper over `decide()` pre-loaded with FinRoute's options. Returns a
    RouteDecision; check `.should_act` to decide between the fast Decider path
    and the LLM-orchestrator fallback.
    """
    return decide(
        state=user_message,
        options=FINROUTE_OPTIONS,
        instructions=FINROUTE_INSTRUCTIONS,
        **kwargs,
    )


if __name__ == "__main__":
    # Manual smoke test. Requires a running Decider server (see module docstring).
    logging.basicConfig(level=logging.INFO)
    samples = [
        "How should I split my $5000 monthly salary into a budget?",
        "Analyze Apple stock and build me a moderate-risk portfolio for $10,000",
        "Help me budget my $6000 salary and start investing the savings",
        "asdfghjkl",  # ambiguous / nonsense -> expect low confidence, should_act False
    ]
    for s in samples:
        d = route_query(s)
        verdict = "ACT (use Decider)" if d.should_act else "ESCALATE (use LLM)"
        print(f"\nQuery: {s}\n  -> {d}\n  -> {verdict}")
