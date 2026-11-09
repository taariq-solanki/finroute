"""analyze_threshold.py — tune the Decider ACT_THRESHOLD from real routing logs.

FinRoute's router uses a fixed confidence cutoff (ACT_THRESHOLD, default 0.75):
at/above it the fast Decider decision is trusted (ACT); below it the request is
handed to the LLM orchestrator (ESCALATE). That 0.75 started as an educated guess.
This script replaces the guess with evidence: it reads the structured routing-decision
log lines the deployed agent already emits and reports the confidence distribution,
so you can choose a threshold grounded in your own traffic.

It pulls from the AgentCore runtime's CloudWatch log group and parses lines like:
    Decider routing decision: RouteDecision(choice='investment', confidence=0.987, ...)

Usage:
    # analyse the deployed runtime's logs (last 24h by default)
    python analyze_threshold.py --runtime finroute_agent-ZAzLwHBOOG

    # custom region / window / candidate threshold
    python analyze_threshold.py --runtime <id> --region us-east-1 --hours 72 --threshold 0.8

    # analyse a local demo_routing.py run instead (pipe its output in)
    python demo_routing.py | python analyze_threshold.py --stdin

No AWS write access is used; this is read-only (CloudWatch GetLogEvents).
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from dataclasses import dataclass
from typing import List, Optional

# Matches the confidence (and choice) in both the RouteDecision repr and the
# "Decider ACT/ESCALATE" lines emitted by request_factory / decider_router.
_CONF_RE = re.compile(r"confidence[=:]\s*([01]?\.\d+)")
_CHOICE_RE = re.compile(r"choice[=:]\s*'?([a-zA-Z]+)'?")


@dataclass
class Decision:
    confidence: float
    choice: Optional[str]


def _parse_lines(lines: List[str]) -> List[Decision]:
    """Extract (confidence, choice) from any lines that carry a routing decision."""
    out: List[Decision] = []
    for line in lines:
        if "confidence" not in line:
            continue
        m = _CONF_RE.search(line)
        if not m:
            continue
        try:
            conf = float(m.group(1))
        except ValueError:
            continue
        cm = _CHOICE_RE.search(line)
        out.append(Decision(confidence=conf, choice=cm.group(1) if cm else None))
    return out


def _fetch_cloudwatch_lines(runtime: str, region: str, hours: int) -> List[str]:
    """Read recent log events from the runtime's CloudWatch log group."""
    import boto3  # imported lazily so --stdin mode needs no boto3

    log_group = f"/aws/bedrock-agentcore/runtimes/{runtime}-DEFAULT"
    client = boto3.client("logs", region_name=region)
    start_ms = int((time.time() - hours * 3600) * 1000)

    lines: List[str] = []
    token = None
    while True:
        kwargs = {
            "logGroupName": log_group,
            "startTime": start_ms,
            "filterPattern": "Decider",  # server-side filter to cut volume
        }
        if token:
            kwargs["nextToken"] = token
        resp = client.filter_log_events(**kwargs)
        lines.extend(e.get("message", "") for e in resp.get("events", []))
        token = resp.get("nextToken")
        if not token:
            break
    return lines


def _report(decisions: List[Decision], threshold: float) -> None:
    if not decisions:
        print("No routing decisions found. Has the agent handled any requests yet?")
        return

    confs = sorted(d.confidence for d in decisions)
    n = len(confs)
    act = sum(1 for c in confs if c >= threshold)
    escalate = n - act

    def pct(p: float) -> float:
        # simple nearest-rank percentile
        idx = min(n - 1, max(0, int(round(p / 100 * (n - 1)))))
        return confs[idx]

    print(f"\nFinRoute — Decider threshold analysis ({n} routing decisions)")
    print("=" * 60)
    print(f"Current ACT_THRESHOLD under test: {threshold:.2f}")
    print(f"  ACT (>= {threshold:.2f}):      {act:4d}  ({act/n:5.1%})")
    print(f"  ESCALATE (< {threshold:.2f}):  {escalate:4d}  ({escalate/n:5.1%})")
    print("\nConfidence distribution:")
    print(f"  min   {confs[0]:.3f}")
    print(f"  p25   {pct(25):.3f}")
    print(f"  p50   {pct(50):.3f}")
    print(f"  p75   {pct(75):.3f}")
    print(f"  p90   {pct(90):.3f}")
    print(f"  max   {confs[-1]:.3f}")

    # Per-choice breakdown — helps spot if one route is systematically less confident
    by_choice: dict = {}
    for d in decisions:
        if d.choice:
            by_choice.setdefault(d.choice, []).append(d.confidence)
    if by_choice:
        print("\nMean confidence by chosen route:")
        for choice, cs in sorted(by_choice.items()):
            print(f"  {choice:<12} {sum(cs)/len(cs):.3f}  (n={len(cs)})")

    # Evidence-based suggestion: look for a natural gap between the confident
    # cluster and the ambiguous tail. A common heuristic: set the threshold just
    # below the p25 of clearly-confident decisions, or at the largest gap.
    gaps = [(confs[i + 1] - confs[i], confs[i], confs[i + 1]) for i in range(n - 1)]
    if gaps:
        biggest = max(gaps, key=lambda g: g[0])
        if biggest[0] > 0.05:  # only suggest if there's a real valley
            suggested = round((biggest[1] + biggest[2]) / 2, 2)
            print(
                f"\nSuggestion: the largest confidence gap is between "
                f"{biggest[1]:.3f} and {biggest[2]:.3f} — a threshold near "
                f"{suggested:.2f} would cleanly separate the clusters."
            )
        else:
            print(
                "\nSuggestion: confidences are fairly continuous (no sharp valley); "
                f"the default {threshold:.2f} is reasonable. Lower it to ACT more "
                "aggressively, raise it to escalate more to the LLM."
            )


def main() -> None:
    ap = argparse.ArgumentParser(description="Tune Decider ACT_THRESHOLD from logs.")
    ap.add_argument("--runtime", help="AgentCore runtime id, e.g. finroute_agent-ABC123")
    ap.add_argument("--region", default="us-east-1")
    ap.add_argument("--hours", type=int, default=24, help="look-back window")
    ap.add_argument("--threshold", type=float, default=0.75, help="threshold to evaluate")
    ap.add_argument("--stdin", action="store_true", help="read log lines from stdin instead of CloudWatch")
    args = ap.parse_args()

    if args.stdin:
        lines = sys.stdin.read().splitlines()
    elif args.runtime:
        try:
            lines = _fetch_cloudwatch_lines(args.runtime, args.region, args.hours)
        except Exception as exc:
            print(f"Could not read CloudWatch logs: {exc}", file=sys.stderr)
            sys.exit(1)
    else:
        ap.error("provide --runtime <id> or --stdin")

    decisions = _parse_lines(lines)
    _report(decisions, args.threshold)


if __name__ == "__main__":
    main()
