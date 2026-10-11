#!/bin/bash
# ============================================================================
# Financial Advisor — Deploy to AgentCore
# ============================================================================
# Deploys the agent to AWS Bedrock AgentCore and updates the frontend config.
#
# Prerequisites:
#   - setup.sh has been run successfully
#   - .venv is activated
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
# ============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGION="eu-north-1"

echo "============================================"
echo "  Financial Advisor — Deploy to AgentCore"
echo "============================================"
echo ""

cd "$PROJECT_DIR"
source .venv/bin/activate

# Get AWS account
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
echo "AWS Account: $AWS_ACCOUNT"
echo "Region: $REGION"
echo ""

# ----------------------------------------------------------------------------
# Step 1: Build and Deploy via AgentCore Starter Toolkit
# ----------------------------------------------------------------------------
echo "━━━ Step 1: Deploying agent to AgentCore ━━━"

# Memory id for cross-session persistence (read from committed config).
# On a fresh account without .bedrock_agentcore.yaml this is empty, which main.py
# tolerates (memory lookup/store is guarded by `if memory_id:`).
MEMORY_ID=$(grep 'memory_id:' .bedrock_agentcore.yaml 2>/dev/null | awk '{print $2}' | head -n1 || echo "")

# Use the starter toolkit to deploy.
# Values are passed via the environment (not string-spliced into Python literals)
# so a stray quote/newline in a derived value cannot break or inject the heredoc.
export AWS_ACCOUNT REGION MEMORY_ID
python3 -c "
import os
from bedrock_agentcore_starter_toolkit import Runtime
runtime = Runtime()
runtime.configure(
    entrypoint='main.py',
    execution_role=f\"arn:aws:iam::{os.environ['AWS_ACCOUNT']}:role/AmazonBedrockAgentCoreSDKRuntime-{os.environ['REGION']}\",
    auto_create_execution_role=False,
    auto_create_ecr=True,
    requirements_file='requirements.txt',
    region=os.environ['REGION'],
    agent_name='personal_finance_agent',
)
result = runtime.launch(
    env_vars={
        'OTEL_PYTHON_EXCLUDED_URLS': '/ping,/invocations',
        'AGENTCORE_MEMORY_ID': os.environ.get('MEMORY_ID', ''),
    }
)
print(f'Agent ARN: {result.agent_arn}')
print(f'Agent ID: {result.agent_id}')
" 2>&1 | tee /tmp/deploy_output.txt

# Extract the runtime ARN
AGENT_ARN=$(grep "Agent ARN:" /tmp/deploy_output.txt | awk '{print $NF}' || echo "")
AGENT_ID=$(grep "Agent ID:" /tmp/deploy_output.txt | awk '{print $NF}' || echo "")

if [ -z "$AGENT_ARN" ]; then
    echo "⚠️  Could not extract agent ARN from deployment output."
    echo "  Check the output above and update frontend/.env.local manually."
    echo ""
    echo "  Expected format for NEXT_PUBLIC_AGENTCORE_ENDPOINT:"
    echo "  https://bedrock-agentcore.$REGION.amazonaws.com/runtimes/{URL_ENCODED_ARN}/invocations"
    exit 1
fi

echo ""
echo "✓ Agent deployed successfully"
echo "  ARN: $AGENT_ARN"
echo "  ID: $AGENT_ID"

# ----------------------------------------------------------------------------
# Step 2: Update Frontend Config
# ----------------------------------------------------------------------------
echo ""
echo "━━━ Step 2: Updating frontend configuration ━━━"

# URL-encode the ARN (read via env so an unexpected char cannot break/inject the one-liner)
ENCODED_ARN=$(AGENT_ARN="$AGENT_ARN" python3 -c "import os, urllib.parse; print(urllib.parse.quote(os.environ['AGENT_ARN'], safe=''))")

# Read existing Cognito config
POOL_ID=$(grep COGNITO_USER_POOL_ID "$PROJECT_DIR/frontend/.env.local" | cut -d= -f2)
CLIENT_ID=$(grep COGNITO_CLIENT_ID "$PROJECT_DIR/frontend/.env.local" | cut -d= -f2)

# Write updated .env.local
cat > "$PROJECT_DIR/frontend/.env.local" << EOF
# AgentCore Runtime Endpoint
NEXT_PUBLIC_AGENTCORE_ENDPOINT=https://bedrock-agentcore.$REGION.amazonaws.com/runtimes/$ENCODED_ARN/invocations

# Cognito configuration
NEXT_PUBLIC_COGNITO_USER_POOL_ID=$POOL_ID
NEXT_PUBLIC_COGNITO_CLIENT_ID=$CLIENT_ID
NEXT_PUBLIC_COGNITO_REGION=$REGION
EOF

echo "✓ Frontend .env.local updated with runtime endpoint"

# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------
echo ""
echo "============================================"
echo "  ✅ Deployment Complete!"
echo "============================================"
echo ""
echo "Agent Runtime: $AGENT_ID"
echo "Endpoint: https://bedrock-agentcore.$REGION.amazonaws.com/runtimes/$ENCODED_ARN/invocations"
echo ""
echo "Next step: Deploy frontend to Amplify"
echo "  ./deploy-frontend.sh"
echo ""
