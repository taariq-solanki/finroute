#!/bin/bash
# ============================================================================
# FinRoute — CloudWatch Observability Dashboard
# ============================================================================
# Creates a CloudWatch dashboard that surfaces what the deployed agent already
# emits (OpenTelemetry -> CloudWatch): Bedrock invocation latency/errors plus
# Logs-Insights widgets over the structured Decider routing-decision lines.
#
# This makes the routing layer *visible*: ACT vs ESCALATE rate, confidence
# distribution, and per-route counts — the "I measure my system" artifact.
#
# Usage:
#   chmod +x observability/dashboard.sh
#   ./observability/dashboard.sh finroute_agent-ZAzLwHBOOG            # runtime id
#   ./observability/dashboard.sh finroute_agent-ZAzLwHBOOG us-east-1  # + region
# ============================================================================

set -e

RUNTIME="${1:?Usage: dashboard.sh <runtime-id> [region]}"
REGION="${2:-us-east-1}"
LOG_GROUP="/aws/bedrock-agentcore/runtimes/${RUNTIME}-DEFAULT"
DASH_NAME="FinRoute-${RUNTIME}"

echo "Creating dashboard '$DASH_NAME' in $REGION over log group $LOG_GROUP ..."

# Logs-Insights queries parse the structured lines request_factory/decider_router emit:
#   "Decider ACT: route=... confidence=... latency_ms=..."
#   "Decider ESCALATE: ... confidence=... source=..."
#   "Decider routing decision: RouteDecision(choice='...', confidence=..., ...)"

BODY=$(cat <<JSON
{
  "widgets": [
    {
      "type": "log", "x": 0, "y": 0, "width": 12, "height": 6,
      "properties": {
        "region": "${REGION}",
        "title": "Routing: ACT vs ESCALATE (count)",
        "query": "SOURCE '${LOG_GROUP}' | fields @message | filter @message like /Decider (ACT|ESCALATE)/ | parse @message /Decider (?<decision>ACT|ESCALATE)/ | stats count(*) as events by decision",
        "view": "bar"
      }
    },
    {
      "type": "log", "x": 12, "y": 0, "width": 12, "height": 6,
      "properties": {
        "region": "${REGION}",
        "title": "Chosen route distribution",
        "query": "SOURCE '${LOG_GROUP}' | fields @message | filter @message like /routing decision/ | parse @message /choice='(?<route>[a-z]+)'/ | stats count(*) as picks by route",
        "view": "pie"
      }
    },
    {
      "type": "log", "x": 0, "y": 6, "width": 12, "height": 6,
      "properties": {
        "region": "${REGION}",
        "title": "Decider confidence over time",
        "query": "SOURCE '${LOG_GROUP}' | fields @timestamp, @message | filter @message like /routing decision/ | parse @message /confidence=(?<conf>[0-9.]+)/ | stats avg(conf) as avg_confidence, min(conf) as min_confidence, max(conf) as max_confidence by bin(30m)",
        "view": "timeSeries"
      }
    },
    {
      "type": "log", "x": 12, "y": 6, "width": 12, "height": 6,
      "properties": {
        "region": "${REGION}",
        "title": "Decider routing latency (ms)",
        "query": "SOURCE '${LOG_GROUP}' | fields @timestamp, @message | filter @message like /Decider ACT/ | parse @message /latency_ms=(?<lat>[0-9.]+)/ | stats avg(lat) as avg_ms, max(lat) as max_ms by bin(30m)",
        "view": "timeSeries"
      }
    },
    {
      "type": "log", "x": 0, "y": 12, "width": 24, "height": 6,
      "properties": {
        "region": "${REGION}",
        "title": "Errors & guardrail interventions (recent)",
        "query": "SOURCE '${LOG_GROUP}' | fields @timestamp, @message | filter @message like /ERROR|Guardrail|Throttl|fallback/ | sort @timestamp desc | limit 50",
        "view": "table"
      }
    }
  ]
}
JSON
)

aws cloudwatch put-dashboard \
  --dashboard-name "$DASH_NAME" \
  --dashboard-body "$BODY" \
  --region "$REGION" >/dev/null

echo "✓ Dashboard created: $DASH_NAME"
echo "  View it: https://${REGION}.console.aws.amazon.com/cloudwatch/home?region=${REGION}#dashboards/dashboard/${DASH_NAME}"
