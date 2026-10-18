"""demo_routing.py — Live demonstration of FinRoute's Decider 2B routing.

This is the demo centerpiece for the Strands Decider hackathon (pattern:
#tool-selection). It shows the one meaningful decision FinRoute hands to the
Strands Decider 2B decision model: "which specialist agent should handle this
request?" — along with Decider's calibrated confidence and the act/escalate
policy that a plain LLM router cannot provide.

It does NOT call the LLM or any AWS service, so it runs locally, free, and fast.

Prerequisite — start a Decider server in another terminal:

    OMP_NUM_THREADS=2 .venv-decider/bin/strands-decider serve \\
        StrandsAgents/strands-decider-2B-qwen3.5-v1-2610 --device cpu --port 8010

Then run:

    .venv-decider/bin/python demo_routing.py

Each line shows: the user's message, the specialist Decider picked, the full
probability distribution, the calibrated confidence, and whether FinRoute ACTS
on the fast decision or ESCALATES to the LLM orchestrator.
"""

from __future__ import annotations

import sys

from decider_router import route_query, ACT_THRESHOLD

# A curated script of queries that showcases all four behaviors:
#   - a clear budget query          -> ACT: budget
#   - a clear investment query      -> ACT: investment
#   - a genuine combined query      -> ACT: both (or ESCALATE if ambiguous)
#   - a vague / nonsense query      -> ESCALATE: defer to the LLM
DEMO_QUERIES = [
    "How should I split my $5,000 monthly salary into a budget?",
    "I have $800/month in dining expenses — how do I cut back and save?",
    "Analyze Apple stock and tell me its 52-week range.",
    "Build me a moderate-risk portfolio for $10,000.",
    "Budget my $6,000 salary and invest whatever is left over.",
    "What do you think?",  # vague -> expect low confidence -> ESCALATE
]

GREEN = "\033[92m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def _bar(p: float, width: int = 24) -> str:
    filled = int(round(p * width))
    return "█" * filled + "·" * (width - filled)


def run(queries) -> None:
    print()
    print(f"{BOLD}FinRoute — Strands Decider 2B tool-selection{RESET}")
    print(f"{DIM}Act threshold: confidence >= {ACT_THRESHOLD:.2f} "
          f"routes directly; below that, escalate to the LLM.{RESET}")
    print("=" * 68)

    acted = 0
    escalated = 0
    total_latency = 0.0

    for q in queries:
        d = route_query(q)
        print(f"\n{BOLD}User:{RESET} {q}")

        if d.source == "fallback":
            print(f"  {YELLOW}Decider unreachable — is the server running on :8010?{RESET}")
            print(f"  -> ESCALATE to LLM orchestrator (safe fallback)")
            escalated += 1
            continue

# Probability distribution, sorted high -> low
        for name, p in sorted(d.probabilities.items(), key=lambda kv: kv[1], reverse=True):
            mark = f"{CYAN}<= choice{RESET}" if name == d.choice else ""
            print(f"    {name:<11} {_bar(p)} {p:5.1%} {mark}")

        if d.should_act:
            acted += 1
            total_latency += d.latency_ms  # only count latency on acted routes
            print(f"  {GREEN}ACT{RESET}  -> route directly to '{d.choice}' "
                  f"(confidence {d.confidence:.2f}, {d.latency_ms:.0f} ms, no LLM routing call)")
        else:
            escalated += 1
            print(f"  {YELLOW}ESCALATE{RESET} -> confidence {d.confidence:.2f} below "
                  f"{ACT_THRESHOLD:.2f}; defer routing to the LLM orchestrator")

    print("\n" + "=" * 68)
    n = acted + escalated
    print(f"{BOLD}Summary:{RESET} {n} queries | {GREEN}{acted} acted via Decider{RESET} "
          f"| {YELLOW}{escalated} escalated to LLM{RESET}")
    if acted:
        print(f"{DIM}Avg Decider latency on acted routes: "
              f"{total_latency / max(acted,1):.0f} ms (CPU). Each ACT skips an LLM "
              f"routing round-trip.{RESET}")
    print()


if __name__ == "__main__":
    # Allow custom queries from the command line: python demo_routing.py "my question"
    custom = sys.argv[1:]
    run(custom if custom else DEMO_QUERIES)
