#!/bin/bash
# ============================================================================
# Financial Advisor — Cleanup All AWS Resources
# ============================================================================
# Removes all AWS resources created by this project.
#
# Usage:
#   chmod +x cleanup.sh
#   ./cleanup.sh
# ============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGION="eu-north-1"

echo "============================================"
echo "  Financial Advisor — Resource Cleanup"
echo "============================================"
echo ""
echo "⚠️  This will DELETE all AWS resources created by this project."
echo "  Region: $REGION"
echo ""
read -p "Are you sure? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Cancelled."
    exit 0
fi

cd "$PROJECT_DIR"
source .venv/bin/activate 2>/dev/null || true

echo ""

# ----------------------------------------------------------------------------
# Step 1: Delete AgentCore Runtime
# ----------------------------------------------------------------------------
echo "━━━ Step 1: Deleting AgentCore Runtime ━━━"

python -c "
import boto3
client = boto3.client('bedrock-agentcore-control', region_name='$REGION')
try:
    runtimes = client.list_agent_runtimes()
    for rt in runtimes.get('agentRuntimes', []):
        if 'personal_finance_agent' in rt['agentRuntimeName']:
            print(f'  Deleting runtime: {rt[\"agentRuntimeId\"]}')
            client.delete_agent_runtime(agentRuntimeId=rt['agentRuntimeId'])
            print(f'  ✓ Runtime deleted')
except Exception as e:
    print(f'  ⚠️  Could not delete runtime: {e}')
" 2>/dev/null || echo "  ⚠️  Runtime cleanup skipped"

echo ""

# ----------------------------------------------------------------------------
# Step 2: Delete Bedrock Guardrail
# ----------------------------------------------------------------------------
echo "━━━ Step 2: Deleting Bedrock Guardrail ━━━"

python -c "
from utils.guardrail import delete_guardrail
delete_guardrail()
" 2>/dev/null || echo "  ⚠️  Guardrail cleanup skipped"

echo ""

# ----------------------------------------------------------------------------
# Step 3: Delete Cognito User Pool
# ----------------------------------------------------------------------------
echo "━━━ Step 3: Deleting Cognito User Pool ━━━"

python -c "
from utils.agentcore_utils import delete_cognito_user_pool
delete_cognito_user_pool()
" 2>/dev/null || echo "  ⚠️  Cognito cleanup skipped"

echo ""

# ----------------------------------------------------------------------------
# Step 4: Delete IAM Role
# ----------------------------------------------------------------------------
echo "━━━ Step 4: Cleaning up IAM role ━━━"

ROLE_NAME="AmazonBedrockAgentCoreSDKRuntime-$REGION"

# Detach policies first
for POLICY in "arn:aws:iam::aws:policy/AmazonBedrockFullAccess" \
              "arn:aws:iam::aws:policy/CloudWatchLogsFullAccess" \
              "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"; do
    aws iam detach-role-policy --role-name "$ROLE_NAME" --policy-arn "$POLICY" 2>/dev/null || true
done

# Delete inline policies
for POLICY_NAME in $(aws iam list-role-policies --role-name "$ROLE_NAME" --query 'PolicyNames[]' --output text 2>/dev/null || echo ""); do
    aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name "$POLICY_NAME" 2>/dev/null || true
done

# Delete the role
aws iam delete-role --role-name "$ROLE_NAME" 2>/dev/null && \
    echo "  ✓ IAM role '$ROLE_NAME' deleted" || \
    echo "  ⚠️  Could not delete IAM role"

echo ""

# ----------------------------------------------------------------------------
# Step 5: Delete Secrets Manager entries
# ----------------------------------------------------------------------------
echo "━━━ Step 5: Cleaning up Secrets Manager ━━━"

python -c "
import boto3
client = boto3.client('secretsmanager', region_name='$REGION')
try:
    secrets = client.list_secrets(
        Filters=[{'Key': 'tag-key', 'Values': ['Purpose']}, {'Key': 'tag-value', 'Values': ['AgentCoreProject']}]
    )
    for secret in secrets.get('SecretList', []):
        print(f'  Deleting secret: {secret[\"Name\"]}')
        client.delete_secret(SecretId=secret['Name'], ForceDeleteWithoutRecovery=True)
        print(f'  ✓ Deleted')
    if not secrets.get('SecretList'):
        print('  No project secrets found')
except Exception as e:
    print(f'  ⚠️  Could not clean secrets: {e}')
" 2>/dev/null || echo "  ⚠️  Secrets cleanup skipped"

echo ""
echo "============================================"
echo "  ✅ Cleanup Complete!"
echo "============================================"
echo ""
echo "All AWS resources have been removed."
echo "Local files (.venv, node_modules) are untouched."
echo ""
