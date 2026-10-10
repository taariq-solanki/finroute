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

# Memory id for cross-session persistence (read from committed config)
MEMORY_ID=$(grep 'memory_id:' .bedrock_agentcore.yaml | awk '{print $2}' | head -n1)

# Use the starter toolkit to deploy
python3 -c "
from bedrock_agentcore_starter_toolkit import Runtime
runtime = Runtime()
runtime.configure(
    entrypoint='main.py',
    execution_role='arn:aws:iam::$AWS_ACCOUNT:role/agentcore-execution-personal_finance_agent-staging',
    auto_create_execution_role=False,
    auto_create_ecr=True,
    requirements_file='requirements.txt',
    region='$REGION',
    agent_name='personal_finance_agent',
)
result = runtime.launch(
    env_vars={
        'OTEL_PYTHON_EXCLUDED_URLS': '/ping,/invocations',
        'AGENTCORE_MEMORY_ID': '$MEMORY_ID',
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

# URL-encode the ARN
ENCODED_ARN=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$AGENT_ARN', safe=''))")

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
