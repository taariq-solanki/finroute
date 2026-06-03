#!/bin/bash
# ============================================================================
# Financial Advisor — Full Project Setup Script
# ============================================================================
# This script automates the complete setup of the multi-agent financial
# assistant including backend Python env, frontend, IAM roles, and deployment.
#
# Prerequisites:
#   - Python 3.12 installed (brew install python@3.12)
#   - Node.js installed
#   - AWS CLI configured with eu-north-1 region
#   - Amazon Nova Pro model access enabled in eu-north-1
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
# ============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGION="eu-north-1"
RUNTIME_NAME="personal_finance_agent"

echo "============================================"
echo "  Financial Advisor — Automated Setup"
echo "============================================"
echo ""
echo "Project directory: $PROJECT_DIR"
echo "AWS Region: $REGION"
echo ""

# ----------------------------------------------------------------------------
# Step 1: Python Backend Setup
# ----------------------------------------------------------------------------
echo "━━━ Step 1: Setting up Python backend ━━━"

cd "$PROJECT_DIR"

# Find Python 3.12
PYTHON_BIN=""
if command -v python3.12 &> /dev/null; then
    PYTHON_BIN="python3.12"
elif command -v /opt/homebrew/bin/python3.12 &> /dev/null; then
    PYTHON_BIN="/opt/homebrew/bin/python3.12"
elif command -v python3 &> /dev/null; then
    PY_VERSION=$(python3 --version 2>&1 | awk '{print $2}' | cut -d. -f1,2)
    if [ "$PY_VERSION" = "3.12" ]; then
        PYTHON_BIN="python3"
    fi
fi

if [ -z "$PYTHON_BIN" ]; then
    echo "❌ Python 3.12 not found. Install it with: brew install python@3.12"
    exit 1
fi

echo "✓ Using Python: $PYTHON_BIN ($($PYTHON_BIN --version))"

# Create virtual environment
if [ ! -d ".venv" ]; then
    echo "  Creating virtual environment..."
    $PYTHON_BIN -m venv .venv
fi

source .venv/bin/activate
echo "✓ Virtual environment activated"

# Install dependencies
echo "  Installing Python dependencies..."
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
echo "✓ Python dependencies installed"

echo ""

# ----------------------------------------------------------------------------
# Step 2: Verify AWS Configuration
# ----------------------------------------------------------------------------
echo "━━━ Step 2: Verifying AWS configuration ━━━"

AWS_REGION_CONFIGURED=$(aws configure get region 2>/dev/null || echo "not-set")
if [ "$AWS_REGION_CONFIGURED" != "$REGION" ]; then
    echo "⚠️  AWS region is '$AWS_REGION_CONFIGURED', expected '$REGION'"
    echo "  Setting region to $REGION..."
    aws configure set region $REGION
fi

# Verify credentials work
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
if [ -z "$AWS_ACCOUNT" ]; then
    echo "❌ AWS credentials not configured. Run 'aws configure' first."
    exit 1
fi
echo "✓ AWS Account: $AWS_ACCOUNT (Region: $REGION)"

echo ""

# ----------------------------------------------------------------------------
# Step 3: Create IAM Role for AgentCore Runtime
# ----------------------------------------------------------------------------
echo "━━━ Step 3: Setting up IAM role ━━━"

ROLE_NAME="AmazonBedrockAgentCoreSDKRuntime-$REGION"

# Check if role exists
if aws iam get-role --role-name "$ROLE_NAME" &>/dev/null 2>&1; then
    echo "✓ IAM role '$ROLE_NAME' already exists"
else
    echo "  Creating IAM role..."
    aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document '{
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Principal": {"Service": "bedrock-agentcore.amazonaws.com"},
                "Action": "sts:AssumeRole"
            }]
        }' --output text --query 'Role.Arn' > /dev/null

    echo "✓ IAM role created"
fi

# Attach required policies
echo "  Attaching policies..."
aws iam attach-role-policy --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AmazonBedrockFullAccess 2>/dev/null || true
aws iam attach-role-policy --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess 2>/dev/null || true
aws iam attach-role-policy --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly 2>/dev/null || true
echo "✓ Policies attached (Bedrock, CloudWatch, ECR)"

echo ""

# ----------------------------------------------------------------------------
# Step 4: Create Bedrock Guardrail
# ----------------------------------------------------------------------------
echo "━━━ Step 4: Setting up Bedrock Guardrail ━━━"

python -c "
from utils.guardrail import create_guardrail
result = create_guardrail()
if result:
    print(f'✓ Guardrail ready: ID={result[0]}')
else:
    print('⚠️  Guardrail setup skipped')
" 2>/dev/null || echo "⚠️  Guardrail creation skipped (may need Bedrock access)"

echo ""

# ----------------------------------------------------------------------------
# Step 5: Setup Cognito User Pool
# ----------------------------------------------------------------------------
echo "━━━ Step 5: Setting up Cognito authentication ━━━"

COGNITO_OUTPUT=$(python -c "
import json
from utils.agentcore_utils import setup_cognito_user_pool
result = setup_cognito_user_pool()
if result:
    print(json.dumps(result))
" 2>/dev/null || echo "")

if [ -n "$COGNITO_OUTPUT" ] && echo "$COGNITO_OUTPUT" | python -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    POOL_ID=$(echo "$COGNITO_OUTPUT" | python -c "import sys,json; print(json.load(sys.stdin)['pool_id'])")
    CLIENT_ID=$(echo "$COGNITO_OUTPUT" | python -c "import sys,json; print(json.load(sys.stdin)['client_id'])")
    USERNAME=$(echo "$COGNITO_OUTPUT" | python -c "import sys,json; print(json.load(sys.stdin)['username'])")
    PASSWORD=$(echo "$COGNITO_OUTPUT" | python -c "import sys,json; print(json.load(sys.stdin)['password'])")
    echo "✓ Cognito User Pool created"
    echo "  Pool ID: $POOL_ID"
    echo "  Client ID: $CLIENT_ID"
    echo "  Username: $USERNAME"
    echo "  ⚠️  Password saved to AWS Secrets Manager"
else
    echo "⚠️  Cognito setup skipped (may already exist)"
    echo "  Using existing values from .env.local"
    POOL_ID=$(grep COGNITO_USER_POOL_ID "$PROJECT_DIR/frontend/.env.local" 2>/dev/null | cut -d= -f2)
    CLIENT_ID=$(grep COGNITO_CLIENT_ID "$PROJECT_DIR/frontend/.env.local" 2>/dev/null | cut -d= -f2)
fi

echo ""

# ----------------------------------------------------------------------------
# Step 6: Frontend Setup
# ----------------------------------------------------------------------------
echo "━━━ Step 6: Setting up frontend ━━━"

cd "$PROJECT_DIR/frontend"

# Install Node dependencies
if [ ! -d "node_modules" ]; then
    echo "  Installing Node.js dependencies..."
    npm install --silent 2>/dev/null
    echo "✓ Frontend dependencies installed"
else
    echo "✓ Frontend dependencies already installed"
fi

# Update .env.local if we have new Cognito values
if [ -n "$POOL_ID" ] && [ -n "$CLIENT_ID" ]; then
    cat > .env.local << EOF
# AgentCore endpoint - use the runtime invocation URL format
# Update RUNTIME_ARN below after deployment
NEXT_PUBLIC_AGENTCORE_ENDPOINT=https://bedrock-agentcore.$REGION.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3A$REGION%3A${AWS_ACCOUNT}%3Aruntime%2F${RUNTIME_NAME}/invocations

# Cognito configuration
NEXT_PUBLIC_COGNITO_USER_POOL_ID=$POOL_ID
NEXT_PUBLIC_COGNITO_CLIENT_ID=$CLIENT_ID
NEXT_PUBLIC_COGNITO_REGION=$REGION
EOF
    echo "✓ .env.local updated with Cognito config"
fi

cd "$PROJECT_DIR"

echo ""

# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------
echo "============================================"
echo "  ✅ Setup Complete!"
echo "============================================"
echo ""
echo "To run the backend locally:"
echo "  cd $PROJECT_DIR"
echo "  source .venv/bin/activate"
echo "  python -m main"
echo ""
echo "To run the frontend:"
echo "  cd $PROJECT_DIR/frontend"
echo "  npm run dev -- -p 3001"
echo "  Open http://localhost:3001"
echo ""
echo "To deploy to AgentCore:"
echo "  source .venv/bin/activate"
echo "  agentcore deploy"
echo ""
if [ -n "$USERNAME" ]; then
    echo "Login credentials:"
    echo "  Username: $USERNAME"
    echo "  Password: (stored in AWS Secrets Manager)"
fi
echo ""
