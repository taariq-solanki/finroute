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

# Memory id for cross-session persistence.
# Read from committed config when present. NOTE: the starter toolkit regenerates
# .bedrock_agentcore.yaml on launch and does NOT preserve this custom key, so the
# grep can come back empty on a subsequent run. Fall back to the known-active memory
# resource so a normal deploy never silently injects an empty AGENTCORE_MEMORY_ID.
DEFAULT_MEMORY_ID="FinancialAdvisorMemory-7Yqinr2IDl"
MEMORY_ID=$(grep 'memory_id:' .bedrock_agentcore.yaml 2>/dev/null | awk '{print $2}' | head -n1)
MEMORY_ID=${MEMORY_ID:-$DEFAULT_MEMORY_ID}

# Fail loudly rather than deploy a memory-disabled runtime by accident.
if [ -z "$MEMORY_ID" ]; then
  echo "❌ ERROR: MEMORY_ID is empty. Refusing to deploy with memory disabled." >&2
  echo "   Set 'memory_id:' under the aws: block in .bedrock_agentcore.yaml or" >&2
  echo "   update DEFAULT_MEMORY_ID in deploy.sh." >&2
  exit 1
fi
echo "✓ Using AgentCore memory id: $MEMORY_ID"

# Cognito identifiers for the inbound JWT authorizer. The browser sends a Cognito
# ACCESS token (Authorization: Bearer <accessToken>) whose `client_id` claim is the
# app CLIENT id. AgentCore's customJWTAuthorizer validates that `client_id` claim
# against allowedClients, so the runtime needs an authorizer scoped to that
# client/pool or it rejects every bearer request with 403. (A Cognito ID token
# carries the client id in `aud` and has no `client_id` claim, so it would be
# rejected with 401 — the access token is the correct bearer.) Read these from
# frontend/.env.local NOW —
# Step 2 below rewrites that file, so we must capture the values before then.
# Known-active fallbacks mirror the MEMORY_ID safety-net pattern so a missing/
# regenerated .env.local can't silently blank the authorizer.
DEFAULT_COGNITO_CLIENT_ID="5kqdn52topm5k5970mpbaqc10t"
DEFAULT_COGNITO_POOL_ID="eu-north-1_jw1OxSF6u"
COGNITO_CLIENT_ID=$(grep NEXT_PUBLIC_COGNITO_CLIENT_ID "$PROJECT_DIR/frontend/.env.local" 2>/dev/null | cut -d= -f2 | head -n1)
COGNITO_POOL_ID=$(grep NEXT_PUBLIC_COGNITO_USER_POOL_ID "$PROJECT_DIR/frontend/.env.local" 2>/dev/null | cut -d= -f2 | head -n1)
COGNITO_CLIENT_ID=${COGNITO_CLIENT_ID:-$DEFAULT_COGNITO_CLIENT_ID}
COGNITO_POOL_ID=${COGNITO_POOL_ID:-$DEFAULT_COGNITO_POOL_ID}

# Never deploy an authorizer with blank clients — that would lock everyone out.
if [ -z "$COGNITO_CLIENT_ID" ] || [ -z "$COGNITO_POOL_ID" ]; then
  echo "❌ ERROR: Cognito client id or pool id is empty. Refusing to deploy an" >&2
  echo "   authorizer with no allowed clients." >&2
  echo "   Set NEXT_PUBLIC_COGNITO_CLIENT_ID / NEXT_PUBLIC_COGNITO_USER_POOL_ID in" >&2
  echo "   frontend/.env.local or update the DEFAULT_COGNITO_* values in deploy.sh." >&2
  exit 1
fi
echo "✓ Using Cognito client id: $COGNITO_CLIENT_ID"
echo "✓ Using Cognito pool id: $COGNITO_POOL_ID"

# Use the starter toolkit to deploy.
# Values are passed via the environment (not string-spliced into Python literals)
# so a stray quote/newline in a derived value cannot break or inject the heredoc.
export AWS_ACCOUNT REGION MEMORY_ID COGNITO_CLIENT_ID COGNITO_POOL_ID
python3 -c "
import os
from bedrock_agentcore_starter_toolkit import Runtime

region = os.environ['REGION']
pool_id = os.environ['COGNITO_POOL_ID']
client_id = os.environ['COGNITO_CLIENT_ID']
# Inbound JWT authorizer so the runtime validates the Cognito ACCESS-token bearer
# the browser sends. The authorizer checks the token's \`client_id\` claim against
# allowedClients, which holds the app CLIENT id (present as \`client_id\` on Cognito
# access tokens; a Cognito ID token lacks that claim and is rejected with 401).
auth_config = {
    'customJWTAuthorizer': {
        'allowedClients': [client_id],
        'discoveryUrl': f'https://cognito-idp.{region}.amazonaws.com/{pool_id}/.well-known/openid-configuration',
    }
}
runtime = Runtime()
runtime.configure(
    entrypoint='main.py',
    execution_role=f\"arn:aws:iam::{os.environ['AWS_ACCOUNT']}:role/AmazonBedrockAgentCoreSDKRuntime-{os.environ['REGION']}\",
    auto_create_execution_role=False,
    auto_create_ecr=True,
    requirements_file='requirements.txt',
    region=os.environ['REGION'],
    agent_name='personal_finance_agent',
    authorizer_configuration=auth_config,
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
